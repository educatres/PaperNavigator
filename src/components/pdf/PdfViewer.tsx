import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { AiRegionSummary, PdfDocumentData, PdfHighlight, PdfHighlightColor, PdfHighlightRect } from '../../domain/types'
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
type PdfTool = 'browse' | 'pan' | 'highlight' | 'erase' | 'roi'
type Zoom = 'fit' | number

const highlightColors: Record<PdfHighlightColor, string> = {
  yellow: 'rgba(246, 211, 73, .46)',
  green: 'rgba(87, 190, 137, .42)',
  pink: 'rgba(234, 125, 160, .42)',
  blue: 'rgba(153, 204, 238, .48)',
}

const colorLabels: Record<PdfHighlightColor, string> = { yellow: '黃', green: '綠', pink: '粉紅', blue: '淺藍' }
const pageRects = (highlight: PdfHighlight): PdfHighlightRect[] => highlight.rects?.length ? highlight.rects : [{ x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }]

export function PdfViewer({ document, paperId, pageIndex, highlights, onPageChange, onAnalyzeRegion, onAddAiRegionSummary, onAddHighlight, onDeleteHighlight }: Props) {
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const pageNodes = useRef<Record<number, HTMLDivElement | null>>({})
  const visiblePage = useRef(pageIndex)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [renderError, setRenderError] = useState('')
  const [tool, setTool] = useState<PdfTool>('browse')
  const [color, setColor] = useState<PdfHighlightColor>('yellow')
  const [zoom, setZoom] = useState<Zoom>('fit')
  const [viewportWidth, setViewportWidth] = useState(720)
  const panStart = useRef<{ x: number; y: number; scrollLeft: number; scrollTop: number } | null>(null)
  const [isPanning, setIsPanning] = useState(false)

  useEffect(() => {
    let active = true
    let opened: PDFDocumentProxy | null = null
    setPdf(null)
    setRenderError('')
    pageNodes.current = {}
    visiblePage.current = -1
    if (!document) return
    openPdf(document.bytes).then((value) => {
      opened = value
      if (active) setPdf(value)
      else void value.cleanup()
    }).catch((error) => setRenderError(error instanceof Error ? error.message : String(error)))
    return () => { active = false; if (opened) void opened.cleanup() }
  }, [document])

  useEffect(() => {
    const viewport = viewportRef.current
    if (!viewport) return
    const updateWidth = () => setViewportWidth(Math.max(320, Math.floor(viewport.clientWidth)))
    updateWidth()
    const observer = typeof ResizeObserver === 'undefined' ? null : new ResizeObserver(updateWidth)
    observer?.observe(viewport)
    return () => observer?.disconnect()
  }, [document])

  useEffect(() => {
    const node = pageNodes.current[pageIndex]
    if (!node || visiblePage.current === pageIndex) return
    visiblePage.current = pageIndex
    node.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }, [pageIndex, pdf])

  const handleScroll = (event: React.UIEvent<HTMLDivElement>) => {
    const viewport = event.currentTarget
    const center = viewport.getBoundingClientRect().top + viewport.clientHeight / 2
    let closest = visiblePage.current
    let distance = Number.POSITIVE_INFINITY
    for (const [key, node] of Object.entries(pageNodes.current)) {
      if (!node) continue
      const rect = node.getBoundingClientRect()
      const nextDistance = Math.abs(rect.top + rect.height / 2 - center)
      if (nextDistance < distance) { distance = nextDistance; closest = Number(key) }
    }
    if (closest !== visiblePage.current) {
      visiblePage.current = closest
      onPageChange(closest)
    }
  }

  const switchTool = (next: PdfTool) => setTool((current) => current === next ? 'browse' : next)
  const zoomIn = () => setZoom((current) => current === 'fit' ? 1.25 : Math.min(3, Number((current + 0.25).toFixed(2))))
  const zoomOut = () => setZoom((current) => current === 'fit' ? 0.75 : Math.max(0.5, Number((current - 0.25).toFixed(2))))
  const beginPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'pan' || event.button !== 0) return
    const viewport = event.currentTarget
    panStart.current = { x: event.clientX, y: event.clientY, scrollLeft: viewport.scrollLeft, scrollTop: viewport.scrollTop }
    setIsPanning(true)
    viewport.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const movePan = (event: React.PointerEvent<HTMLDivElement>) => {
    const start = panStart.current
    if (!start || tool !== 'pan') return
    const viewport = event.currentTarget
    viewport.scrollLeft = start.scrollLeft - (event.clientX - start.x)
    viewport.scrollTop = start.scrollTop - (event.clientY - start.y)
    event.preventDefault()
  }
  const endPan = (event: React.PointerEvent<HTMLDivElement>) => {
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    panStart.current = null
    setIsPanning(false)
  }

  if (!document) return <aside className="pdf-panel empty-viewer"><div><span className="empty-icon">⌁</span><h2>原文檢視器</h2><p>選取論文後可連續檢視、文字標記與 AI 圈選。</p></div></aside>

  const pageCount = pdf?.numPages ?? document.pageCount
  const zoomLabel = zoom === 'fit' ? '同寬' : `${Math.round(zoom * 100)}%`

  return <aside className="pdf-panel" aria-label="PDF 原文檢視器">
    <div className="pdf-toolbar">
      <div>
        <strong>原文 PDF</strong>
        <span>第 {pageIndex + 1} / {pageCount} 頁 · {highlights.length} 個標記 · {zoomLabel}</span>
      </div>
      <div className="toolbar-actions">
        <button className="small-button" onClick={zoomOut} aria-label="縮小">−</button>
        <button className="small-button" onClick={zoomIn} aria-label="放大">＋</button>
        <button className={zoom === 'fit' ? 'small-button active' : 'small-button'} onClick={() => setZoom('fit')}>螢幕同寬</button>
        <button className={zoom === 1 ? 'small-button active' : 'small-button'} onClick={() => setZoom(1)}>100%</button>
        <button className={tool === 'pan' ? 'small-button active' : 'small-button'} onClick={() => switchTool('pan')} aria-pressed={tool === 'pan'} title="按住滑鼠左鍵拖曳來移動 PDF"><span className="tool-icon" aria-hidden="true">✋</span>手掌</button>
        <button className={tool === 'highlight' ? 'small-button active' : 'small-button'} onClick={() => switchTool('highlight')} aria-pressed={tool === 'highlight'} title="選取 PDF 文字並建立螢光標記"><span className="tool-icon" aria-hidden="true">🖍</span>螢光筆</button>
        <div className="highlight-toolbar-palette" aria-label="螢光筆顏色">{(Object.keys(highlightColors) as PdfHighlightColor[]).map((item) => <button key={item} aria-label={`${colorLabels[item]}色螢光筆`} title={`${colorLabels[item]}色`} className={color === item ? 'active' : ''} style={{ background: highlightColors[item] }} onClick={() => setColor(item)} />)}</div>
        <button className={tool === 'erase' ? 'small-button active' : 'small-button'} onClick={() => switchTool('erase')} aria-pressed={tool === 'erase'} title="點選頁面上的螢光標記即可刪除"><span className="tool-icon" aria-hidden="true">⌫</span>刪除標記</button>
        <button className={tool === 'roi' ? 'small-button active' : 'small-button'} onClick={() => switchTool('roi')} aria-pressed={tool === 'roi'} title="拖曳框選 PDF 的 Figure 或 Table，交給 AI 解讀"><span className="tool-icon" aria-hidden="true">⌗</span>AI 圈選</button>
      </div>
    </div>
    <div className={`pdf-viewport mode-${tool}${isPanning ? ' panning' : ''}`} ref={viewportRef} onScroll={handleScroll} onPointerDown={beginPan} onPointerMove={movePan} onPointerUp={endPan} onPointerCancel={endPan}>
      {renderError && <p className="inline-error">{renderError}</p>}
      {!pdf && !renderError && <p className="pdf-loading">正在載入 PDF…</p>}
      {pdf && <div className="pdf-document-stage">
        {Array.from({ length: pdf.numPages }, (_, index) => <div
          key={index}
          ref={(node) => { pageNodes.current[index] = node }}
          className="pdf-page-shell"
          data-page-index={index}
        >
          <span className="pdf-page-label">PDF p.{index + 1}</span>
          <PdfPage
            pdf={pdf}
            pageIndex={index}
            paperId={paperId}
            highlights={highlights.filter((highlight) => highlight.pdfPageIndex === index)}
            tool={tool}
            color={color}
            viewportWidth={viewportWidth}
            zoom={zoom}
            onAnalyzeRegion={onAnalyzeRegion}
            onAddAiRegionSummary={onAddAiRegionSummary}
            onAddHighlight={onAddHighlight}
            onDeleteHighlight={onDeleteHighlight}
          />
        </div>)}
      </div>}
    </div>
    {tool === 'erase' && <div className="pdf-annotation-actions erase-hint"><p>點選頁面上的螢光標記即可刪除，不會影響分析或筆記。</p></div>}
    {tool === 'roi' && <div className="pdf-annotation-actions"><p>拖曳框選 Figure／Table，再請 AI 針對區域解讀；摘要會保存到「筆記與重點標記」。</p></div>}
  </aside>
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageIndex: number
  paperId: string
  highlights: PdfHighlight[]
  tool: PdfTool
  color: PdfHighlightColor
  viewportWidth: number
  zoom: Zoom
  onAnalyzeRegion: (dataUrl: string, pageIndex: number) => Promise<string>
  onAddAiRegionSummary: (summary: AiRegionSummary) => void
  onAddHighlight: (highlight: PdfHighlight) => void
  onDeleteHighlight: (id: string) => void
}

function PdfPage({ pdf, pageIndex, paperId, highlights, tool, color, viewportWidth, zoom, onAnalyzeRegion, onAddAiRegionSummary, onAddHighlight, onDeleteHighlight }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState('')
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [roiResult, setRoiResult] = useState('')
  const [roiBusy, setRoiBusy] = useState(false)

  useEffect(() => {
    if (!canvasRef.current) return
    let active = true
    const controller = new AbortController()
    setRenderError('')
    setSelection(null)
    const width = Math.max(320, viewportWidth - 28)
    renderPdfPage(pdf, pageIndex + 1, canvasRef.current, width, textLayerRef.current ?? undefined, zoom === 'fit' ? undefined : zoom, controller.signal)
      .catch((error) => { if (active) setRenderError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false; controller.abort() }
  }, [pdf, pageIndex, viewportWidth, zoom])

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = canvasRef.current!.getBoundingClientRect()
    return {
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
    setRoiResult('')
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
      .map((rect) => ({
        x: (rect.x - stage.left) / stage.width, y: (rect.y - stage.top) / stage.height,
        width: (rect.right - rect.x) / stage.width, height: (rect.bottom - rect.y) / stage.height,
      }))
    if (!rects.length) return
    const first = rects[0]
    // One text selection is one saved annotation. Keep every visual block in
    // the same record so a wrapped or multi-line selection is highlighted and
    // translated as one complete segment.
    onAddHighlight({ id: crypto.randomUUID(), paperId, pdfPageIndex: pageIndex, ...first, rects, color, text: current.toString().trim() || undefined, createdAt: new Date().toISOString() })
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

  return <div className="pdf-page-content">
    <div className="pdf-canvas-stage" onPointerDown={begin} onPointerMove={move} onPointerUp={(event) => { end(event); highlightSelection() }} onPointerCancel={() => { setDragStart(null); setSelection(null) }}>
      <canvas ref={canvasRef} />
      <div ref={textLayerRef} className="pdf-text-layer" aria-label={`PDF 第 ${pageIndex + 1} 頁文字層`} />
      {highlights.flatMap((highlight) => pageRects(highlight).map((rect, index) => <button
        key={`${highlight.id}-${index}`}
        className={tool === 'erase' ? 'pdf-highlight erase-ready' : 'pdf-highlight'}
        aria-label={tool === 'erase' ? '刪除此螢光標記' : 'PDF 螢光標記'}
        title={tool === 'erase' ? '點一下刪除標記' : highlight.text || '螢光標記'}
        onClick={(event) => { event.stopPropagation(); if (tool === 'erase') onDeleteHighlight(highlight.id) }}
        style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%`, background: highlightColors[highlight.color] }}
      />))}
      {selection && tool === 'roi' && <div className="roi-selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}
    </div>
    {renderError && <p className="inline-error">{renderError}</p>}
    {tool === 'roi' && selection && <div className="roi-page-actions">
      <button className="small-button" disabled={roiBusy} onClick={() => void analyze()}>{roiBusy ? '分析中…' : '分析這個圈選區域'}</button>
      {roiResult && <div className="roi-result">{roiResult}</div>}
    </div>}
  </div>
}
