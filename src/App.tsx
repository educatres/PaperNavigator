import { useEffect, useRef, useState } from 'react'
import type { ChangeEvent, KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import { PdfViewer } from './components/pdf/PdfViewer'
import type { AnalysisUsage, Paper, PdfDocumentData, PdfHighlight, PdfParagraphTranslation, ProjectBundle, ProviderConfig, ProviderId, VerificationStatus } from './domain/types'
import { analyzePass1, analyzePass2, analyzePass3 } from './ai/orchestrator/analysis'
import type { FormatRetryHandler } from './ai/orchestrator/analysis'
import { CGU_BASE_URL, DEFAULT_MODEL_ID, generateText, GOOGLE_BASE_URL, listModels, SUPPORTED_MODEL_IDS, testProviderConnection } from './ai/providers/provider'
import { cleanHighlightResponse, highlightSummaryPrompt, highlightTranslationPrompt, paragraphTranslationPrompt, PASS3_PROMPT_VERSION } from './ai/prompts/prompts'
import { readPdf } from './pdf/pdfClient'
import { extractPdfParagraphSources } from './pdf/pdfParagraphs'
import { clearBundle, clearPdfDocuments, deletePdfDocument, loadBundle, loadPdfDocuments, saveBundle, savePdfDocument } from './storage/projectStore'
import { exportPaperMarkdown, exportPass3Html, exportProjectJson, importProjectJson, openFullReportHtml } from './storage/exports'
import { markdownToHtml, richTextToHtml } from './lib/richText'
import { clearAllSettings, readActiveProvider, readProviderConfig, saveProviderConfig } from './storage/apiKeyStore'

type TabId = 'overview' | 'pass1' | 'pass2' | 'pass3' | 'notes'

const TABS: Array<{ id: TabId; label: string }> = [
  { id: 'overview', label: '總覽' },
  { id: 'pass1', label: '第一遍' },
  { id: 'pass2', label: '第二遍' },
  { id: 'pass3', label: '第三遍' },
]

function emptyBundle(): ProjectBundle {
  const now = new Date().toISOString()
  return {
    schemaVersion: '1.0', exportedAt: now,
    project: { id: crypto.randomUUID(), name: '我的閱讀專案', researchQuestion: '', paperIds: [], createdAt: now, updatedAt: now },
    papers: [], comparisons: [],
  }
}

const formatBytes = (bytes: number) => bytes < 1024 * 1024 ? `${Math.round(bytes / 1024)} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`
const decisionLabel = { continue: '繼續深入', later: '稍後閱讀', stop: '暫停閱讀' }
const verificationLabel: Record<VerificationStatus, string> = { matched: '已定位', unverified: '待核對', mismatch: '位置異常' }

function defaultProviderConfig(id: ProviderId): ProviderConfig {
  return { id, apiKey: '', baseUrl: id === 'google' ? GOOGLE_BASE_URL : CGU_BASE_URL, modelId: id === 'cgu' ? DEFAULT_MODEL_ID : '' }
}

function modelOptions(modelId: string) {
  return SUPPORTED_MODEL_IDS.includes(modelId as typeof SUPPORTED_MODEL_IDS[number]) ? [{ id: modelId, displayName: modelId }] : []
}

function usageText(usage: AnalysisUsage | null) {
  if (!usage) return ''
  if (usage.totalTokens !== null) return `本次 API 用量：${usage.totalTokens.toLocaleString()} tokens（輸入 ${usage.inputTokens?.toLocaleString() ?? '—'}／輸出 ${usage.outputTokens?.toLocaleString() ?? '—'}）`
  return 'API 未回傳 token 用量；費用依目前帳號、模型與實際使用量而定。'
}

function formatElapsed(seconds: number) {
  if (seconds < 60) return `${seconds} 秒`
  return `${Math.floor(seconds / 60)} 分 ${String(seconds % 60).padStart(2, '0')} 秒`
}

function busyDetail(message: string, elapsed: number) {
  if (/Crossref/.test(message)) return '正在向 Crossref 查詢書目資料，請保持此頁面開啟。'
  if (/PDF|擷取第|核對/.test(message)) return '正在本機處理文件，完成後會自動回到閱讀畫面。'
  if (elapsed < 12) return '正在整理文件內容並等待模型回應，請保持此頁面開啟。'
  if (elapsed < 35) return '模型仍在閱讀與產生結構化結果，較長的論文可能需要一些時間。'
  return '仍在處理中；完成後會自動驗證結果。若不想繼續等待，可以取消這次請求。'
}

function MarkdownOutput({ label, value, onDelete }: { label: string; value: string; onDelete?: () => void }) {
  return <div className="annotation-generated markdown-output"><div className="annotation-generated-heading"><strong>{label}</strong>{onDelete && <button className="danger-link" onClick={onDelete} aria-label={`刪除${label}`}>刪除</button>}</div><div className="markdown-output-body" dangerouslySetInnerHTML={{ __html: markdownToHtml(value) }} /></div>
}

function HighlightOutputs({ highlight, onDelete }: { highlight: PdfHighlight; onDelete: (output: 'aiSummary' | 'translation') => void }) {
  const sourceText = highlight.text ?? ''
  const aiSummary = cleanHighlightResponse(highlight.aiSummary ?? '', '', sourceText)
  const translation = cleanHighlightResponse(highlight.translation ?? '', '', sourceText)
  return <>
    {aiSummary && <MarkdownOutput label="AI 摘要" value={aiSummary} onDelete={() => onDelete('aiSummary')} />}
    {translation && <MarkdownOutput label="翻譯" value={translation} onDelete={() => onDelete('translation')} />}
  </>
}

function BusyOverlay({ message, onCancel }: { message: string; onCancel?: () => void }) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    setElapsed(0)
    const timer = window.setInterval(() => setElapsed((current) => current + 1), 1000)
    return () => window.clearInterval(timer)
  }, [message])

  return <div className="busy-overlay" role="status" aria-live="polite" aria-busy="true">
    <div className="busy-overlay-card">
      <div className="busy-orbit" aria-hidden="true"><span /></div>
      <span className="eyebrow">PROCESSING</span>
      <h2>{message}</h2>
      <p>{busyDetail(message, elapsed)}</p>
      <small>已等待 {formatElapsed(elapsed)}</small>
      {onCancel && <button className="secondary-button" onClick={onCancel}>取消這次請求</button>}
    </div>
  </div>
}

function ExportDialog({ canExportMarkdown, onMarkdown, onJson, onClear, onClose }: { canExportMarkdown: boolean; onMarkdown: () => void; onJson: () => void; onClear: () => void; onClose: () => void }) {
  return <div className="export-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose() }}>
    <section className="export-dialog" role="dialog" aria-modal="true" aria-labelledby="export-dialog-title">
      <div className="export-dialog-heading"><div><span className="eyebrow">PROJECT DATA</span><h2 id="export-dialog-title">匯出與資料管理</h2></div><button className="icon-button" onClick={onClose} aria-label="關閉匯出與資料管理">×</button></div>
      <div className="export-grid"><button disabled={!canExportMarkdown} onClick={onMarkdown}><strong>Markdown 閱讀報告</strong><span>{canExportMarkdown ? '目前論文的三遍分析、證據、標記與 AI 摘要' : '請先從論文書架選擇一篇論文'}</span></button><button onClick={onJson}><strong>完整專案 JSON</strong><span>含 schemaVersion，可回復匯入</span></button><button onClick={onClear} className="destructive"><strong>清除本機專案</strong><span>會一併刪除瀏覽器內保存的 PDF 原檔</span></button></div>
      <p className="fine-print">所有匯出均排除 API Key 與 PDF 原檔。</p>
    </section>
  </div>
}

export default function App() {
  const [bundle, setBundle] = useState<ProjectBundle>(emptyBundle)
  const [hydrated, setHydrated] = useState(false)
  const [documents, setDocuments] = useState<Record<string, PdfDocumentData>>({})
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<TabId>('overview')
  const [pageIndex, setPageIndex] = useState(0)
  const [exportsOpen, setExportsOpen] = useState(false)
  const [libraryCollapsed, setLibraryCollapsed] = useState(() => {
    try { return window.localStorage.getItem('papernavigator.library-collapsed') === 'yes' }
    catch { return false }
  })
  const [pdfPanelWidth, setPdfPanelWidth] = useState<number | null>(() => {
    try {
      const saved = Number(window.localStorage.getItem('papernavigator.pdf-panel-width'))
      return Number.isFinite(saved) && saved >= 330 ? saved : null
    } catch { return null }
  })
  const [headerVisible, setHeaderVisible] = useState(() => {
    try { return window.localStorage.getItem('papernavigator.header-hidden') !== 'yes' }
    catch { return true }
  })
  const [settingsOpen, setSettingsOpen] = useState(() => {
    try { return window.localStorage.getItem('papernavigator.settings-open') !== 'no' }
    catch { return true }
  })
  const [showKey, setShowKey] = useState(false)
  const [config, setConfig] = useState<ProviderConfig>(() => {
    const id = readActiveProvider()
    return readProviderConfig(id, defaultProviderConfig(id))
  })
  const [models, setModels] = useState<Array<{ id: string; displayName: string }>>(() => modelOptions(config.modelId))
  const [connectionState, setConnectionState] = useState<'idle' | 'testing' | 'ready' | 'error'>('idle')
  const [busy, setBusy] = useState('')
  const [message, setMessage] = useState('先匯入一篇 PDF，再測試模型連線。')
  const [error, setError] = useState('')
  const [lastUsage, setLastUsage] = useState<AnalysisUsage | null>(null)
  const [floatingNoteOpen, setFloatingNoteOpen] = useState(false)
  const fileRef = useRef<HTMLInputElement | null>(null)
  const importRef = useRef<HTMLInputElement | null>(null)
  const reattachRef = useRef<HTMLInputElement | null>(null)
  const abortRef = useRef<AbortController | null>(null)

  useEffect(() => {
    void (async () => {
      try {
        const saved = await loadBundle()
        if (!saved) return
        const restored = await loadPdfDocuments(saved.papers.map((paper) => paper.id))
        setBundle(saved)
        setDocuments(restored)
        setSelectedId(saved.papers[0]?.id ?? '')
        const restoredCount = Object.keys(restored).length
        setMessage(saved.papers.length ? `已載入本機專案與 ${restoredCount} 份 PDF 原檔。` : '先匯入一篇 PDF，再測試模型連線。')
      } catch {
        setMessage('無法讀取本機儲存；目前仍可在此分頁使用。')
      } finally { setHydrated(true) }
    })()
  }, [])

  useEffect(() => {
    if (!hydrated) return
    const timer = window.setTimeout(() => void saveBundle({ ...bundle, exportedAt: new Date().toISOString() }), 250)
    return () => window.clearTimeout(timer)
  }, [bundle, hydrated])

  useEffect(() => {
    saveProviderConfig(config)
  }, [config])

  useEffect(() => {
    try { window.localStorage.setItem('papernavigator.header-hidden', headerVisible ? 'no' : 'yes') }
    catch { /* The header still works when browser storage is unavailable. */ }
  }, [headerVisible])

  useEffect(() => {
    try { window.localStorage.setItem('papernavigator.library-collapsed', libraryCollapsed ? 'yes' : 'no') }
    catch { /* The shelf still works when browser storage is unavailable. */ }
  }, [libraryCollapsed])

  useEffect(() => {
    try {
      if (pdfPanelWidth === null) window.localStorage.removeItem('papernavigator.pdf-panel-width')
      else window.localStorage.setItem('papernavigator.pdf-panel-width', String(pdfPanelWidth))
    } catch { /* The adjustable columns still work when browser storage is unavailable. */ }
  }, [pdfPanelWidth])

  useEffect(() => {
    if (!exportsOpen) return
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === 'Escape') setExportsOpen(false) }
    window.addEventListener('keydown', closeOnEscape)
    return () => window.removeEventListener('keydown', closeOnEscape)
  }, [exportsOpen])

  useEffect(() => {
    try { window.localStorage.setItem('papernavigator.settings-open', settingsOpen ? 'yes' : 'no') }
    catch { /* The panel still works when browser storage is unavailable. */ }
  }, [settingsOpen])

  useEffect(() => {
    if (!selectedId && bundle.papers[0]) setSelectedId(bundle.papers[0].id)
  }, [bundle.papers, selectedId])

  const selectedPaper = bundle.papers.find((paper) => paper.id === selectedId) ?? null
  const selectedDocument = selectedId ? documents[selectedId] ?? null : null
  const canExportFullReport = Boolean(selectedPaper?.pass1 && selectedPaper.pass2 && (selectedPaper.pass3 || selectedPaper.pass3Text?.trim()))
  const updateBundle = (transform: (current: ProjectBundle) => ProjectBundle) => setBundle((current) => {
    const next = transform(current)
    return { ...next, project: { ...next.project, updatedAt: new Date().toISOString(), paperIds: next.papers.map((paper) => paper.id) } }
  })

  const updatePaper = (id: string, transform: (paper: Paper) => Paper) => updateBundle((current) => ({ ...current, papers: current.papers.map((paper) => paper.id === id ? transform(paper) : paper) }))

  const reportError = (value: unknown) => {
    const raw = value instanceof Error ? value.message : String(value)
    const text = /quota|QuotaExceeded/i.test(raw)
      ? '瀏覽器儲存空間不足，PDF 原檔未能保存。請釋放此網站的儲存空間後重試。'
      : raw.length > 900 || /"code"\s*:\s*"invalid_/.test(raw)
      ? 'AI 回傳格式與預期不一致，系統未覆蓋原有分析。請重試，或改用較擅長結構化輸出的模型。'
      : raw
    setError(text)
    setMessage(text)
  }

  const handleFormatRetry: FormatRetryHandler = ({ stage, retry, maxRetries }) => {
    const text = `${stage}回傳格式不符，正在修正模型輸出（${retry}/${maxRetries}）…`
    setBusy(text)
    setMessage(text)
  }

  const importPdfs = async (files: File[]) => {
    if (!files.length) return
    setError('')
    setBusy('正在檢查 PDF…')
    const capacity = Math.max(0, 10 - bundle.papers.length)
    if (files.length > capacity) setMessage(`單一專案最多 10 篇；本次只處理前 ${capacity} 篇。`)
    const nextPapers: Paper[] = []
    const nextDocuments: Record<string, PdfDocumentData> = {}
    try {
      for (const file of files.slice(0, capacity)) {
        const data = await readPdf(file, (page, total) => setBusy(`${file.name}：擷取第 ${page} / ${total} 頁`))
        const duplicate = [...bundle.papers, ...nextPapers].find((paper) => paper.sha256 === data.sha256)
        if (duplicate) {
          await savePdfDocument(duplicate.id, data)
          setDocuments((current) => ({ ...current, [duplicate.id]: data }))
          setSelectedId(duplicate.id)
          setMessage(`${file.name} 與「${duplicate.filename}」內容相同，已恢復並保存該 PDF 原檔。`)
          continue
        }
        const id = crypto.randomUUID()
        const now = new Date().toISOString()
        await savePdfDocument(id, data)
        nextDocuments[id] = data
        nextPapers.push({
          id, projectId: bundle.project.id, sha256: data.sha256, filename: data.filename,
          title: data.title, authors: data.author ? data.author.split(/[,;]/).map((item) => item.trim()).filter(Boolean) : [],
          year: null, doi: null, pageCount: data.pageCount, size: data.size, uploadTime: now,
          tableAnalyses: [], citations: [], evidence: [], observations: [], notes: [], floatingNote: '', highlights: [], pdfTranslations: [],
        })
      }
      if (nextPapers.length) {
        updateBundle((current) => ({ ...current, papers: [...current.papers, ...nextPapers] }))
        setDocuments((current) => ({ ...current, ...nextDocuments }))
        setSelectedId(nextPapers[0].id)
        setPageIndex(0)
        setMessage(`已匯入 ${nextPapers.length} 篇 PDF；原檔已保存在此瀏覽器。`)
      }
    } catch (value) { reportError(value) }
    finally { setBusy(''); if (fileRef.current) fileRef.current.value = '' }
  }

  const reattach = async (file: File | undefined) => {
    if (!file || !selectedPaper) return
    setBusy('正在核對 PDF…')
    try {
      const data = await readPdf(file)
      if (data.sha256 !== selectedPaper.sha256) throw new Error('這不是原先匯入的 PDF（SHA-256 不相符）。')
      await savePdfDocument(selectedPaper.id, data)
      setDocuments((current) => ({ ...current, [selectedPaper.id]: data }))
      setMessage('PDF 已重新附上並保存，原文導航已恢復。')
    } catch (value) { reportError(value) }
    finally { setBusy(''); if (reattachRef.current) reattachRef.current.value = '' }
  }

  const loadModelList = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setConnectionState('testing')
    setBusy('正在讀取模型清單…')
    setError('')
    setModels([])
    try {
      const available = await listModels(config, controller.signal)
      setModels(available)
      if (!available.length) throw new Error(`模型清單中沒有讀到 ${SUPPORTED_MODEL_IDS.join(' 或 ')}。`)
      const preferred = available.find((model) => model.id.toLowerCase() === DEFAULT_MODEL_ID) ?? available[0]
      setConfig((current) => ({ ...current, modelId: available.some((model) => model.id === current.modelId) ? current.modelId : preferred.id }))
      setConnectionState('idle')
      setMessage(`已讀取模型清單：${available.map((model) => model.id).join('、')}。`)
    } catch (value) { setConnectionState('error'); reportError(value) }
    finally { setBusy(''); if (abortRef.current === controller) abortRef.current = null }
  }

  const testConnection = async () => {
    const controller = new AbortController()
    abortRef.current = controller
    setConnectionState('testing')
    setBusy('正在送出連線測試…')
    setError('')
    try {
      const reply = await testProviderConnection(config, controller.signal)
      saveProviderConfig(config)
      setConnectionState('ready')
      setMessage(`測試成功：已連線至 ${config.modelId}。模型回覆：${reply.slice(0, 160)}`)
    } catch (value) { setConnectionState('error'); reportError(value) }
    finally { setBusy(''); if (abortRef.current === controller) abortRef.current = null }
  }

  const saveSettings = () => {
    saveProviderConfig(config)
    setMessage(`已保存 ${config.id === 'cgu' ? 'CGU' : 'Google'} 的 API Key、Base URL 與模型設定。`)
  }

  const clearSettings = () => {
    clearAllSettings()
    const cleared = defaultProviderConfig('cgu')
    setConfig(cleared)
    setModels(modelOptions(cleared.modelId))
    setShowKey(false)
    setConnectionState('idle')
    setMessage('已清除所有 AI 連線設定，並恢復 CGU／Gemma 預設值。')
  }

  const startJob = async (label: string, task: (signal: AbortSignal) => Promise<void>, requiresDocument = true, sourceLabel = '選取的內容') => {
    if (!selectedPaper || (requiresDocument && !selectedDocument)) { setError(requiresDocument ? '請先選取並附上 PDF。' : '請先選取論文。'); return }
    if (!config.apiKey || !config.modelId) { setSettingsOpen(true); setError('請先輸入 API Key、測試連線並選擇模型。'); return }
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(label)
    setError('')
    setMessage(`${label}。${requiresDocument ? 'PDF 將傳送' : `${sourceLabel}將傳送`}至所選 AI 服務；費用依目前帳號、模型與使用量而定。`)
    try { await task(controller.signal); setMessage(`${label.replace('正在', '')}完成。`) }
    catch (value) { if ((value as Error)?.name !== 'AbortError') reportError(value); else setMessage('分析已取消。') }
    finally { setBusy(''); abortRef.current = null }
  }

  const runPass1 = () => startJob('正在執行第一遍閱讀', async (signal) => {
    const response = await analyzePass1(config, selectedDocument!, selectedPaper!.id, bundle.project.researchQuestion, signal, handleFormatRetry)
    setLastUsage(response.usage)
    updatePaper(selectedPaper!.id, (paper) => ({
      ...paper, pass1: response.result, title: response.result.title ?? paper.title,
      authors: response.result.authors, year: response.result.year, doi: response.result.doi,
      evidence: response.result.evidence, analysisModel: `${config.id}:${config.modelId}`, promptVersion: 'pass1.v1',
    }))
    setTab('pass1')
  })

  const runPass2 = () => {
    if (!selectedPaper?.pass1) { setError('請先完成第一遍閱讀。'); return }
    void startJob('正在執行第二遍閱讀', async (signal) => {
      const response = await analyzePass2(config, selectedDocument!, selectedPaper.id, selectedPaper.pass1!, signal, handleFormatRetry)
      setLastUsage(response.usage)
      updatePaper(selectedPaper.id, (paper) => ({
        ...paper, pass2: response.result, observations: response.result.observations,
        citations: response.result.references, evidence: [...paper.evidence, ...response.result.evidence],
        analysisModel: `${config.id}:${config.modelId}`, promptVersion: 'pass2.v1',
      }))
      setTab('pass2')
    })
  }

  const runPass3 = () => {
    if (!selectedPaper?.pass1 || !selectedPaper.pass2) { setError('請先完成第一遍與第二遍閱讀。'); return }
    void startJob('正在執行第三遍閱讀', async (signal) => {
      const response = await analyzePass3(config, selectedPaper.pass1!, selectedPaper.pass2!, selectedPaper.notes, selectedPaper.highlights, '', selectedPaper.floatingNote ?? '', signal)
      setLastUsage(response.usage)
      const text = response.text.trim()
      updatePaper(selectedPaper.id, (paper) => ({ ...paper, pass3: undefined, pass3Text: text, analysisModel: `${config.id}:${config.modelId}`, promptVersion: PASS3_PROMPT_VERSION }))
      setTab('pass3')
    }, false, '第一遍、第二遍、浮動筆記與螢光重點')
  }

  const runHighlightTextAction = (highlightId: string, action: 'summary' | 'translation') => {
    const highlight = selectedPaper?.highlights.find((item) => item.id === highlightId)
    if (!highlight?.text?.trim()) { setError('這個螢光標記沒有可處理的文字。'); return }
    const sourceText = highlight.text.trim()
    const label = action === 'summary' ? '正在產生螢光標記 AI 摘要' : '正在翻譯螢光標記'
    void startJob(label, async (signal) => {
      const prompt = action === 'summary' ? highlightSummaryPrompt(sourceText) : highlightTranslationPrompt(sourceText)
      const response = await generateText(config, prompt, signal)
      setLastUsage(response.usage)
      const value = cleanHighlightResponse(response.text, prompt, sourceText)
      if (!value) throw new Error('模型沒有回傳可保存的文字。')
      updatePaper(selectedPaper!.id, (paper) => ({
        ...paper,
        highlights: paper.highlights.map((item) => item.id === highlightId ? { ...item, [action === 'summary' ? 'aiSummary' : 'translation']: value } : item),
      }))
    }, false, '選取的文字')
  }

  const translatePdfParagraphs = () => {
    if (!selectedPaper || !selectedDocument) { setError('請先選取並附上 PDF。'); return }
    const paperId = selectedPaper.id
    const pdfDocument = selectedDocument
    void startJob('正在逐段翻譯', async (signal) => {
      const paragraphs = await extractPdfParagraphSources(pdfDocument, paperId, signal, (page, total) => {
        setBusy(`正在擷取段落 ${page} / ${total} 頁`)
      })
      const eligible = paragraphs.filter((paragraph) => paragraph.role !== 'excluded' && paragraph.role !== 'review' && paragraph.sourceText.length >= 2)
      const saved = new Map((selectedPaper.pdfTranslations ?? []).map((item) => [item.id, item]))
      const pending = eligible.filter((paragraph) => {
        const existing = saved.get(paragraph.id)
        return !existing || existing.sourceHash !== paragraph.sourceHash || !existing.translation.trim()
      })
      if (!eligible.length) throw new Error('這份 PDF 沒有可翻譯的文字段落。')
      if (!pending.length) {
        setMessage(`已完成 ${eligible.length} 個段落的翻譯，沒有需要更新的內容。`)
        return
      }

      for (const [index, paragraph] of pending.entries()) {
        signal.throwIfAborted()
        setBusy(`正在逐段翻譯 ${index + 1} / ${pending.length}`)
        const response = await generateText(config, paragraphTranslationPrompt(paragraph.sourceText), signal)
        const translation = response.text.trim()
        if (!translation) throw new Error(`第 ${paragraph.pdfPageIndex + 1} 頁的段落沒有取得翻譯。`)
        const record: PdfParagraphTranslation = {
          id: paragraph.id,
          paperId,
          pdfPageIndex: paragraph.pdfPageIndex,
          order: paragraph.order,
          sourceText: paragraph.sourceText,
          sourceHash: paragraph.sourceHash,
          lines: paragraph.lines,
          translation,
          model: `${config.id}:${config.modelId}`,
          createdAt: new Date().toISOString(),
        }
        updatePaper(paperId, (paper) => ({
          ...paper,
          pdfTranslations: [...(paper.pdfTranslations ?? []).filter((item) => item.id !== record.id), record]
            .sort((left, right) => left.pdfPageIndex - right.pdfPageIndex || left.order - right.order),
        }))
        setLastUsage(response.usage)
      }
      setMessage(`已完成 ${eligible.length} 個段落的繁體中文翻譯。`)
    }, false, 'PDF 擷取的段落文字')
  }

  const updateHighlightColor = (highlightId: string, color: PdfHighlight['color']) => {
    if (!selectedPaper) return
    updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: paper.highlights.map((item) => item.id === highlightId ? { ...item, color } : item) }))
  }

  const jumpToEvidence = (evidenceId: string) => {
    const evidence = selectedPaper?.evidence.find((item) => item.id === evidenceId)
    if (!evidence || evidence.pdfPageIndex === null) { setMessage('此來源沒有可跳轉的 PDF 頁碼。'); return }
    setPageIndex(evidence.pdfPageIndex)
    setMessage(evidence.verificationStatus === 'matched' ? '已跳至核對頁面。' : '已跳至 AI 指定頁面，但摘錄尚未核對。')
  }

  const removePaper = (paper: Paper) => {
    if (!window.confirm(`刪除「${paper.title ?? paper.filename}」及其分析、筆記與比較資料？`)) return
    const wasSelected = paper.id === selectedId
    updateBundle((current) => ({ ...current, papers: current.papers.filter((item) => item.id !== paper.id), comparisons: current.comparisons.map((item) => ({ ...item, paperIds: item.paperIds.filter((id) => id !== paper.id) })).filter((item) => item.paperIds.length >= 2) }))
    setDocuments((current) => { const next = { ...current }; delete next[paper.id]; return next })
    void deletePdfDocument(paper.id).catch(reportError)
    if (wasSelected) {
      setSelectedId(bundle.papers.find((item) => item.id !== paper.id)?.id ?? '')
      setPageIndex(0)
      setTab('overview')
    }
  }

  const importBackup = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    if (!file) return
    try {
      const imported = importProjectJson(await file.text())
      await clearPdfDocuments()
      setBundle(imported)
      setDocuments({})
      setSelectedId(imported.papers[0]?.id ?? '')
      setMessage('專案已回復；JSON 備份不含 PDF 原檔，請逐篇重新附上。')
    } catch (value) { reportError(value) }
    finally { event.target.value = '' }
  }

  const shareProject = async () => {
    const text = `${bundle.project.name}\n${bundle.papers.map((paper) => `• ${paper.title ?? paper.filename}`).join('\n')}`
    try {
      if (navigator.share) await navigator.share({ title: bundle.project.name, text })
      else { await navigator.clipboard.writeText(text); setMessage('專案摘要已複製到剪貼簿。') }
    } catch (value) { if ((value as Error).name !== 'AbortError') reportError(value) }
  }

  const clearProject = () => {
    if (!window.confirm('清除瀏覽器中的整個專案？請先匯出 JSON 備份。')) return
    void clearBundle().then(() => {
      setBundle(emptyBundle())
      setDocuments({})
      setSelectedId('')
      setExportsOpen(false)
      setMessage('本機專案已清除。')
    }).catch(reportError)
  }

  const clampPdfPanelWidth = (value: number) => {
    const libraryWidth = libraryCollapsed ? 44 : window.innerWidth <= 1180 ? 210 : 230
    const maximum = Math.max(330, window.innerWidth - libraryWidth - 428)
    return Math.min(Math.max(value, 330), maximum)
  }

  const beginPdfResize = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (window.matchMedia('(max-width: 900px)').matches || event.button !== 0) return
    event.preventDefault()
    const onMove = (moveEvent: PointerEvent) => {
      setPdfPanelWidth(clampPdfPanelWidth(window.innerWidth - moveEvent.clientX))
    }
    const finish = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', finish)
      window.removeEventListener('pointercancel', finish)
      document.body.classList.remove('is-resizing-panels')
    }
    document.body.classList.add('is-resizing-panels')
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', finish, { once: true })
    window.addEventListener('pointercancel', finish, { once: true })
  }

  const resizePdfWithKeyboard = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const direction = event.key === 'ArrowLeft' ? 1 : -1
    setPdfPanelWidth((current) => clampPdfPanelWidth((current ?? window.innerWidth * .39) + direction * 24))
  }

  const appClassName = [headerVisible ? 'app-shell' : 'app-shell header-collapsed', libraryCollapsed ? 'library-collapsed' : ''].filter(Boolean).join(' ')
  const workspaceStyle = pdfPanelWidth ? { '--pdf-panel-width': `${clampPdfPanelWidth(pdfPanelWidth)}px` } as React.CSSProperties : undefined
  return <div className={appClassName}>
    {headerVisible && <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">PN</div>
        <div><strong>PaperNavigator</strong><span>證據導向的 AI 論文閱讀器</span></div>
      </div>
      <div className="top-actions">
        <span className={navigator.onLine ? 'online-state' : 'online-state offline'}>{navigator.onLine ? '● 線上' : '● 離線'}</span>
        <button className="ghost-button" onClick={() => setHeaderVisible(false)}>隱藏標題列</button>
        <button className="ghost-button" onClick={() => setSettingsOpen((value) => !value)}>模型 / Key</button>
        <button className="ghost-button" onClick={() => setExportsOpen(true)}>匯出與資料管理</button>
        <button className="primary-button compact" onClick={() => fileRef.current?.click()}>＋ 上傳 PDF</button>
        <input ref={fileRef} hidden type="file" accept="application/pdf,.pdf" multiple onChange={(event) => void importPdfs([...event.target.files ?? []])} />
      </div>
    </header>}
    {!headerVisible && <button className="header-restore" onClick={() => setHeaderVisible(true)}>顯示標題列</button>}

    {settingsOpen && <section className="settings-panel">
      <div className="settings-heading"><div><span className="eyebrow">AI CONNECTION</span><h2>模型與資料流</h2></div><button className="icon-button" onClick={() => setSettingsOpen(false)} aria-label="關閉設定">×</button></div>
      <div className="settings-grid">
        <label>服務來源<select value={config.id} onChange={(event) => {
          const id = event.target.value as ProviderId
          const next = readProviderConfig(id, defaultProviderConfig(id))
          setConfig(next)
          setModels(modelOptions(next.modelId)); setConnectionState('idle')
        }}><option value="google">Google AI Studio（PDF 原生）</option><option value="cgu">CGU LLM Gateway（本機抽文字）</option></select></label>
        <label>Base URL<input value={config.baseUrl} onChange={(event) => setConfig((current) => ({ ...current, baseUrl: event.target.value }))} /></label>
        <label>API Key<div className="key-row"><input type={showKey ? 'text' : 'password'} autoComplete="off" value={config.apiKey} onChange={(event) => { setConfig((current) => ({ ...current, apiKey: event.target.value })); setConnectionState('idle') }} placeholder="儲存在此瀏覽器 localStorage" /><button className="small-button" onClick={() => setShowKey((value) => !value)}>{showKey ? '隱藏' : '顯示'}</button></div></label>
        <label>模型<select value={config.modelId} disabled={!models.length} onChange={(event) => { setConfig((current) => ({ ...current, modelId: event.target.value })); setConnectionState('idle') }}><option value="">請先讀取模型清單</option>{models.map((model) => <option key={model.id} value={model.id}>{model.id}</option>)}</select></label>
      </div>
      <div className="settings-footer">
        <p><strong>本機保存：</strong>Provider、Base URL、模型與 API Key 會保留在此瀏覽器；PDF 原檔、分析、螢光標記與逐段翻譯保存在 IndexedDB。資料不會寫入 repository，共用電腦請使用紅色「清除設定」及專案清除功能。</p>
        <div className="settings-actions">
          <button className="secondary-button" disabled={!config.apiKey || connectionState === 'testing'} onClick={() => void loadModelList()}>讀取模型清單</button>
          <button className="secondary-button" disabled={!config.apiKey || !config.modelId || connectionState === 'testing'} onClick={() => void testConnection()}>{connectionState === 'ready' ? '✓ 重新測試連線' : '測試連線'}</button>
          <button className="primary-button" disabled={!config.apiKey || !config.modelId || connectionState === 'testing'} onClick={saveSettings}>儲存設定</button>
          <button className="danger-button" disabled={connectionState === 'testing'} onClick={clearSettings}>清除設定</button>
        </div>
      </div>
    </section>}

    <div className="status-strip" role="status">
      <span>{busy ? <><span className="spinner" />{busy}</> : message}</span>
      {lastUsage && <span className="usage-text">{usageText(lastUsage)}</span>}
      {busy && <button className="text-button" onClick={() => abortRef.current?.abort()}>取消請求</button>}
    </div>
    {error && <div className="error-banner"><strong>需要處理</strong><span>{error}</span><button onClick={() => setError('')}>×</button></div>}
    {busy && <BusyOverlay message={busy} onCancel={abortRef.current ? () => abortRef.current?.abort() : undefined} />}
    {exportsOpen && <ExportDialog canExportMarkdown={Boolean(selectedPaper)} onMarkdown={() => selectedPaper && exportPaperMarkdown(selectedPaper)} onJson={() => exportProjectJson({ ...bundle, exportedAt: new Date().toISOString() })} onClear={clearProject} onClose={() => setExportsOpen(false)} />}

    <main className="workspace-layout" style={workspaceStyle}>
      <aside className="library-panel">
        <div className="library-heading"><span>論文書架</span><span>{bundle.papers.length} / 10</span><button className="library-toggle" onClick={() => setLibraryCollapsed((value) => !value)} aria-label={libraryCollapsed ? '展開論文書架' : '收起論文書架'} title={libraryCollapsed ? '展開論文書架' : '收起論文書架'}>{libraryCollapsed ? '»' : '«'}</button></div>
        <div className="paper-list">
          {bundle.papers.map((paper) => <div key={paper.id} className={paper.id === selectedId ? 'paper-item selected' : 'paper-item'}>
            <button type="button" className="paper-select" onClick={() => { setSelectedId(paper.id); setPageIndex(0); setTab('overview') }}>
              <span className="paper-index">{String(bundle.papers.indexOf(paper) + 1).padStart(2, '0')}</span>
              <span className="paper-copy"><strong>{paper.title ?? paper.filename}</strong><small>{paper.year ?? '年份未報告'} · {paper.pageCount} 頁</small><span className="pass-dots"><i className={paper.pass1 ? 'done' : ''}>1</i><i className={paper.pass2 ? 'done' : ''}>2</i><i className={paper.pass3 || paper.pass3Text ? 'done' : ''}>3</i></span></span>
            </button>
            <button type="button" className="paper-item-delete" aria-label={`刪除 ${paper.title ?? paper.filename}`} title="刪除這篇 PDF" onClick={(event) => { event.stopPropagation(); removePaper(paper) }}>×</button>
          </div>)}
          {!bundle.papers.length && <div className="empty-library"><span>＋</span><p>匯入第一篇研究論文</p><button className="small-button" onClick={() => fileRef.current?.click()}>選擇 PDF</button></div>}
        </div>
        <div className="library-footer">
          <button className="small-button full" onClick={() => fileRef.current?.click()}>＋ 加入論文</button>
          <div><button className="text-button" onClick={() => importRef.current?.click()}>匯入備份</button><button className="text-button" onClick={() => void shareProject()}>分享摘要</button></div>
          <input hidden ref={importRef} type="file" accept="application/json,.json" onChange={(event) => void importBackup(event)} />
        </div>
      </aside>

      <section className="content-panel">
        <nav className="tabbar" aria-label="閱讀階段"><button className={floatingNoteOpen ? 'note-trigger active' : 'note-trigger'} disabled={!selectedPaper} onClick={() => setFloatingNoteOpen((value) => !value)} aria-pressed={floatingNoteOpen}>筆記</button><button className={tab === 'notes' ? 'highlight-trigger active' : 'highlight-trigger'} disabled={!selectedPaper} onClick={() => setTab('notes')}><span aria-hidden="true">★</span>重點標記</button>{TABS.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}</button>)}<button className="full-report-trigger" disabled={!canExportFullReport} title={canExportFullReport ? '在新分頁開啟包含三遍分析與證據附錄的 A4 報告' : '完成三遍閱讀後即可開啟'} onClick={() => { if (selectedPaper && !openFullReportHtml(selectedPaper)) setError('瀏覽器阻擋了新分頁，請允許此網站開啟彈出式視窗。') }}>完整報告</button></nav>
        {!selectedPaper ? <Welcome onUpload={() => fileRef.current?.click()} /> : <div className="content-scroll">
          {tab === 'overview' && <div className="paper-title-row"><div><span className="eyebrow">{selectedPaper.filename}</span><h1>{selectedPaper.title ?? '尚未擷取論文標題'}</h1><p>{selectedPaper.authors.join('、') || '作者未報告'}{selectedPaper.year ? ` · ${selectedPaper.year}` : ''}</p></div><div className="paper-actions"><button className="small-button" onClick={() => exportPaperMarkdown(selectedPaper)}>匯出報告</button><button className="danger-link" onClick={() => removePaper(selectedPaper)}>刪除</button></div></div>}
          {!selectedDocument && <div className="reattach-banner"><div><strong>找不到已保存的原始 PDF</strong><p>可能是瀏覽器儲存空間已被清除。請選擇同一檔案，系統會用 SHA-256 核對並重新保存。</p></div><button className="secondary-button" onClick={() => reattachRef.current?.click()}>重新附檔</button><input ref={reattachRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => void reattach(event.target.files?.[0])} /></div>}
          {tab === 'overview' && <Overview paper={selectedPaper} document={selectedDocument} onPass1={runPass1} onPass2={runPass2} onPass3={runPass3} onJump={(page) => setPageIndex(page)} />}
          {tab === 'pass1' && <Pass1View paper={selectedPaper} onRun={runPass1} onEvidence={jumpToEvidence} />}
          {tab === 'pass2' && <Pass2View paper={selectedPaper} onRun={runPass2} onEvidence={jumpToEvidence} onJump={(page) => page !== null && setPageIndex(page)} />}
          {tab === 'pass3' && <Pass3View paper={selectedPaper} onClear={() => updatePaper(selectedPaper.id, (paper) => ({ ...paper, pass3: undefined, pass3Text: undefined }))} />}
          {tab === 'notes' && <NotesView paper={selectedPaper} onDeleteHighlight={(id: string) => updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: paper.highlights.filter((highlight) => highlight.id !== id) }))} onDeleteHighlightOutput={(id: string, output: 'aiSummary' | 'translation') => updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: paper.highlights.map((highlight) => highlight.id === id ? { ...highlight, [output]: undefined } : highlight) }))} onHighlightAction={runHighlightTextAction} onChangeHighlightColor={updateHighlightColor} onJump={setPageIndex} />}
        </div>}
      </section>
      <div className="panel-resizer" role="separator" aria-label="調整閱讀內容與 PDF 欄寬" aria-orientation="vertical" tabIndex={0} onPointerDown={beginPdfResize} onKeyDown={resizePdfWithKeyboard} onDoubleClick={() => setPdfPanelWidth(null)} />
      <PdfViewer
        document={selectedDocument}
        paperId={selectedPaper?.id ?? ''}
        pageIndex={pageIndex}
        highlights={selectedPaper?.highlights ?? []}
        translations={selectedPaper?.pdfTranslations ?? []}
        onTranslate={translatePdfParagraphs}
        onPageChange={setPageIndex}
        onAddHighlight={(highlight: PdfHighlight) => selectedPaper && updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: [...paper.highlights, highlight] }))}
        onDeleteHighlight={(id: string) => selectedPaper && updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: paper.highlights.filter((highlight) => highlight.id !== id) }))}
      />
    </main>
    {selectedPaper && floatingNoteOpen && <FloatingNote value={selectedPaper.floatingNote ?? ''} onChange={(value) => updatePaper(selectedPaper.id, (paper) => ({ ...paper, floatingNote: value }))} onClose={() => setFloatingNoteOpen(false)} />}
  </div>
}

interface FloatingNoteFrame { x: number; y: number; width: number; height: number }

function initialFloatingNoteFrame(): FloatingNoteFrame {
  const availableWidth = Math.max(280, window.innerWidth - 24)
  const availableHeight = Math.max(180, window.innerHeight - 24)
  const fallback = { x: Math.max(12, window.innerWidth - 430), y: 88, width: Math.min(360, availableWidth), height: Math.min(280, availableHeight) }
  try {
    const saved = JSON.parse(window.localStorage.getItem('papernavigator.floating-note-frame') ?? '') as Partial<FloatingNoteFrame>
    if ([saved.x, saved.y, saved.width, saved.height].every((value) => typeof value === 'number' && Number.isFinite(value))) {
      const width = Math.min(availableWidth, Math.max(280, saved.width!))
      const height = Math.min(availableHeight, Math.max(180, saved.height!))
      return { x: Math.max(0, Math.min(window.innerWidth - width, saved.x!)), y: Math.max(0, Math.min(window.innerHeight - 48, saved.y!)), width, height }
    }
  } catch { /* Use the default frame when saved geometry is unavailable. */ }
  return fallback
}

function FloatingNote({ value, onChange, onClose }: { value: string; onChange: (value: string) => void; onClose: () => void }) {
  const [frame, setFrame] = useState<FloatingNoteFrame>(initialFloatingNoteFrame)
  const gesture = useRef<({ mode: 'move' | 'resize'; pointerX: number; pointerY: number } & FloatingNoteFrame) | null>(null)

  useEffect(() => {
    const move = (event: PointerEvent) => {
      const current = gesture.current
      if (!current) return
      const deltaX = event.clientX - current.pointerX
      const deltaY = event.clientY - current.pointerY
      if (current.mode === 'move') {
        setFrame({ x: Math.max(0, Math.min(window.innerWidth - current.width, current.x + deltaX)), y: Math.max(0, Math.min(window.innerHeight - 48, current.y + deltaY)), width: current.width, height: current.height })
      } else {
        setFrame({ x: current.x, y: current.y, width: Math.max(280, Math.min(window.innerWidth - current.x - 12, current.width + deltaX)), height: Math.max(180, Math.min(window.innerHeight - current.y - 12, current.height + deltaY)) })
      }
    }
    const finish = () => { gesture.current = null }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', finish)
    window.addEventListener('pointercancel', finish)
    return () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', finish); window.removeEventListener('pointercancel', finish) }
  }, [])

  useEffect(() => {
    try { window.localStorage.setItem('papernavigator.floating-note-frame', JSON.stringify(frame)) }
    catch { /* The note remains movable when browser storage is unavailable. */ }
  }, [frame])

  const beginGesture = (mode: 'move' | 'resize') => (event: ReactPointerEvent<HTMLElement>) => {
    if (event.button !== 0) return
    event.preventDefault()
    gesture.current = { mode, pointerX: event.clientX, pointerY: event.clientY, ...frame }
  }

  return <aside className="floating-note" style={{ left: frame.x, top: frame.y, width: frame.width, height: frame.height }} aria-label="浮動筆記">
    <div className="floating-note-heading" onPointerDown={beginGesture('move')}><strong>筆記</strong><span>拖曳移動</span><button onPointerDown={(event) => event.stopPropagation()} onClick={onClose} aria-label="關閉筆記">×</button></div>
    <textarea value={value} onChange={(event) => onChange(event.target.value)} placeholder="輸入純文字筆記；第三遍分析會一起參考這些內容。" aria-label="筆記內容" />
    <span className="floating-note-save-state">自動保存 · 第三遍會納入分析</span>
    <button className="floating-note-resizer" onPointerDown={beginGesture('resize')} aria-label="拖曳調整筆記大小" title="拖曳調整大小" />
  </aside>
}

function Welcome({ onUpload }: { onUpload: () => void }) {
  return <div className="welcome"><div className="welcome-symbol">∿</div><span className="eyebrow">EVIDENCE FIRST</span><h1>從鳥瞰，到能回到原文的理解</h1><p>PaperNavigator 依三遍閱讀法拆開閱讀深度。每個重要事實都保留來源頁碼與核對狀態，避免把 AI 摘要當成論文本身。</p><button className="primary-button" onClick={onUpload}>匯入第一篇 PDF</button><div className="welcome-steps"><div><span>01</span><strong>鳥瞰五個 C</strong><p>先決定值不值得讀</p></div><div><span>02</span><strong>方法與證據</strong><p>拆解圖表與實驗</p></div><div><span>03</span><strong>重建與批判</strong><p>找出缺失與新問題</p></div></div></div>
}

function Overview({ paper, document, onPass1, onPass2, onPass3, onJump }: { paper: Paper; document: PdfDocumentData | null; onPass1: () => void; onPass2: () => void; onPass3: () => void; onJump: (page: number) => void }) {
  return <div className="section-stack"><div className="metric-grid"><article><span>PDF 頁數</span><strong>{paper.pageCount}</strong><small>{formatBytes(paper.size)}</small></article><article><span>來源核對</span><strong>{paper.evidence.filter((item) => item.verificationStatus === 'matched').length}<em> / {paper.evidence.length}</em></strong><small>已定位摘錄</small></article><article><span>結果觀測</span><strong>{paper.observations.length}</strong><small>保留原始數值</small></article><article><span>閱讀進度</span><strong>{paper.pass3 || paper.pass3Text ? '3 / 3' : paper.pass2 ? '2 / 3' : paper.pass1 ? '1 / 3' : '0 / 3'}</strong><small>三遍閱讀法</small></article></div>
    {document?.warnings.map((warning) => <div className="warning-card" key={warning}>△ {warning}</div>)}
    <div className="stage-grid"><article className={paper.pass1 ? 'stage-card complete' : 'stage-card'}><span>第一遍 · 鳥瞰</span><h2>五個 C 與閱讀決策</h2><p>擷取研究問題、主要貢獻與值得繼續閱讀的理由。</p><button className="primary-button" disabled={!document} onClick={onPass1}>{paper.pass1 ? '重新分析第一遍' : '開始第一遍'}</button></article><article className={paper.pass2 ? 'stage-card complete' : 'stage-card'}><span>第二遍 · 理解</span><h2>方法、實驗與表格</h2><p>只在你決定深入後啟動，避免一次產生全部 API 用量。</p><button className="secondary-button" disabled={!document || !paper.pass1} onClick={onPass2}>{paper.pass2 ? '重新分析第二遍' : '深入第二遍'}</button></article><article className={paper.pass3 || paper.pass3Text ? 'stage-card complete' : 'stage-card'}><span>第三遍 · 重建</span><h2>假設、風險與研究題目</h2><p>根據第一遍、第二遍、浮動筆記與螢光重點重建，不重新讀取全文。</p><button className="secondary-button" disabled={!paper.pass2} onClick={onPass3}>{paper.pass3 || paper.pass3Text ? '重新分析第三遍' : '進入第三遍'}</button></article></div>
    {paper.pass2?.tables.length ? <section className="content-card"><div className="card-heading"><div><span className="eyebrow">FOUND IN PAPER</span><h2>圖表索引</h2></div></div><div className="index-list">{[...paper.pass2.tables, ...paper.pass2.figures].map((item) => <button key={`${item.label}-${item.pdfPageIndex}`} onClick={() => item.pdfPageIndex !== null && onJump(item.pdfPageIndex)}><strong>{item.label}</strong><span>{item.title}</span><small>{item.pdfPageIndex === null ? '頁碼待確認' : `PDF p.${item.pdfPageIndex + 1}`}</small></button>)}</div></section> : null}
  </div>
}

function EvidenceButtons({ ids, paper, onEvidence }: { ids: string[]; paper: Paper; onEvidence: (id: string) => void }) {
  return <div className="evidence-row">{ids.length ? ids.map((id) => { const item = paper.evidence.find((row) => row.id === id); return <button key={id} className={`evidence-chip ${item?.verificationStatus ?? 'unverified'}`} onClick={() => onEvidence(id)} title={item?.quote ?? '未找到摘錄'}>p.{item?.pdfPageDisplay ?? '?'} · {verificationLabel[item?.verificationStatus ?? 'unverified']}</button> }) : <span className="missing-chip">未找到來源</span>}</div>
}

function Pass1View({ paper, onRun, onEvidence }: { paper: Paper; onRun: () => void; onEvidence: (id: string) => void }) {
  const data = paper.pass1
  if (!data) return <EmptyAnalysis title="第一遍尚未分析" text="先用低成本鳥瞰確認這篇論文是否值得深入。" action="開始第一遍" onRun={onRun} />
  return <div className="section-stack"><section className="lead-summary"><span className="eyebrow">ONE-SENTENCE MAP</span><h2>{data.oneSentenceTopic}</h2><p>{data.researchQuestion}</p><div className="tag-row"><span>{data.field}</span><span>{data.paperType}</span><span className={`decision ${data.readingDecision.recommendation}`}>{decisionLabel[data.readingDecision.recommendation]}</span></div><p className="decision-reason">AI 建議：{data.readingDecision.reason}。最終閱讀決定仍由你判斷。</p></section><section><div className="section-title"><div><span className="eyebrow">KESHAV'S FIVE CS</span><h2>五個 C</h2></div><button className="small-button" onClick={onRun}>重新分析</button></div><div className="five-c-grid">{data.fiveCs.map((item, index) => <article key={item.name}><span>0{index + 1}</span><h3>{item.name}</h3><p>{item.summary}</p><EvidenceButtons ids={item.evidenceIds} paper={paper} onEvidence={onEvidence} /></article>)}</div></section><div className="two-column"><section className="content-card"><span className="eyebrow">CONTRIBUTIONS</span><h2>主要創新</h2><ol>{data.contributions.map((item) => <li key={item}>{item}</li>)}</ol></section><section className="content-card"><span className="eyebrow">READING FRICTION</span><h2>待釐清概念</h2><ul>{data.unclearConcepts.map((item) => <li key={item}>{item}</li>)}</ul></section></div></div>
}

function Pass2View({ paper, onRun, onEvidence, onJump }: { paper: Paper; onRun: () => void; onEvidence: (id: string) => void; onJump: (page: number | null) => void }) {
  const data = paper.pass2
  if (!data) return <EmptyAnalysis title="第二遍尚未分析" text="完成第一遍後，再擷取方法、實驗設計、圖表與逐筆結果。" action="深入第二遍" onRun={onRun} disabled={!paper.pass1} />
  return <div className="section-stack"><div className="section-title"><div><span className="eyebrow">METHOD & EVIDENCE</span><h2>方法與實驗設計</h2></div><button className="small-button" onClick={onRun}>重新分析</button></div><div className="two-column"><section className="content-card"><h3>研究動機</h3><p>{data.motivation}</p><h3>問題定義</h3><p>{data.problemDefinition}</p><h3>輸入與輸出</h3><p>{data.inputOutput}</p></section><section className="content-card"><h3>方法流程</h3><ol className="method-steps">{data.methodSteps.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol></section></div><section className="content-card"><h3>資料集與評估</h3><div className="data-table-wrap"><table><thead><tr><th>資料集</th><th>版本／規模</th><th>Split</th><th>外部驗證</th><th>洩漏風險</th><th>狀態</th></tr></thead><tbody>{data.datasets.map((item, index) => <tr key={`${item.name}-${index}`}><td>{item.name}</td><td>{[item.version, item.size].filter(Boolean).join(' · ') || '未報告'}</td><td>{item.split ?? '未報告'}</td><td>{item.externalValidation ?? '未報告'}</td><td>{item.leakageRisk ?? '未報告'}</td><td><span className={`status-pill ${item.status}`}>{item.status}</span><EvidenceButtons ids={item.evidenceIds} paper={paper} onEvidence={onEvidence} /></td></tr>)}</tbody></table></div></section><section className="content-card"><h3>Figure / Table 索引</h3><div className="index-list">{[...data.tables, ...data.figures].map((item) => <button key={`${item.label}-${item.pdfPageIndex}`} onClick={() => onJump(item.pdfPageIndex)}><strong>{item.label}</strong><span>{item.title}<small>{item.interpretation}</small></span><b>{item.pdfPageIndex === null ? '?' : `p.${item.pdfPageIndex + 1}`}</b></button>)}</div></section><section className="content-card"><h3>作者主張 → 證據 → 限制</h3><div className="claim-list">{data.claims.map((item, index) => <article key={`${item.claim}-${index}`}><strong>{item.claim}</strong><p><b>證據：</b>{item.support}</p><p><b>限制：</b>{item.limitation}</p><EvidenceButtons ids={item.evidenceIds} paper={paper} onEvidence={onEvidence} /></article>)}</div></section><details className="guide-questions"><summary>學生引導問題（先思考再展開）</summary><ol>{data.guideQuestions.map((item) => <li key={item}>{item}</li>)}</ol></details></div>
}

function Pass3View({ paper, onClear }: { paper: Paper; onClear: () => void }) {
  const text = paper.pass3Text?.trim()
  const data = paper.pass3
  return <div className="section-stack">{text ? <section className="content-card pass3-text-card"><div className="section-title"><div><span className="eyebrow">READING REPORT</span><h2>閱讀報告</h2></div><div className="pass3-report-actions"><button className="small-button" onClick={() => exportPass3Html(paper, text)}>下載第三遍 .html</button><button className="small-button danger-button" onClick={onClear}>清除閱讀報告</button></div></div><div className="pass3-rich-output" dangerouslySetInnerHTML={{ __html: richTextToHtml(text) }} /></section> : data ? <><section className="content-card"><div className="section-title"><h2>重建程序</h2><button className="small-button danger-button" onClick={onClear}>清除閱讀報告</button></div><div className="reconstruction-list">{data.reconstruction.map((item, index) => <article key={`${item.step}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{item.step}<i className={`recon-status ${item.status}`}>{item.status}</i></h3><p>{item.detail}</p></div></article>)}</div></section><div className="two-column"><CriticalList title="隱藏假設" items={data.assumptions} /><CriticalList title="效度威脅" items={data.threats} /><CriticalList title="可重現風險" items={data.reproducibilityRisks} /></div><section><div className="section-title"><div><span className="eyebrow">AI-GENERATED, TESTABLE</span><h2>後續研究題目</h2></div></div><div className="idea-grid">{data.researchIdeas.map((item, index) => <article key={item.question}><span>IDEA {index + 1}</span><h3>{item.question}</h3><p><b>動機：</b>{item.motivation}</p><p><b>假設：</b>{item.hypothesis}</p><p><b>最小實驗：</b>{item.minimumExperiment}</p><p><b>資料／指標：</b>{item.requiredData} · {item.metric}</p></article>)}</div></section></> : <EmptyAnalysis title="尚未進入第三遍" text="請從總覽完成第二遍後產生第三遍報告。" />}</div>
}

function CriticalList({ title, items }: { title: string; items: Array<{ title: string; assessment: string; status: string }> }) {
  return <section className="content-card"><h2>{title}</h2><div className="critical-list">{items.map((item) => <article key={item.title}><strong>{item.title}</strong><span className={`status-pill ${item.status}`}>{item.status}</span><p>{item.assessment}</p></article>)}</div></section>
}

interface NotesViewProps {
  paper: Paper
  onDeleteHighlight: (id: string) => void
  onDeleteHighlightOutput: (id: string, output: 'aiSummary' | 'translation') => void
  onHighlightAction: (id: string, action: 'summary' | 'translation') => void
  onChangeHighlightColor: (id: string, color: PdfHighlight['color']) => void
  onJump: (page: number) => void
}

function NotesView({ paper, onDeleteHighlight, onDeleteHighlightOutput, onHighlightAction, onChangeHighlightColor, onJump }: NotesViewProps) {
  const colors: Array<{ id: PdfHighlight['color']; label: string }> = [{ id: 'yellow', label: '黃' }, { id: 'green', label: '綠' }, { id: 'pink', label: '粉紅' }, { id: 'blue', label: '淺藍' }]
  return <div className="section-stack">
    <section className="content-card">
      <div className="card-heading"><h2>螢光筆</h2></div>
      <div className="annotation-summary"><strong>{paper.highlights.length} 個螢光標記</strong></div>
      <div className="annotation-list">
        {paper.highlights.length ? paper.highlights.map((highlight, index) => <article className="highlight-record" key={highlight.id}>
          <span className={`annotation-color ${highlight.color}`} />
          <div className="annotation-copy"><p className="annotation-source">{highlight.text?.trim() || `文字標記 ${index + 1}`}</p>
          <div className="annotation-actions">
            <button className="small-button" onClick={() => onJump(highlight.pdfPageIndex)}>文字定位 · PDF p.{highlight.pdfPageIndex + 1}</button>
            <div className="annotation-color-picker" aria-label="更換螢光筆顏色">{colors.map((item) => <button key={item.id} className={highlight.color === item.id ? 'active' : ''} title={`${item.label}色`} aria-label={`改成${item.label}色`} style={{ background: item.id === 'yellow' ? '#f6d349' : item.id === 'green' ? '#57be89' : item.id === 'pink' ? '#ea7da0' : '#99ccee' }} onClick={() => onChangeHighlightColor(highlight.id, item.id)} />)}</div>
            <button className="small-button" disabled={!highlight.text?.trim()} onClick={() => onHighlightAction(highlight.id, 'summary')}>AI摘要</button>
            <button className="small-button" disabled={!highlight.text?.trim()} onClick={() => onHighlightAction(highlight.id, 'translation')}>翻譯</button>
            <button className="danger-link" onClick={() => onDeleteHighlight(highlight.id)}>刪除</button>
          </div>
            <HighlightOutputs highlight={highlight} onDelete={(output) => onDeleteHighlightOutput(highlight.id, output)} />
          </div>
        </article>) : <p>尚未建立螢光標記。</p>}
      </div>
    </section>
  </div>
}

function EmptyAnalysis({ title, text, action, onRun, disabled }: { title: string; text: string; action?: string; onRun?: () => void; disabled?: boolean }) {
  return <div className="empty-analysis"><span>◇</span><h2>{title}</h2><p>{text}</p>{action && onRun && <button className="primary-button" disabled={disabled} onClick={onRun}>{action}</button>}</div>
}
