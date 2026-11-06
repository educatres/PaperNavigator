import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AiRegionSummary, PdfDocumentData, PdfHighlight, PdfHighlightColor } from '../../domain/types'
import { cropCanvas, openPdf, renderPdfPage } from '../../pdf/pdfClient'

interface Props {
  document: PdfDocumentData | null
  paperId: string
  pageIndex: number
  highlights: PdfHighlight[]
  onPageChange: (pageIndex: number) => void
  onAnalyzeRegion: (dataUrl: string, pageIndex: number) => Promise<string>
  onAddAiRegionSummary: (summary: AiRegionSummary) => void
  onAddHighlight: (highlight: PdfHighlight) => void
  onDeleteHighlight: (id: string) => void
}

interface Rect { x: number; y: number; width: number; height: number }
type PdfTool = 'browse' | 'highlight' | 'erase' | 'roi'

const highlightColors: Record<PdfHighlightColor, string> = {
  yellow: 'rgba(246, 211, 73, .46)',
  green: 'rgba(87, 190, 137, .42)',
  pink: 'rgba(234, 125, 160, .42)',
  blue: 'rgba(153, 204, 238, .48)',
}

const colorLabels: Record<PdfHighlightColor, string> = { yellow: '黃', green: '綠', pink: '粉紅', blue: '淺藍' }

export function PdfViewer({ document, paperId, pageIndex, highlights, onPageChange, onAnalyzeRegion, onAddAiRegionSummary, onAddHighlight, onDeleteHighlight }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [renderError, setRenderError] = useState('')
  const [tool, setTool] = useState<PdfTool>('browse')
  const [color, setColor] = useState<PdfHighlightColor>('yellow')
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [roiResult, setRoiResult] = useState('')
  const [roiBusy, setRoiBusy] = useState(false)

  useEffect(() => {
    let active = true
    let opened: PDFDocumentProxy | null = null
    setPdf(null)
    if (textLayerRef.current) textLayerRef.current.replaceChildren()
    setSelection(null)
    setRoiResult('')
    if (!document) return
    openPdf(document.bytes).then((value) => {
      opened = value
      if (active) setPdf(value)
      else void value.cleanup()
    }).catch((error) => setRenderError(error instanceof Error ? error.message : String(error)))
    return () => { active = false; if (opened) void opened.cleanup() }
  }, [document])

  useEffect(() => {
    if (!pdf || !canvasRef.current || !viewportRef.current) return
    setRenderError('')
    setSelection(null)
    const width = Math.max(320, viewportRef.current.clientWidth - 28)
    renderPdfPage(pdf, Math.min(pdf.numPages, pageIndex + 1), canvasRef.current, width, textLayerRef.current ?? undefined)
      .catch((error) => setRenderError(error instanceof Error ? error.message : String(error)))
  }, [pdf, pageIndex])

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = canvasRef.current!.getBoundingClientRect()
    return {
      // The ROI overlay uses CSS pixels; the HTML canvas backing-store size can
      // be larger on high-DPI displays and must not be used for this geometry.
      x: Math.max(0, Math.min(bounds.width, event.clientX - bounds.left)),
      y: Math.max(0, Math.min(bounds.height, event.clientY - bounds.top)),
      maxX: bounds.width,
      maxY: bounds.height,
    }
  }

  const rectTo = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return null
    const value = point(event)
    return {
      rect: { x: Math.min(dragStart.x, value.x), y: Math.min(dragStart.y, value.y), width: Math.abs(value.x - dragStart.x), height: Math.abs(value.y - dragStart.y) },
      maxX: value.maxX,
      maxY: value.maxY,
    }
  }

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'roi' || !canvasRef.current || event.button !== 0) return
    const value = point(event)
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart({ x: value.x, y: value.y })
    setSelection({ x: value.x, y: value.y, width: 0, height: 0 })
  }

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    const next = rectTo(event)
    if (!next) return
    event.preventDefault()
    setSelection(next.rect)
  }

  const end = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'roi') return
    const next = rectTo(event)
    if (!next) return
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setDragStart(null)
    setSelection(next.rect)
  }

  const highlightSelection = () => {
    if (tool !== 'highlight' || !textLayerRef.current || !canvasRef.current) return
    const current = window.getSelection()
    if (!current || current.isCollapsed || current.rangeCount === 0) return
    const range = current.getRangeAt(0)
    if (!textLayerRef.current.contains(range.commonAncestorContainer)) return
    const stage = canvasRef.current.getBoundingClientRect()
    const rects = Array.from(range.getClientRects())
      .map((rect) => ({
        x: Math.max(stage.left, rect.left), y: Math.max(stage.top, rect.top),
        right: Math.min(stage.right, rect.right), bottom: Math.min(stage.bottom, rect.bottom),
      }))
      .filter((rect) => rect.right - rect.x >= 2 && rect.bottom - rect.y >= 2)
    for (const rect of rects) {
      onAddHighlight({
        id: crypto.randomUUID(), paperId, pdfPageIndex: pageIndex,
        x: (rect.x - stage.left) / stage.width, y: (rect.y - stage.top) / stage.height,
        width: (rect.right - rect.x) / stage.width, height: (rect.bottom - rect.y) / stage.height,
        color, text: current.toString().trim() || undefined, createdAt: new Date().toISOString(),
      })
    }
    current.removeAllRanges()
  }

  const analyze = async () => {
    if (!canvasRef.current || !selection || selection.width < 10 || selection.height < 10) return
    setRoiBusy(true)
    setRoiResult('')
    try {
      const summary = await onAnalyzeRegion(cropCanvas(canvasRef.current, selection), pageIndex)
      setRoiResult(summary)
      if (summary.trim()) onAddAiRegionSummary({ id: crypto.randomUUID(), paperId, pdfPageIndex: pageIndex, summary: summary.trim(), createdAt: new Date().toISOString() })
    } catch (error) { setRoiResult(error instanceof Error ? error.message : String(error)) }
    finally { setRoiBusy(false) }
  }

  const switchTool = (next: PdfTool) => {
    setTool((current) => current === next ? 'browse' : next)
    setDragStart(null)
    setSelection(null)
  }

  if (!document) return <aside className="pdf-panel empty-viewer"><div><span className="empty-icon">⌁</span><h2>原文檢視器</h2><p>選取論文後可逐頁檢視、文字標記與 AI 圈選。</p></div></aside>

  const pageHighlights = highlights.filter((highlight) => highlight.pdfPageIndex === pageIndex)

  return <aside className="pdf-panel" aria-label="PDF 原文檢視器">
    <div className="pdf-toolbar">
      <div>
        <strong>原文 PDF</strong>
        <span>{pageIndex + 1} / {document.pageCount} · {pageHighlights.length} 個標記</span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-button" onClick={() => onPageChange(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0} aria-label="上一頁">←</button>
        <button className="icon-button" onClick={() => onPageChange(Math.min(document.pageCount - 1, pageIndex + 1))} disabled={pageIndex + 1 >= document.pageCount} aria-label="下一頁">→</button>
        <button className={tool === 'highlight' ? 'small-button active' : 'small-button'} onClick={() => switchTool('highlight')} aria-pressed={tool === 'highlight'}>螢光筆</button>
        <button className={tool === 'erase' ? 'small-button active' : 'small-button'} onClick={() => switchTool('erase')} aria-pressed={tool === 'erase'}>刪除標記</button>
        <button className={tool === 'roi' ? 'small-button active' : 'small-button'} onClick={() => switchTool('roi')} aria-pressed={tool === 'roi'}>AI 圈選</button>
      </div>
    </div>
    <div className={`pdf-viewport mode-${tool}`} ref={viewportRef}>
      <div className="pdf-canvas-stage" onPointerDown={begin} onPointerMove={move} onPointerUp={(event) => { end(event); highlightSelection() }} onPointerCancel={() => { setDragStart(null); setSelection(null) }}>
        <canvas ref={canvasRef} />
        <div ref={textLayerRef} className="pdf-text-layer" aria-label="PDF 文字層" />
        {pageHighlights.map((highlight) => <button
          key={highlight.id}
          className={tool === 'erase' ? 'pdf-highlight erase-ready' : 'pdf-highlight'}
          aria-label={tool === 'erase' ? '刪除此螢光標記' : 'PDF 螢光標記'}
          title={tool === 'erase' ? '點一下刪除標記' : '螢光標記'}
          onClick={(event) => { event.stopPropagation(); if (tool === 'erase') onDeleteHighlight(highlight.id) }}
          style={{ left: `${highlight.x * 100}%`, top: `${highlight.y * 100}%`, width: `${highlight.width * 100}%`, height: `${highlight.height * 100}%`, background: highlightColors[highlight.color] }}
        />)}
        {selection && tool === 'roi' && <div className="roi-selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}
      </div>
      {renderError && <p className="inline-error">{renderError}</p>}
    </div>
    {tool === 'highlight' && <div className="pdf-annotation-actions">
      <p>用滑鼠或觸控選取文字後套用螢光標記；標記會隨專案自動保存。</p>
      <div className="highlight-palette" aria-label="螢光筆顏色">{(Object.keys(highlightColors) as PdfHighlightColor[]).map((item) => <button key={item} aria-label={`${colorLabels[item]}色螢光筆`} title={`${colorLabels[item]}色`} className={color === item ? 'active' : ''} style={{ background: highlightColors[item] }} onClick={() => setColor(item)} />)}</div>
    </div>}
    {tool === 'erase' && <div className="pdf-annotation-actions erase-hint"><p>點選頁面上的螢光標記即可刪除，不會影響分析或筆記。</p></div>}
    {tool === 'roi' && <div className="roi-actions">
      <p>拖曳框選 Figure／Table，再請 AI 針對區域解讀；摘要會保存到「筆記與匯出」。</p>
      <button className="small-button" disabled={!selection || roiBusy} onClick={analyze}>{roiBusy ? '分析中…' : '分析圈選區域'}</button>
      {roiResult && <div className="roi-result">{roiResult}</div>}
    </div>}
  </aside>
}
