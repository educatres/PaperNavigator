import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChangeEvent, Dispatch, SetStateAction } from 'react'
import { PdfViewer } from './components/pdf/PdfViewer'
import type { AnalysisUsage, Paper, PdfDocumentData, PdfHighlight, ProjectBundle, ProviderConfig, ProviderId, VerificationStatus } from './domain/types'
import { comparisonRows, compareRows } from './domain/comparison'
import type { ComparisonRow } from './domain/comparison'
import { analyzePass1, analyzePass2, analyzePass3, analyzeTable } from './ai/orchestrator/analysis'
import type { FormatRetryHandler } from './ai/orchestrator/analysis'
import { analyzeImageRegion, CGU_BASE_URL, DEFAULT_MODEL_ID, GOOGLE_BASE_URL, listModels, SUPPORTED_MODEL_IDS, testProviderConnection } from './ai/providers/provider'
import { roiPrompt } from './ai/prompts/prompts'
import { readPdf } from './pdf/pdfClient'
import { clearBundle, clearPdfDocuments, deletePdfDocument, loadBundle, loadPdfDocuments, saveBundle, savePdfDocument } from './storage/projectStore'
import { exportBibTeX, exportComparisonCsv, exportPaperMarkdown, exportProjectJson, exportRis, importProjectJson } from './storage/exports'
import { clearAllSettings, readActiveProvider, readProviderConfig, saveProviderConfig } from './storage/apiKeyStore'
import { coCitationRows, verifyCitation } from './research/citations'

type TabId = 'overview' | 'pass1' | 'pass2' | 'tables' | 'pass3' | 'compare' | 'research' | 'notes'

const TABS: Array<{ id: TabId; label: string; phase: string }> = [
  { id: 'overview', label: '總覽', phase: 'P0' },
  { id: 'pass1', label: '第一遍', phase: 'P1' },
  { id: 'pass2', label: '第二遍', phase: 'P1' },
  { id: 'tables', label: '數據分析', phase: 'P1' },
  { id: 'pass3', label: '第三遍', phase: 'P3' },
  { id: 'compare', label: '跨篇比較', phase: 'P2' },
  { id: 'research', label: '研究延伸', phase: 'P4' },
  { id: 'notes', label: '筆記與匯出', phase: 'P1' },
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

export default function App() {
  const [bundle, setBundle] = useState<ProjectBundle>(emptyBundle)
  const [hydrated, setHydrated] = useState(false)
  const [documents, setDocuments] = useState<Record<string, PdfDocumentData>>({})
  const [selectedId, setSelectedId] = useState('')
  const [tab, setTab] = useState<TabId>('overview')
  const [pageIndex, setPageIndex] = useState(0)
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
  const [tableLabel, setTableLabel] = useState('Table 1')
  const [tablePage, setTablePage] = useState(0)
  const [userPlan, setUserPlan] = useState('')
  const [noteText, setNoteText] = useState('')
  const [noteVerification, setNoteVerification] = useState<'checked' | 'pending' | 'concern'>('pending')
  const [compareIds, setCompareIds] = useState<string[]>([])
  const [compareQuery, setCompareQuery] = useState({ task: '', dataset: '', metric: '' })
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
        setCompareIds(saved.papers.map((paper) => paper.id))
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
    try { window.localStorage.setItem('papernavigator.settings-open', settingsOpen ? 'yes' : 'no') }
    catch { /* The panel still works when browser storage is unavailable. */ }
  }, [settingsOpen])

  useEffect(() => {
    if (!selectedId && bundle.papers[0]) setSelectedId(bundle.papers[0].id)
    setCompareIds((current) => current.filter((id) => bundle.papers.some((paper) => paper.id === id)))
  }, [bundle.papers, selectedId])

  const selectedPaper = bundle.papers.find((paper) => paper.id === selectedId) ?? null
  const selectedDocument = selectedId ? documents[selectedId] ?? null : null
  const selectedComparePapers = bundle.papers.filter((paper) => compareIds.includes(paper.id))
  const rows = useMemo(() => comparisonRows(selectedComparePapers, compareQuery), [selectedComparePapers, compareQuery])
  const comparison = useMemo(() => compareRows(rows), [rows])
  const coCitations = useMemo(() => coCitationRows(bundle.papers), [bundle.papers])

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
    const text = `${stage}回傳格式不符，正在要求模型重做（${retry}/${maxRetries}）…`
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
          tableAnalyses: [], citations: [], evidence: [], observations: [], notes: [], highlights: [],
        })
      }
      if (nextPapers.length) {
        updateBundle((current) => ({ ...current, papers: [...current.papers, ...nextPapers] }))
        setDocuments((current) => ({ ...current, ...nextDocuments }))
        setSelectedId(nextPapers[0].id)
        setCompareIds((current) => [...new Set([...current, ...nextPapers.map((paper) => paper.id)])])
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

  const startJob = async (label: string, task: (signal: AbortSignal) => Promise<void>) => {
    if (!selectedPaper || !selectedDocument) { setError('請先選取並附上 PDF。'); return }
    if (!config.apiKey || !config.modelId) { setSettingsOpen(true); setError('請先輸入 API Key、測試連線並選擇模型。'); return }
    const controller = new AbortController()
    abortRef.current = controller
    setBusy(label)
    setError('')
    setMessage(`${label}。PDF 將傳送至所選 AI 服務；費用依目前帳號、模型與使用量而定。`)
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
      const response = await analyzePass3(config, selectedDocument!, selectedPaper.pass1!, selectedPaper.pass2!, userPlan, signal, handleFormatRetry)
      setLastUsage(response.usage)
      updatePaper(selectedPaper.id, (paper) => ({ ...paper, pass3: response.result, analysisModel: `${config.id}:${config.modelId}`, promptVersion: 'pass3.v1' }))
      setTab('pass3')
    })
  }

  const runTable = () => {
    if (tablePage < 0 || tablePage >= (selectedPaper?.pageCount ?? 0)) { setError('表格頁碼超出 PDF 範圍。'); return }
    void startJob('正在分析指定表格', async (signal) => {
      const response = await analyzeTable(config, selectedDocument!, selectedPaper!.id, tableLabel, tablePage, signal, handleFormatRetry)
      setLastUsage(response.usage)
      updatePaper(selectedPaper!.id, (paper) => ({
        ...paper, tableAnalyses: [...paper.tableAnalyses, response.result],
        observations: [...paper.observations, ...response.result.observations],
        evidence: [...paper.evidence, ...response.result.evidence],
      }))
    })
  }

  const analyzeRegion = async (dataUrl: string, targetPage: number) => {
    if (!config.apiKey || !config.modelId) throw new Error('請先設定並測試 AI 連線。')
    setBusy('正在分析圈選區域…')
    try { return await analyzeImageRegion(config, dataUrl, roiPrompt(targetPage, ''), undefined) }
    finally { setBusy('') }
  }

  const jumpToEvidence = (evidenceId: string) => {
    const evidence = selectedPaper?.evidence.find((item) => item.id === evidenceId)
    if (!evidence || evidence.pdfPageIndex === null) { setMessage('此來源沒有可跳轉的 PDF 頁碼。'); return }
    setPageIndex(evidence.pdfPageIndex)
    setMessage(evidence.verificationStatus === 'matched' ? '已跳至核對頁面。' : '已跳至 AI 指定頁面，但摘錄尚未核對。')
  }

  const removePaper = (paper: Paper) => {
    if (!window.confirm(`刪除「${paper.title ?? paper.filename}」及其分析、筆記與比較資料？`)) return
    updateBundle((current) => ({ ...current, papers: current.papers.filter((item) => item.id !== paper.id), comparisons: current.comparisons.map((item) => ({ ...item, paperIds: item.paperIds.filter((id) => id !== paper.id) })).filter((item) => item.paperIds.length >= 2) }))
    setDocuments((current) => { const next = { ...current }; delete next[paper.id]; return next })
    void deletePdfDocument(paper.id).catch(reportError)
    setSelectedId(bundle.papers.find((item) => item.id !== paper.id)?.id ?? '')
  }

  const addNote = () => {
    if (!selectedPaper || !noteText.trim()) return
    const now = new Date().toISOString()
    updatePaper(selectedPaper.id, (paper) => ({ ...paper, notes: [...paper.notes, { id: crypto.randomUUID(), paperId: paper.id, body: noteText.trim(), verification: noteVerification, createdAt: now, updatedAt: now }] }))
    setNoteText('')
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
      setCompareIds(imported.papers.map((paper) => paper.id))
      setMessage('專案已回復；JSON 備份不含 PDF 原檔，請逐篇重新附上。')
    } catch (value) { reportError(value) }
    finally { event.target.value = '' }
  }

  const verifyReference = async (paperId: string, citationId: string) => {
    setBusy('正在向 Crossref 核對 DOI')
    try {
      const paper = bundle.papers.find((item) => item.id === paperId)!
      const citation = paper.citations.find((item) => item.id === citationId)!
      const verified = await verifyCitation(citation)
      updatePaper(paperId, (item) => ({ ...item, citations: item.citations.map((row) => row.id === citationId ? verified : row) }))
      setMessage('引用已透過 Crossref DOI 紀錄核對。')
    } catch (value) { reportError(value) }
    finally { setBusy('') }
  }

  const shareProject = async () => {
    const text = `${bundle.project.name}\n${bundle.papers.map((paper) => `• ${paper.title ?? paper.filename}`).join('\n')}`
    try {
      if (navigator.share) await navigator.share({ title: bundle.project.name, text })
      else { await navigator.clipboard.writeText(text); setMessage('專案摘要已複製到剪貼簿。') }
    } catch (value) { if ((value as Error).name !== 'AbortError') reportError(value) }
  }

  return <div className={headerVisible ? 'app-shell' : 'app-shell header-collapsed'}>
    {headerVisible && <header className="topbar">
      <div className="brand-block">
        <div className="brand-mark">PN</div>
        <div><strong>PaperNavigator</strong><span>證據導向的 AI 論文閱讀器</span></div>
      </div>
      <div className="top-actions">
        <span className={navigator.onLine ? 'online-state' : 'online-state offline'}>{navigator.onLine ? '● 線上' : '● 離線'}</span>
        <button className="ghost-button" onClick={() => setHeaderVisible(false)}>隱藏標題列</button>
        <button className="ghost-button" onClick={() => setSettingsOpen((value) => !value)}>模型 / Key</button>
        <button className="ghost-button" onClick={() => exportProjectJson({ ...bundle, exportedAt: new Date().toISOString() })}>備份 JSON</button>
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
        <p><strong>本機保存：</strong>Provider、Base URL、模型與 API Key 會保留在此瀏覽器；PDF 原檔、分析與螢光標記保存在 IndexedDB。資料不會寫入 repository，共用電腦請使用紅色「清除設定」及專案清除功能。</p>
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

    <main className="workspace-layout">
      <aside className="library-panel">
        <div className="project-editor">
          <span className="eyebrow">RESEARCH PROJECT</span>
          <input className="project-name" value={bundle.project.name} onChange={(event) => updateBundle((current) => ({ ...current, project: { ...current.project, name: event.target.value } }))} aria-label="專案名稱" />
          <textarea value={bundle.project.researchQuestion} onChange={(event) => updateBundle((current) => ({ ...current, project: { ...current.project, researchQuestion: event.target.value } }))} placeholder="輸入你的研究問題（選填）" aria-label="研究問題" />
        </div>
        <div className="library-heading"><span>論文書架</span><span>{bundle.papers.length} / 10</span></div>
        <div className="paper-list">
          {bundle.papers.map((paper) => <button key={paper.id} className={paper.id === selectedId ? 'paper-item selected' : 'paper-item'} onClick={() => { setSelectedId(paper.id); setPageIndex(0); setTab('overview') }}>
            <span className="paper-index">{String(bundle.papers.indexOf(paper) + 1).padStart(2, '0')}</span>
            <span className="paper-copy"><strong>{paper.title ?? paper.filename}</strong><small>{paper.year ?? '年份未報告'} · {paper.pageCount} 頁</small><span className="pass-dots"><i className={paper.pass1 ? 'done' : ''}>1</i><i className={paper.pass2 ? 'done' : ''}>2</i><i className={paper.pass3 ? 'done' : ''}>3</i></span></span>
          </button>)}
          {!bundle.papers.length && <div className="empty-library"><span>＋</span><p>匯入第一篇研究論文</p><button className="small-button" onClick={() => fileRef.current?.click()}>選擇 PDF</button></div>}
        </div>
        <div className="library-footer">
          <button className="small-button full" onClick={() => fileRef.current?.click()}>＋ 加入論文</button>
          <div><button className="text-button" onClick={() => importRef.current?.click()}>匯入備份</button><button className="text-button" onClick={() => void shareProject()}>分享摘要</button></div>
          <input hidden ref={importRef} type="file" accept="application/json,.json" onChange={(event) => void importBackup(event)} />
        </div>
      </aside>

      <section className="content-panel">
        <nav className="tabbar" aria-label="閱讀階段">{TABS.map((item) => <button key={item.id} className={tab === item.id ? 'active' : ''} onClick={() => setTab(item.id)}>{item.label}<small>{item.phase}</small></button>)}</nav>
        {!selectedPaper ? <Welcome onUpload={() => fileRef.current?.click()} /> : <div className="content-scroll">
          <div className="paper-title-row"><div><span className="eyebrow">{selectedPaper.filename}</span><h1>{selectedPaper.title ?? '尚未擷取論文標題'}</h1><p>{selectedPaper.authors.join('、') || '作者未報告'}{selectedPaper.year ? ` · ${selectedPaper.year}` : ''}</p></div><div className="paper-actions"><button className="small-button" onClick={() => exportPaperMarkdown(selectedPaper)}>匯出報告</button><button className="danger-link" onClick={() => removePaper(selectedPaper)}>刪除</button></div></div>
          {!selectedDocument && <div className="reattach-banner"><div><strong>找不到已保存的原始 PDF</strong><p>可能是瀏覽器儲存空間已被清除。請選擇同一檔案，系統會用 SHA-256 核對並重新保存。</p></div><button className="secondary-button" onClick={() => reattachRef.current?.click()}>重新附檔</button><input ref={reattachRef} hidden type="file" accept="application/pdf,.pdf" onChange={(event) => void reattach(event.target.files?.[0])} /></div>}
          {tab === 'overview' && <Overview paper={selectedPaper} document={selectedDocument} onPass1={runPass1} onPass2={runPass2} onPass3={runPass3} onJump={(page) => setPageIndex(page)} />}
          {tab === 'pass1' && <Pass1View paper={selectedPaper} onRun={runPass1} onEvidence={jumpToEvidence} />}
          {tab === 'pass2' && <Pass2View paper={selectedPaper} onRun={runPass2} onEvidence={jumpToEvidence} onTable={(label, page) => { setTableLabel(label); setTablePage(page ?? 0); setPageIndex(page ?? 0); setTab('tables') }} />}
          {tab === 'tables' && <TablesView paper={selectedPaper} label={tableLabel} page={tablePage} setLabel={setTableLabel} setPage={setTablePage} onRun={runTable} onJump={setPageIndex} />}
          {tab === 'pass3' && <Pass3View paper={selectedPaper} userPlan={userPlan} setUserPlan={setUserPlan} onRun={runPass3} />}
          {tab === 'compare' && <CompareView papers={bundle.papers} selectedIds={compareIds} setSelectedIds={setCompareIds} query={compareQuery} setQuery={setCompareQuery} rows={rows} comparison={comparison} onExport={() => exportComparisonCsv(selectedComparePapers)} onSelectPaper={(id: string, page: number | null) => { setSelectedId(id); setPageIndex(page ?? 0) }} />}
          {tab === 'research' && <ResearchView papers={bundle.papers} coCitations={coCitations} onVerify={(paperId: string, citationId: string) => void verifyReference(paperId, citationId)} onBib={() => exportBibTeX(bundle.papers)} onRis={() => exportRis(bundle.papers)} />}
          {tab === 'notes' && <NotesView paper={selectedPaper} text={noteText} setText={setNoteText} verification={noteVerification} setVerification={setNoteVerification} onAdd={addNote} onDelete={(id: string) => updatePaper(selectedPaper.id, (paper) => ({ ...paper, notes: paper.notes.filter((note) => note.id !== id) }))} onMarkdown={() => exportPaperMarkdown(selectedPaper)} onJson={() => exportProjectJson({ ...bundle, exportedAt: new Date().toISOString() })} onClear={() => { if (window.confirm('清除瀏覽器中的整個專案？請先匯出 JSON 備份。')) void clearBundle().then(() => { setBundle(emptyBundle()); setDocuments({}); setSelectedId('') }) }} />}
        </div>}
      </section>
      <PdfViewer
        document={selectedDocument}
        paperId={selectedPaper?.id ?? ''}
        pageIndex={pageIndex}
        highlights={selectedPaper?.highlights ?? []}
        onPageChange={setPageIndex}
        onAnalyzeRegion={analyzeRegion}
        onAddHighlight={(highlight: PdfHighlight) => selectedPaper && updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: [...paper.highlights, highlight] }))}
        onDeleteHighlight={(id: string) => selectedPaper && updatePaper(selectedPaper.id, (paper) => ({ ...paper, highlights: paper.highlights.filter((highlight) => highlight.id !== id) }))}
      />
    </main>
  </div>
}

function Welcome({ onUpload }: { onUpload: () => void }) {
  return <div className="welcome"><div className="welcome-symbol">∿</div><span className="eyebrow">EVIDENCE FIRST</span><h1>從鳥瞰，到能回到原文的理解</h1><p>PaperNavigator 依三遍閱讀法拆開閱讀深度。每個重要事實都保留來源頁碼與核對狀態，避免把 AI 摘要當成論文本身。</p><button className="primary-button" onClick={onUpload}>匯入第一篇 PDF</button><div className="welcome-steps"><div><span>01</span><strong>鳥瞰五個 C</strong><p>先決定值不值得讀</p></div><div><span>02</span><strong>方法與證據</strong><p>拆解圖表與實驗</p></div><div><span>03</span><strong>重建與批判</strong><p>找出缺失與新問題</p></div></div></div>
}

function Overview({ paper, document, onPass1, onPass2, onPass3, onJump }: { paper: Paper; document: PdfDocumentData | null; onPass1: () => void; onPass2: () => void; onPass3: () => void; onJump: (page: number) => void }) {
  return <div className="section-stack"><div className="metric-grid"><article><span>PDF 頁數</span><strong>{paper.pageCount}</strong><small>{formatBytes(paper.size)}</small></article><article><span>來源核對</span><strong>{paper.evidence.filter((item) => item.verificationStatus === 'matched').length}<em> / {paper.evidence.length}</em></strong><small>已定位摘錄</small></article><article><span>結果觀測</span><strong>{paper.observations.length}</strong><small>保留原始數值</small></article><article><span>閱讀進度</span><strong>{paper.pass3 ? '3 / 3' : paper.pass2 ? '2 / 3' : paper.pass1 ? '1 / 3' : '0 / 3'}</strong><small>三遍閱讀法</small></article></div>
    {document?.warnings.map((warning) => <div className="warning-card" key={warning}>△ {warning}</div>)}
    <div className="stage-grid"><article className={paper.pass1 ? 'stage-card complete' : 'stage-card'}><span>第一遍 · 鳥瞰</span><h2>五個 C 與閱讀決策</h2><p>擷取研究問題、主要貢獻與值得繼續閱讀的理由。</p><button className="primary-button" disabled={!document} onClick={onPass1}>{paper.pass1 ? '重新分析第一遍' : '開始第一遍'}</button></article><article className={paper.pass2 ? 'stage-card complete' : 'stage-card'}><span>第二遍 · 理解</span><h2>方法、實驗與表格</h2><p>只在你決定深入後啟動，避免一次產生全部 API 用量。</p><button className="secondary-button" disabled={!document || !paper.pass1} onClick={onPass2}>{paper.pass2 ? '重新分析第二遍' : '深入第二遍'}</button></article><article className={paper.pass3 ? 'stage-card complete' : 'stage-card'}><span>第三遍 · 重建</span><h2>假設、風險與研究題目</h2><p>標示明確提供、作者隱含與缺少資訊，不宣稱已重現。</p><button className="secondary-button" disabled={!document || !paper.pass2} onClick={onPass3}>{paper.pass3 ? '重新分析第三遍' : '進入第三遍'}</button></article></div>
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

function Pass2View({ paper, onRun, onEvidence, onTable }: { paper: Paper; onRun: () => void; onEvidence: (id: string) => void; onTable: (label: string, page: number | null) => void }) {
  const data = paper.pass2
  if (!data) return <EmptyAnalysis title="第二遍尚未分析" text="完成第一遍後，再擷取方法、實驗設計、圖表與逐筆結果。" action="深入第二遍" onRun={onRun} disabled={!paper.pass1} />
  return <div className="section-stack"><div className="section-title"><div><span className="eyebrow">METHOD & EVIDENCE</span><h2>方法與實驗設計</h2></div><button className="small-button" onClick={onRun}>重新分析</button></div><div className="two-column"><section className="content-card"><h3>研究動機</h3><p>{data.motivation}</p><h3>問題定義</h3><p>{data.problemDefinition}</p><h3>輸入與輸出</h3><p>{data.inputOutput}</p></section><section className="content-card"><h3>方法流程</h3><ol className="method-steps">{data.methodSteps.map((item, index) => <li key={item}><span>{index + 1}</span><p>{item}</p></li>)}</ol></section></div><section className="content-card"><h3>資料集與評估</h3><div className="data-table-wrap"><table><thead><tr><th>資料集</th><th>版本／規模</th><th>Split</th><th>外部驗證</th><th>洩漏風險</th><th>狀態</th></tr></thead><tbody>{data.datasets.map((item, index) => <tr key={`${item.name}-${index}`}><td>{item.name}</td><td>{[item.version, item.size].filter(Boolean).join(' · ') || '未報告'}</td><td>{item.split ?? '未報告'}</td><td>{item.externalValidation ?? '未報告'}</td><td>{item.leakageRisk ?? '未報告'}</td><td><span className={`status-pill ${item.status}`}>{item.status}</span><EvidenceButtons ids={item.evidenceIds} paper={paper} onEvidence={onEvidence} /></td></tr>)}</tbody></table></div></section><section className="content-card"><h3>Figure / Table 索引</h3><div className="index-list">{[...data.tables, ...data.figures].map((item) => <button key={`${item.label}-${item.pdfPageIndex}`} onClick={() => onTable(item.label, item.pdfPageIndex)}><strong>{item.label}</strong><span>{item.title}<small>{item.interpretation}</small></span><b>{item.pdfPageIndex === null ? '?' : `p.${item.pdfPageIndex + 1}`}</b></button>)}</div></section><section className="content-card"><h3>作者主張 → 證據 → 限制</h3><div className="claim-list">{data.claims.map((item, index) => <article key={`${item.claim}-${index}`}><strong>{item.claim}</strong><p><b>證據：</b>{item.support}</p><p><b>限制：</b>{item.limitation}</p><EvidenceButtons ids={item.evidenceIds} paper={paper} onEvidence={onEvidence} /></article>)}</div></section><details className="guide-questions"><summary>學生引導問題（先思考再展開）</summary><ol>{data.guideQuestions.map((item) => <li key={item}>{item}</li>)}</ol></details></div>
}

function TablesView({ paper, label, page, setLabel, setPage, onRun, onJump }: { paper: Paper; label: string; page: number; setLabel: (value: string) => void; setPage: (value: number) => void; onRun: () => void; onJump: (value: number) => void }) {
  return <div className="section-stack"><section className="analysis-control"><div><span className="eyebrow">THREE-STEP TABLE ANALYSIS</span><h2>指定表格分析</h2><p>先抽取原始格內容，再分析本文所報告的最佳值、trade-offs 與 limitations。</p></div><div className="inline-form"><label>Table / Figure<input value={label} onChange={(event) => setLabel(event.target.value)} /></label><label>PDF 實體頁<input type="number" min={1} max={paper.pageCount} value={page + 1} onChange={(event) => setPage(Math.max(0, Number(event.target.value) - 1))} /></label><button className="primary-button" onClick={onRun}>抽取並分析</button></div></section>{paper.tableAnalyses.length === 0 ? <EmptyAnalysis title="尚未分析指定表格" text="可從第二遍的圖表索引帶入，或手動輸入標號與 PDF 實體頁。" /> : paper.tableAnalyses.map((analysis) => <section className="content-card table-analysis" key={analysis.id}><div className="card-heading"><div><span className="eyebrow">{analysis.label} · PDF p.{analysis.pdfPageIndex + 1}</span><h2>{analysis.title}</h2></div><button className="small-button" onClick={() => onJump(analysis.pdfPageIndex)}>看原文</button></div><div className="data-table-wrap"><table><thead><tr>{analysis.columns.map((column) => <th key={column}>{column}</th>)}</tr></thead><tbody>{analysis.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, cellIndex) => <td key={cellIndex} className={cell.emphasized ? 'emphasized' : ''}>{cell.raw}</td>)}</tr>)}</tbody></table></div>{analysis.footnotes.length > 0 && <p className="table-footnotes">表註：{analysis.footnotes.join('；')}</p>}<div className="three-step-grid"><article><span>A</span><h3>SOTA 與定位</h3><ul>{analysis.positioning.map((item) => <li key={item}>{item}</li>)}</ul></article><article><span>B</span><h3>Trade-offs</h3><ul>{analysis.tradeoffs.map((item) => <li key={item}>{item}</li>)}</ul></article><article><span>C</span><h3>Limitations / Ablation</h3><ul>{analysis.limitations.map((item) => <li key={item}>{item}</li>)}</ul></article></div></section>)}</div>
}

function Pass3View({ paper, userPlan, setUserPlan, onRun }: { paper: Paper; userPlan: string; setUserPlan: (value: string) => void; onRun: () => void }) {
  const data = paper.pass3
  return <div className="section-stack"><section className="analysis-control"><div><span className="eyebrow">VIRTUAL RECONSTRUCTION</span><h2>第三遍：重建與批判</h2><p>這是紙上重建，不代表系統已執行程式、訓練模型或驗證可重現性。</p></div><div className="reimplementation"><label>如果由我重新實作，我會怎麼做？<textarea value={userPlan} onChange={(event) => setUserPlan(event.target.value)} placeholder="先寫下自己的方案，再與 AI 建議並列…" /></label><button className="primary-button" disabled={!paper.pass2} onClick={onRun}>{data ? '重新分析第三遍' : '產生重建清單'}</button></div></section>{!data ? <EmptyAnalysis title="尚未進入第三遍" text="先完成第二遍，並寫下自己的重建思路。" /> : <><section className="content-card"><h2>重建程序</h2><div className="reconstruction-list">{data.reconstruction.map((item, index) => <article key={`${item.step}-${index}`}><span>{String(index + 1).padStart(2, '0')}</span><div><h3>{item.step}<i className={`recon-status ${item.status}`}>{item.status}</i></h3><p>{item.detail}</p></div></article>)}</div></section><div className="two-column"><CriticalList title="隱藏假設" items={data.assumptions} /><CriticalList title="效度威脅" items={data.threats} /><CriticalList title="可重現風險" items={data.reproducibilityRisks} /></div><section><div className="section-title"><div><span className="eyebrow">AI-GENERATED, TESTABLE</span><h2>後續研究題目</h2></div></div><div className="idea-grid">{data.researchIdeas.map((item, index) => <article key={item.question}><span>IDEA {index + 1}</span><h3>{item.question}</h3><p><b>動機：</b>{item.motivation}</p><p><b>假設：</b>{item.hypothesis}</p><p><b>最小實驗：</b>{item.minimumExperiment}</p><p><b>資料／指標：</b>{item.requiredData} · {item.metric}</p></article>)}</div></section></>}</div>
}

function CriticalList({ title, items }: { title: string; items: Array<{ title: string; assessment: string; status: string }> }) {
  return <section className="content-card"><h2>{title}</h2><div className="critical-list">{items.map((item) => <article key={item.title}><strong>{item.title}</strong><span className={`status-pill ${item.status}`}>{item.status}</span><p>{item.assessment}</p></article>)}</div></section>
}

interface CompareViewProps {
  papers: Paper[]
  selectedIds: string[]
  setSelectedIds: Dispatch<SetStateAction<string[]>>
  query: { task: string; dataset: string; metric: string }
  setQuery: Dispatch<SetStateAction<{ task: string; dataset: string; metric: string }>>
  rows: ComparisonRow[]
  comparison: ReturnType<typeof compareRows>
  onExport: () => void
  onSelectPaper: (id: string, page: number | null) => void
}

function CompareView({ papers, selectedIds, setSelectedIds, query, setQuery, rows, comparison, onExport, onSelectPaper }: CompareViewProps) {
  return <div className="section-stack"><section className="analysis-control compare-control"><div><span className="eyebrow">FAIR COMPARISON</span><h2>跨篇比較工作台</h2><p>先核對 task、dataset、split、metric definition 與 protocol，再決定是否可排名。</p></div><button className="secondary-button" disabled={!rows.length} onClick={onExport}>匯出 CSV</button></section><div className="paper-selector">{papers.map((paper) => <label key={paper.id}><input type="checkbox" checked={selectedIds.includes(paper.id)} onChange={() => setSelectedIds((current) => current.includes(paper.id) ? current.filter((id) => id !== paper.id) : current.length < 10 ? [...current, paper.id] : current)} />{paper.title ?? paper.filename}</label>)}</div><div className="filter-row"><input value={query.task} onChange={(event) => setQuery({ ...query, task: event.target.value })} placeholder="篩選 task" /><input value={query.dataset} onChange={(event) => setQuery({ ...query, dataset: event.target.value })} placeholder="篩選 dataset" /><input value={query.metric} onChange={(event) => setQuery({ ...query, metric: event.target.value })} placeholder="篩選 metric" /></div><div className={comparison.globallyComparable ? 'comparison-notice comparable' : 'comparison-notice'}><strong>{comparison.globallyComparable ? '可在此分組直接比較' : '不顯示全體第一名'}</strong><span>{comparison.reason}</span></div><section className="content-card"><div className="data-table-wrap"><table className="comparison-table"><thead><tr><th>論文</th><th>方法／來源</th><th>Task</th><th>Dataset / Split</th><th>Metric</th><th>原始結果</th><th>Pretraining / Hardware</th><th>來源</th></tr></thead><tbody>{rows.map((row) => <tr key={`${row.paper.id}-${row.observation.id}`}><td>{row.paper.title ?? row.paper.filename}</td><td>{row.observation.methodName}<small>{row.observation.methodOrigin}</small></td><td>{row.observation.task}</td><td>{row.observation.dataset ?? '未報告'}<small>{row.observation.split ?? 'split 未報告'}</small></td><td>{row.observation.metricName}<small>{row.observation.metricDefinition ?? '定義未報告'}</small></td><td><strong>{row.observation.rawValue || '未報告'}</strong></td><td>{row.observation.pretrainedData ?? '未報告'}<small>{row.observation.hardware ?? '硬體未報告'}</small></td><td><button className="evidence-chip unverified" onClick={() => onSelectPaper(row.paper.id, null)}>查看</button></td></tr>)}</tbody></table>{!rows.length && <p className="table-empty">選取至少兩篇已完成第二遍分析的論文。</p>}</div></section>{comparison.pairs.length > 0 && <section className="content-card"><h2>成對公平性檢查</h2><div className="pair-list">{comparison.pairs.map((pair, index) => <article key={index}><span className={`comparability ${pair.assessment.label}`}>{pair.assessment.label}</span><strong>{pair.current.paper.title ?? pair.current.paper.filename} vs {pair.baseline.paper.title ?? pair.baseline.paper.filename}</strong><p>{pair.assessment.reasons.join('；')}</p>{pair.delta && <p>絕對差：{pair.delta.absolute.toFixed(4)}；相對變化：{pair.delta.relativePercent === null ? '基準為 0，無法計算' : `${pair.delta.relativePercent.toFixed(2)}%`}{pair.current.observation.unit === '%' ? `；percentage points：${pair.delta.absolute.toFixed(2)}` : ''}</p>}</article>)}</div></section>}</div>
}

interface ResearchViewProps {
  papers: Paper[]
  coCitations: ReturnType<typeof coCitationRows>
  onVerify: (paperId: string, citationId: string) => void
  onBib: () => void
  onRis: () => void
}

function ResearchView({ papers, coCitations, onVerify, onBib, onRis }: ResearchViewProps) {
  return <div className="section-stack"><section className="analysis-control"><div><span className="eyebrow">RESEARCH EXTENSIONS</span><h2>引用管理與共引線索</h2><p>從已上傳論文的 references 建立待驗證清單；有 DOI 時可向 Crossref 核對書目，但不把未上傳全文視為已讀。</p></div><div><button className="small-button" onClick={onBib}>BibTeX</button><button className="small-button" onClick={onRis}>RIS</button></div></section><section className="content-card"><h2>共引線索</h2><div className="citation-network">{coCitations.filter((item) => item.count >= 2).map((item) => <article key={item.citation.id}><span>{item.count} 篇共同引用</span><strong>{item.citation.title ?? item.citation.raw}</strong><small>{item.citation.authors.join('、')} {item.citation.year ?? ''}</small></article>)}{!coCitations.some((item) => item.count >= 2) && <p>目前尚未找到兩篇以上論文共同引用的條目。</p>}</div></section>{papers.map((paper) => <section className="content-card" key={paper.id}><h3>{paper.title ?? paper.filename}</h3><div className="reference-list">{paper.citations.map((citation) => <article key={citation.id}><div><strong>{citation.title ?? citation.raw}</strong><p>{citation.authors.join('、') || '作者待確認'} · {citation.year ?? '年份待確認'} · {citation.doi ?? '無 DOI'}</p></div><span className={`status-pill ${citation.verification}`}>{citation.verification === 'externally_verified' ? 'Crossref 已核對' : '本文引用／待驗證'}</span>{citation.doi && citation.verification !== 'externally_verified' && <button className="small-button" onClick={() => onVerify(paper.id, citation.id)}>核對 DOI</button>}</article>)}{!paper.citations.length && <p>完成第二遍後會在此列出 references。</p>}</div></section>)}</div>
}

interface NotesViewProps {
  paper: Paper
  text: string
  setText: (value: string) => void
  verification: 'checked' | 'pending' | 'concern'
  setVerification: (value: 'checked' | 'pending' | 'concern') => void
  onAdd: () => void
  onDelete: (id: string) => void
  onMarkdown: () => void
  onJson: () => void
  onClear: () => void
}

function NotesView({ paper, text, setText, verification, setVerification, onAdd, onDelete, onMarkdown, onJson, onClear }: NotesViewProps) {
  return <div className="section-stack"><section className="content-card"><div className="card-heading"><div><span className="eyebrow">YOUR ANNOTATIONS</span><h2>個人筆記</h2></div></div><textarea className="note-input" value={text} onChange={(event) => setText(event.target.value)} placeholder="記錄疑問、驗證結果或自己的推論；不會覆蓋 AI 原始輸出。" /><div className="note-actions"><select value={verification} onChange={(event) => setVerification(event.target.value as 'checked' | 'pending' | 'concern')}><option value="pending">待查證</option><option value="checked">已查原文</option><option value="concern">有疑慮</option></select><button className="primary-button compact" disabled={!text.trim()} onClick={onAdd}>加入筆記</button></div><div className="notes-list">{paper.notes.map((note) => <article key={note.id}><span className={`note-state ${note.verification}`}>{note.verification === 'checked' ? '已查原文' : note.verification === 'concern' ? '有疑慮' : '待查證'}</span><p>{note.body}</p><button className="danger-link" onClick={() => onDelete(note.id)}>刪除</button></article>)}</div></section><section className="content-card"><h2>匯出與資料管理</h2><div className="export-grid"><button onClick={onMarkdown}><strong>Markdown 閱讀報告</strong><span>單篇三遍分析、證據與筆記</span></button><button onClick={onJson}><strong>完整專案 JSON</strong><span>含 schemaVersion，可回復匯入</span></button><button onClick={onClear} className="destructive"><strong>清除本機專案</strong><span>會一併刪除瀏覽器內保存的 PDF 原檔</span></button></div><p className="fine-print">所有匯出均排除 API Key 與 PDF 原檔。CSV 匯出會防止試算表公式注入。</p></section></div>
}

function EmptyAnalysis({ title, text, action, onRun, disabled }: { title: string; text: string; action?: string; onRun?: () => void; disabled?: boolean }) {
  return <div className="empty-analysis"><span>◇</span><h2>{title}</h2><p>{text}</p>{action && onRun && <button className="primary-button" disabled={disabled} onClick={onRun}>{action}</button>}</div>
}
