import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfDocumentData } from '../../domain/types'
import { cropCanvas, openPdf, renderPdfPage } from '../../pdf/pdfClient'

interface Props {
  document: PdfDocumentData | null
  pageIndex: number
  onPageChange: (pageIndex: number) => void
  onAnalyzeRegion: (dataUrl: string, pageIndex: number) => Promise<string>
}

interface Rect { x: number; y: number; width: number; height: number }

export function PdfViewer({ document, pageIndex, onPageChange, onAnalyzeRegion }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const viewportRef = useRef<HTMLDivElement | null>(null)
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [renderError, setRenderError] = useState('')
  const [roiMode, setRoiMode] = useState(false)
  const [dragStart, setDragStart] = useState<{ x: number; y: number } | null>(null)
  const [selection, setSelection] = useState<Rect | null>(null)
  const [roiResult, setRoiResult] = useState('')
  const [roiBusy, setRoiBusy] = useState(false)

  useEffect(() => {
    let active = true
    let opened: PDFDocumentProxy | null = null
    setPdf(null)
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
    const width = Math.max(320, viewportRef.current.clientWidth - 28)
    renderPdfPage(pdf, Math.min(pdf.numPages, pageIndex + 1), canvasRef.current, width)
      .catch((error) => setRenderError(error instanceof Error ? error.message : String(error)))
  }, [pdf, pageIndex])

  const point = (event: React.PointerEvent<HTMLDivElement>) => {
    const bounds = viewportRef.current!.getBoundingClientRect()
    const canvas = canvasRef.current!.getBoundingClientRect()
    return { x: event.clientX - canvas.left, y: event.clientY - canvas.top, maxX: canvas.width, maxY: canvas.height, bounds }
  }

  const begin = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!roiMode || !canvasRef.current) return
    const value = point(event)
    if (value.x < 0 || value.y < 0 || value.x > value.maxX || value.y > value.maxY) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setDragStart({ x: value.x, y: value.y })
    setSelection({ x: value.x, y: value.y, width: 0, height: 0 })
  }

  const move = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!dragStart) return
    const value = point(event)
    const x = Math.max(0, Math.min(value.maxX, value.x))
    const y = Math.max(0, Math.min(value.maxY, value.y))
    setSelection({ x: Math.min(dragStart.x, x), y: Math.min(dragStart.y, y), width: Math.abs(x - dragStart.x), height: Math.abs(y - dragStart.y) })
  }

  const end = () => setDragStart(null)

  const analyze = async () => {
    if (!canvasRef.current || !selection || selection.width < 10 || selection.height < 10) return
    setRoiBusy(true)
    setRoiResult('')
    try { setRoiResult(await onAnalyzeRegion(cropCanvas(canvasRef.current, selection), pageIndex)) }
    catch (error) { setRoiResult(error instanceof Error ? error.message : String(error)) }
    finally { setRoiBusy(false) }
  }

  if (!document) return <aside className="pdf-panel empty-viewer"><div><span className="empty-icon">⌁</span><h2>原文檢視器</h2><p>選取論文後可逐頁檢視與圈選圖表。</p></div></aside>

  return <aside className="pdf-panel" aria-label="PDF 原文檢視器">
    <div className="pdf-toolbar">
      <div>
        <strong>原文 PDF</strong>
        <span>{pageIndex + 1} / {document.pageCount}</span>
      </div>
      <div className="toolbar-actions">
        <button className="icon-button" onClick={() => onPageChange(Math.max(0, pageIndex - 1))} disabled={pageIndex === 0} aria-label="上一頁">←</button>
        <button className="icon-button" onClick={() => onPageChange(Math.min(document.pageCount - 1, pageIndex + 1))} disabled={pageIndex + 1 >= document.pageCount} aria-label="下一頁">→</button>
        <button className={roiMode ? 'small-button active' : 'small-button'} onClick={() => { setRoiMode((value) => !value); setSelection(null) }}>圈選</button>
      </div>
    </div>
    <div className={roiMode ? 'pdf-viewport selecting' : 'pdf-viewport'} ref={viewportRef} onPointerDown={begin} onPointerMove={move} onPointerUp={end} onPointerCancel={end}>
      <canvas ref={canvasRef} />
      {selection && <div className="roi-selection" style={{ left: selection.x, top: selection.y, width: selection.width, height: selection.height }} />}
      {renderError && <p className="inline-error">{renderError}</p>}
    </div>
    {roiMode && <div className="roi-actions">
      <p>拖曳框選 Figure／Table，再請 AI 針對區域解讀。</p>
      <button className="small-button" disabled={!selection || roiBusy} onClick={analyze}>{roiBusy ? '分析中…' : '分析圈選區域'}</button>
      {roiResult && <div className="roi-result">{roiResult}</div>}
    </div>}
  </aside>
}
