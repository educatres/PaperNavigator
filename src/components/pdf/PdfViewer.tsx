import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import type { PdfDocumentData, PdfHighlight, PdfHighlightColor, PdfHighlightRect, PdfParagraphTranslation, PdfScreenshot } from '../../domain/types'
import { openPdf, renderPdfPage } from '../../pdf/pdfClient'
import { captureCanvasSelection, normalizedSelectionRect, type DragPoint } from '../../pdf/pdfScreenshot'

interface Props {
  document: PdfDocumentData | null
  paperId: string
  pageIndex: number
  highlights: PdfHighlight[]
  translations: PdfParagraphTranslation[]
  onTranslate: () => void
  onAddTranslationSelection: (translation: PdfParagraphTranslation) => void
  onTranslateSelections: () => void
  translationRunning: boolean
  translationBlocked: boolean
  translationProgressLabel: string
  onCancelTranslation: () => void
  onDeleteTranslation: (id: string) => void
  onClearTranslations: () => void
  onCollapse: () => void
  onPageChange: (pageIndex: number) => void
  onAddHighlight: (highlight: PdfHighlight) => void
  onDeleteHighlight: (id: string) => void
  onAddScreenshot: (screenshot: PdfScreenshot) => void
}

type PdfTool = 'browse' | 'pan' | 'highlight' | 'translate-select' | 'erase' | 'screenshot'
type Zoom = 'fit' | number

const highlightColors: Record<PdfHighlightColor, string> = {
  yellow: 'rgba(246, 211, 73, .46)',
  green: 'rgba(87, 190, 137, .42)',
  pink: 'rgba(234, 125, 160, .42)',
  blue: 'rgba(153, 204, 238, .48)',
}

const colorLabels: Record<PdfHighlightColor, string> = { yellow: '黃', green: '綠', pink: '粉紅', blue: '淺藍' }
const pageRects = (highlight: PdfHighlight): PdfHighlightRect[] => highlight.rects?.length ? highlight.rects : [{ x: highlight.x, y: highlight.y, width: highlight.width, height: highlight.height }]

interface TextSpanInfo {
  span: HTMLSpanElement
  rect: DOMRect
  centerX: number
}

function textSpanInfos(textLayer: HTMLElement) {
  return Array.from(textLayer.querySelectorAll('span'))
    .map((span) => {
      const rect = span.getBoundingClientRect()
      return { span, rect, centerX: rect.left + rect.width / 2 }
    })
    .filter((item): item is TextSpanInfo => item.rect.width >= 1 && item.rect.height >= 1)
}

function findColumnBoundary(spans: TextSpanInfo[], stageWidth: number, allowShortFallback = false) {
  if (spans.length < 6 && !allowShortFallback) return null
  const sorted = [...spans].sort((a, b) => a.rect.top - b.rect.top || a.rect.left - b.rect.left)
  const lines: TextSpanInfo[][] = []
  for (const item of sorted) {
    const line = lines[lines.length - 1]
    const tolerance = Math.max(3, item.rect.height * .55)
    if (!line || Math.abs(item.rect.top - line[0].rect.top) > tolerance) lines.push([item])
    else line.push(item)
  }

  const minimumGap = Math.max(36, stageWidth * .05)
  const candidates: Array<{ midpoint: number; gap: number; lineTop: number }> = []
  for (const line of lines) {
    const ordered = [...line].sort((a, b) => a.rect.left - b.rect.left)
    for (let index = 1; index < ordered.length; index += 1) {
      const left = ordered[index - 1]
      const right = ordered[index]
      const gap = right.rect.left - left.rect.right
      if (gap >= minimumGap) candidates.push({ midpoint: (left.rect.right + right.rect.left) / 2, gap, lineTop: line[0].rect.top })
    }
  }
  if (!candidates.length) return null

  const tolerance = Math.max(24, stageWidth * .04)
  const clusters: Array<{ midpoint: number; gap: number; lineTops: number[] }> = []
  for (const candidate of candidates) {
    const cluster = clusters.find((item) => Math.abs(item.midpoint - candidate.midpoint) <= tolerance)
    if (cluster) {
      cluster.midpoint = (cluster.midpoint * cluster.lineTops.length + candidate.midpoint) / (cluster.lineTops.length + 1)
      cluster.gap = Math.max(cluster.gap, candidate.gap)
      cluster.lineTops.push(candidate.lineTop)
    } else clusters.push({ midpoint: candidate.midpoint, gap: candidate.gap, lineTops: [candidate.lineTop] })
  }

  const supported = clusters
    .filter((cluster) => new Set(cluster.lineTops.map((top) => Math.round(top))).size >= 3)
    .map((cluster) => {
      const leftCount = spans.filter((item) => item.centerX < cluster.midpoint).length
      const rightCount = spans.filter((item) => item.centerX > cluster.midpoint).length
      return { ...cluster, score: cluster.lineTops.length * 100 + cluster.gap, valid: leftCount >= 3 && rightCount >= 3 }
    })
    .filter((cluster) => cluster.valid)
    .sort((a, b) => b.score - a.score)
  if (supported[0]) return supported[0].midpoint

  // Short pages may not provide three repeated column gaps. Keep a conservative
  // fallback so a clearly cross-column selection still becomes one-column text.
  if (!allowShortFallback || spans.length < 4) return null
  const ordered = [...spans].sort((a, b) => a.centerX - b.centerX)
  let largestGap = 0
  let splitIndex = -1
  for (let index = 1; index < ordered.length; index += 1) {
    const gap = ordered[index].centerX - ordered[index - 1].centerX
    if (gap > largestGap) { largestGap = gap; splitIndex = index }
  }
  const fallbackThreshold = Math.max(56, stageWidth * .08)
  return splitIndex > 0 && splitIndex < ordered.length && largestGap >= fallbackThreshold
    ? (ordered[splitIndex - 1].centerX + ordered[splitIndex].centerX) / 2
    : null
}

function selectionElement(node: Node | null) {
  if (!node) return null
  const element = node.nodeType === Node.TEXT_NODE ? node.parentElement : node instanceof Element ? node : null
  return element?.closest('span') ?? element
}

export function PdfViewer({ document, paperId, pageIndex, highlights, translations, onTranslate, onAddTranslationSelection, onTranslateSelections, translationRunning, translationBlocked, translationProgressLabel, onCancelTranslation, onDeleteTranslation, onClearTranslations, onCollapse, onPageChange, onAddHighlight, onDeleteHighlight, onAddScreenshot }: Props) {
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

  if (!document) return <aside className="pdf-panel empty-viewer"><button className="pdf-empty-collapse" onClick={onCollapse} aria-label="收合 PDF Viewer" title="收合 PDF Viewer">»</button><div><span className="empty-icon">⌁</span><h2>原文檢視器</h2><p>選取論文後可連續檢視、圈選截圖與建立文字標記。</p></div></aside>

  const pageCount = pdf?.numPages ?? document.pageCount
  const zoomLabel = zoom === 'fit' ? '同寬' : `${Math.round(zoom * 100)}%`
  const pendingSelectionCount = translations.filter((item) => item.origin === 'selection' && !item.translation.trim()).length
  const completedTranslationCount = translations.filter((item) => item.translation.trim()).length
  const automaticTranslationCount = translations.filter((item) => item.origin !== 'selection').length

  return <aside className="pdf-panel" aria-label="PDF 原文檢視器">
    <div className="pdf-toolbar">
      <div>
        <strong>原文 PDF</strong>
        <span>第 {pageIndex + 1} / {pageCount} 頁 · {highlights.length} 個標記 · {completedTranslationCount} 個翻譯{pendingSelectionCount ? ` · ${pendingSelectionCount} 個待翻譯` : ''} · {zoomLabel}</span>
      </div>
      <div className="toolbar-actions">
        <button className="small-button" onClick={zoomOut} aria-label="縮小">−</button>
        <button className="small-button" onClick={zoomIn} aria-label="放大">＋</button>
        <button className={zoom === 'fit' ? 'small-button active' : 'small-button'} onClick={() => setZoom('fit')}>螢幕同寬</button>
        <button className={zoom === 1 ? 'small-button active' : 'small-button'} onClick={() => setZoom(1)}>100%</button>
        <button className={tool === 'pan' ? 'small-button active' : 'small-button'} onClick={() => switchTool('pan')} aria-pressed={tool === 'pan'} title="按住滑鼠左鍵拖曳來移動 PDF"><span className="tool-icon" aria-hidden="true">✋</span>手掌</button>
        <button className={tool === 'highlight' ? 'small-button active' : 'small-button'} onClick={() => switchTool('highlight')} aria-pressed={tool === 'highlight'} title="選取 PDF 文字並建立螢光標記"><span className="tool-icon" aria-hidden="true">🖍</span>螢光筆</button>
        <button className={tool === 'translate-select' ? 'small-button active' : 'small-button'} onClick={() => switchTool('translate-select')} aria-pressed={tool === 'translate-select'} title="選取一整段 PDF 文字，加入待翻譯清單"><span className="tool-icon" aria-hidden="true">文</span>圈選翻譯</button>
        <div className="highlight-toolbar-palette" aria-label="螢光筆顏色">{(Object.keys(highlightColors) as PdfHighlightColor[]).map((item) => <button key={item} aria-label={`${colorLabels[item]}色螢光筆`} title={`${colorLabels[item]}色`} className={color === item ? 'active' : ''} style={{ background: highlightColors[item] }} onClick={() => setColor(item)} />)}</div>
        <button className={tool === 'erase' ? 'small-button active' : 'small-button'} onClick={() => switchTool('erase')} aria-pressed={tool === 'erase'} title="點選頁面上的螢光標記即可刪除"><span className="tool-icon" aria-hidden="true">⌫</span>刪除標記</button>
        <button className={tool === 'screenshot' ? 'small-button active' : 'small-button'} onClick={() => switchTool('screenshot')} aria-pressed={tool === 'screenshot'} title="在 PDF 頁面拖曳範圍並保存截圖"><span className="tool-icon" aria-hidden="true">▣</span>圈選截圖</button>
        {translationRunning
          ? <button className="small-button translation-cancel-button" onClick={onCancelTranslation} title="停止背景逐段翻譯；已完成的譯文會保留"><span className="tool-icon" aria-hidden="true">■</span>停止翻譯</button>
          : <button className="small-button pdf-translate-button" disabled={translationBlocked} onClick={onTranslate} title={translationBlocked ? '另一篇論文正在背景翻譯' : '擷取 PDF 段落並在背景逐段翻譯成繁體中文'}><span className="tool-icon" aria-hidden="true">文</span>{automaticTranslationCount ? '接續翻譯' : '逐段翻譯'}</button>}
        <button className="small-button selection-translate-button" disabled={translationRunning || translationBlocked || !pendingSelectionCount} onClick={onTranslateSelections} title="把目前圈選的待翻譯段落一起送到背景翻譯">翻譯已選段落（{pendingSelectionCount}）</button>
        <button className="small-button" disabled={!translations.length} onClick={onClearTranslations} title="清除這篇論文的全部逐段翻譯">清除全部翻譯</button>
        <button className="small-button pdf-collapse-button" onClick={onCollapse} aria-label="收合 PDF Viewer" title="收合 PDF Viewer"><span aria-hidden="true">»</span>收合</button>
      </div>
    </div>
    {translationRunning && <div className="pdf-background-progress"><span className="spinner" />{translationProgressLabel}<button className="text-button" onClick={onCancelTranslation}>停止</button></div>}
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
            translations={translations.filter((translation) => translation.pdfPageIndex === index)}
            tool={tool}
            color={color}
            viewportWidth={viewportWidth}
            zoom={zoom}
            onAddHighlight={onAddHighlight}
            onAddTranslationSelection={onAddTranslationSelection}
            onDeleteHighlight={onDeleteHighlight}
            onDeleteTranslation={onDeleteTranslation}
            onAddScreenshot={onAddScreenshot}
          />
        </div>)}
      </div>}
    </div>
    {tool === 'erase' && <div className="pdf-annotation-actions erase-hint"><p>點選頁面上的螢光標記即可刪除，不會影響分析或筆記。</p></div>}
    {tool === 'screenshot' && <div className="pdf-annotation-actions screenshot-hint"><p>在單一 PDF 頁面按住滑鼠左鍵拖曳；放開後，圈選區域會保存到「截圖」分頁。</p></div>}
    {tool === 'translate-select' && <div className="pdf-annotation-actions translation-selection-hint"><p>拖曳選取一整段文字，可連續標記多段；完成後按「翻譯已選段落」一起在背景翻譯。</p><strong>待翻譯 {pendingSelectionCount} 段</strong></div>}
  </aside>
}

interface PdfPageProps {
  pdf: PDFDocumentProxy
  pageIndex: number
  paperId: string
  highlights: PdfHighlight[]
  translations: PdfParagraphTranslation[]
  tool: PdfTool
  color: PdfHighlightColor
  viewportWidth: number
  zoom: Zoom
  onAddHighlight: (highlight: PdfHighlight) => void
  onAddTranslationSelection: (translation: PdfParagraphTranslation) => void
  onDeleteHighlight: (id: string) => void
  onDeleteTranslation: (id: string) => void
  onAddScreenshot: (screenshot: PdfScreenshot) => void
}

function PdfPage({ pdf, pageIndex, paperId, highlights, translations, tool, color, viewportWidth, zoom, onAddHighlight, onAddTranslationSelection, onDeleteHighlight, onDeleteTranslation, onAddScreenshot }: PdfPageProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const textLayerRef = useRef<HTMLDivElement | null>(null)
  const [renderError, setRenderError] = useState('')
  const [activeTranslationId, setActiveTranslationId] = useState<string | null>(null)
  const screenshotStart = useRef<DragPoint | null>(null)
  const [screenshotSelection, setScreenshotSelection] = useState<PdfHighlightRect | null>(null)

  useEffect(() => {
    if (!canvasRef.current) return
    let active = true
    const controller = new AbortController()
    setRenderError('')
    const width = Math.max(320, viewportWidth - 28)
    renderPdfPage(pdf, pageIndex + 1, canvasRef.current, width, textLayerRef.current ?? undefined, zoom === 'fit' ? undefined : zoom, controller.signal)
      .catch((error) => { if (active) setRenderError(error instanceof Error ? error.message : String(error)) })
    return () => { active = false; controller.abort() }
  }, [pdf, pageIndex, viewportWidth, zoom])

  const handleTextSelection = () => {
    if ((tool !== 'highlight' && tool !== 'translate-select') || !textLayerRef.current || !canvasRef.current) return
    const current = window.getSelection()
    if (!current || current.isCollapsed || current.rangeCount === 0) return
    const range = current.getRangeAt(0)
    if (!textLayerRef.current.contains(range.commonAncestorContainer)) return
    const stage = canvasRef.current.getBoundingClientRect()
    const rawRects = Array.from(range.getClientRects())
      .map((rect) => ({
        x: Math.max(stage.left, rect.left), y: Math.max(stage.top, rect.top),
        right: Math.min(stage.right, rect.right), bottom: Math.min(stage.bottom, rect.bottom),
      }))
      .filter((rect) => rect.right - rect.x >= 2 && rect.bottom - rect.y >= 2)
    if (!rawRects.length) return

    const allSpans = textSpanInfos(textLayerRef.current)
    const selectedSpans = allSpans
      .filter((span) => {
        try { return range.intersectsNode(span.span) } catch { return false }
      })

    const columnBoundary = findColumnBoundary(allSpans, stage.width) ?? findColumnBoundary(selectedSpans, stage.width, true)
    let activeColumnBoundary: number | null = null
    let keepLeftColumn = true
    if (columnBoundary !== null) {
      const selectedLeft = selectedSpans.filter((item) => item.centerX < columnBoundary).length
      const selectedRight = selectedSpans.filter((item) => item.centerX > columnBoundary).length
      if (selectedLeft > 0 && selectedRight > 0) {
        activeColumnBoundary = columnBoundary
        const anchorRect = selectionElement(current.anchorNode)?.getBoundingClientRect()
        const anchorX = anchorRect ? anchorRect.left + anchorRect.width / 2 : rawRects[0].x
        keepLeftColumn = anchorX <= activeColumnBoundary
      }
    }

    const columnSpans = activeColumnBoundary === null
      ? selectedSpans
      : selectedSpans.filter((item) => keepLeftColumn ? item.centerX <= activeColumnBoundary! : item.centerX >= activeColumnBoundary!)
    const clippedText = columnSpans.map(({ span }) => {
      const spanRange = document.createRange()
      spanRange.selectNodeContents(span)
      try {
        if (range.compareBoundaryPoints(Range.START_TO_START, spanRange) > 0) spanRange.setStart(range.startContainer, range.startOffset)
        if (range.compareBoundaryPoints(Range.END_TO_END, spanRange) < 0) spanRange.setEnd(range.endContainer, range.endOffset)
        return spanRange.toString()
      } catch { return '' }
    }).join(' ').replace(/\s+/g, ' ').trim()
    const text = clippedText || (activeColumnBoundary === null ? current.toString().trim() : columnSpans.map(({ span }) => span.textContent ?? '').join(' ').replace(/\s+/g, ' ').trim())
    const rects = rawRects
      .filter((rect) => activeColumnBoundary === null || (keepLeftColumn ? (rect.x + rect.right) / 2 <= activeColumnBoundary : (rect.x + rect.right) / 2 >= activeColumnBoundary))
      .map((rect) => ({
        x: (rect.x - stage.left) / stage.width, y: (rect.y - stage.top) / stage.height,
        width: (rect.right - rect.x) / stage.width, height: (rect.bottom - rect.y) / stage.height,
      }))
    if (!rects.length || !text) return
    const first = rects[0]
    // One text selection is one saved annotation. Keep every visual block in
    // the same record so a wrapped or multi-line selection is highlighted and
    // translated as one complete segment.
    if (tool === 'highlight') {
      onAddHighlight({ id: crypto.randomUUID(), paperId, pdfPageIndex: pageIndex, ...first, rects, color, text, createdAt: new Date().toISOString() })
    } else {
      const id = crypto.randomUUID()
      onAddTranslationSelection({
        id, paperId, pdfPageIndex: pageIndex, order: Date.now(), sourceText: text,
        sourceHash: `selection:${id}`, lines: rects, translation: '', model: '', createdAt: new Date().toISOString(), origin: 'selection',
      })
    }
    current.removeAllRanges()
  }

  const screenshotPoint = (event: React.PointerEvent<HTMLDivElement>) => {
    const stage = event.currentTarget.getBoundingClientRect()
    return { point: { x: event.clientX - stage.left, y: event.clientY - stage.top }, stage }
  }
  const beginScreenshot = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'screenshot' || event.button !== 0) return
    const { point } = screenshotPoint(event)
    screenshotStart.current = point
    setScreenshotSelection(null)
    event.currentTarget.setPointerCapture(event.pointerId)
    event.preventDefault()
  }
  const moveScreenshot = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'screenshot' || !screenshotStart.current) return
    const { point, stage } = screenshotPoint(event)
    setScreenshotSelection(normalizedSelectionRect(screenshotStart.current, point, stage.width, stage.height, 1))
    event.preventDefault()
  }
  const finishScreenshot = (event: React.PointerEvent<HTMLDivElement>) => {
    if (tool !== 'screenshot' || !screenshotStart.current || !canvasRef.current) return
    const { point, stage } = screenshotPoint(event)
    const rect = normalizedSelectionRect(screenshotStart.current, point, stage.width, stage.height)
    screenshotStart.current = null
    setScreenshotSelection(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    if (!rect) return
    try {
      onAddScreenshot({
        id: crypto.randomUUID(), paperId, pdfPageIndex: pageIndex,
        ...rect, dataUrl: captureCanvasSelection(canvasRef.current, rect), createdAt: new Date().toISOString(),
      })
    } catch (error) {
      setRenderError(error instanceof Error ? error.message : String(error))
    }
    event.preventDefault()
  }
  const cancelScreenshot = (event: React.PointerEvent<HTMLDivElement>) => {
    screenshotStart.current = null
    setScreenshotSelection(null)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }

  return <div className="pdf-page-content">
    <div className="pdf-canvas-stage" onPointerDown={beginScreenshot} onPointerMove={moveScreenshot} onPointerUp={(event) => { finishScreenshot(event); handleTextSelection() }} onPointerCancel={cancelScreenshot}>
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
      {translations.filter((translation) => translation.id === activeTranslationId).flatMap((translation) => translation.lines.map((rect, index) => <div
        key={`${translation.id}-source-${index}`}
        className="pdf-translation-source-highlight"
        style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
      />))}
      {translations.map((translation) => {
        const anchor = translation.lines[0]
        if (!anchor) return null
        const alignRight = anchor.x > .55
        return <div
          key={translation.id}
          className={`pdf-translation-anchor${alignRight ? ' align-right' : ''}`}
          style={{ left: `${Math.max(.008, anchor.x - .035) * 100}%`, top: `${anchor.y * 100}%` }}
          onMouseEnter={() => setActiveTranslationId(translation.id)}
          onMouseLeave={() => setActiveTranslationId(null)}
          onFocus={() => setActiveTranslationId(translation.id)}
          onBlur={() => setActiveTranslationId(null)}
        >
          <button className={`pdf-translation-marker${translation.translation ? '' : ' pending'}`} aria-label={translation.translation ? '顯示這一段的中文翻譯' : '顯示待翻譯的圈選文字'} title={translation.translation ? '移入查看中文翻譯' : '待翻譯段落'}>文</button>
          <div className="pdf-translation-popover" role="group" aria-label="中文翻譯">
            <div className="pdf-translation-popover-heading"><strong>{translation.translation ? '中文翻譯' : '待翻譯段落'}</strong><button className="danger-link" onClick={(event) => { event.stopPropagation(); onDeleteTranslation(translation.id) }}>清除此段</button></div>
            <p className={translation.translation ? '' : 'pending-source'}>{translation.translation || translation.sourceText}</p>
          </div>
        </div>
      })}
      {screenshotSelection && <div className="pdf-screenshot-selection" aria-hidden="true" style={{ left: `${screenshotSelection.x * 100}%`, top: `${screenshotSelection.y * 100}%`, width: `${screenshotSelection.width * 100}%`, height: `${screenshotSelection.height * 100}%` }} />}
    </div>
    {renderError && <p className="inline-error">{renderError}</p>}
  </div>
}
