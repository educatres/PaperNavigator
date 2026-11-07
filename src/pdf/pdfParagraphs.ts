import type { PdfDocumentData, PdfHighlightRect, PdfParagraphTranslation } from '../domain/types'
import { openPdf } from './pdfClient'

export interface PdfParagraphSource {
  id: string
  paperId: string
  pdfPageIndex: number
  order: number
  sourceText: string
  sourceHash: string
  lines: PdfHighlightRect[]
  role: 'text' | 'heading' | 'caption' | 'excluded' | 'review'
}

export interface PdfTextRun {
  text: string
  x: number
  y: number
  width: number
  height: number
  itemIndex: number
  review?: boolean
}

interface Line extends PdfTextRun {
  items: number[]
  table?: boolean
}

interface ParagraphGroup {
  regionId: string
  columnId: number
  lines: Line[]
  left: number
  right: number
  role: PdfParagraphSource['role']
}

const median = (values: number[]) => [...values].sort((a, b) => a - b)[Math.floor(values.length / 2)] || 1
const normalizeParagraph = (text: string) => text.replace(/(\p{L})-\n(?=\p{Ll})/gu, '$1').replace(/\s+/g, ' ').trim()

async function textHash(text: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export function pendingPdfParagraphSources(paragraphs: PdfParagraphSource[], translations: PdfParagraphTranslation[]) {
  const saved = new Map(translations.map((item) => [item.id, item]))
  return paragraphs.filter((paragraph) => {
    const existing = saved.get(paragraph.id)
    return !existing || existing.sourceHash !== paragraph.sourceHash || !existing.translation.trim()
  })
}

export function pendingSelectedTranslations(translations: PdfParagraphTranslation[]) {
  return translations.filter((item) => item.origin === 'selection' && !item.translation.trim())
}

// Adapted from the reference reader: lines are grouped within page regions and
// columns so a translation never silently crosses a column or page boundary.
export function groupPdfParagraphRuns(runs: PdfTextRun[], pageWidth: number): ParagraphGroup[] {
  const sorted = runs.filter((run) => run.text.trim() && run.width > 0 && run.height > 0)
    .sort((a, b) => a.y - b.y || a.x - b.x)
  const rows: PdfTextRun[][] = []
  for (const run of sorted) {
    const row = [...rows].reverse().find((candidate) => Math.abs(candidate[0].y - run.y) < Math.min(candidate[0].height, run.height) * .4)
    if (row) {
      if (!row.some((item) => item.text === run.text && Math.abs(item.x - run.x) < 1 && Math.abs(item.y - run.y) < 1)) row.push(run)
    } else rows.push([run])
  }

  const lines: Line[] = []
  for (const row of rows) {
    row.sort((a, b) => a.x - b.x)
    const segments: Line[] = []
    for (const run of row) {
      const last = segments.at(-1)
      const gap = last ? run.x - last.x - last.width : Number.POSITIVE_INFINITY
      if (last && gap < Math.max(run.height, last.height) * 2.2 && !run.review && !last.review) {
        last.text += (gap > run.height * .15 && !last.text.endsWith(' ') ? ' ' : '') + run.text
        last.width = Math.max(last.width, run.x + run.width - last.x)
        last.height = Math.max(last.height, run.height)
        last.items.push(run.itemIndex)
      } else segments.push({ ...run, items: [run.itemIndex] })
    }
    if (segments.length > 2) segments.forEach((segment) => { segment.table = true })
    lines.push(...segments)
  }

  const gaps: Array<{ x: number; left: number; right: number; row: number }> = []
  for (const left of lines) for (const right of lines) {
    if (left === right || left.table || right.table || Math.abs(left.y - right.y) > Math.max(left.height, right.height) * 1.5) continue
    const end = left.x + left.width
    if (left.width < pageWidth * .12 || right.width < pageWidth * .12 || right.x - end < Math.max(left.height, right.height) * 2) continue
    const x = (end + right.x) / 2
    if (x < pageWidth * .2 || x > pageWidth * .8) continue
    gaps.push({ x, left: end, right: right.x, row: Math.round(left.y) })
  }
  const candidates = [...new Set(gaps.map((gap) => Math.round(gap.x)))].map((x) => ({
    x,
    support: new Set(gaps.filter((gap) => gap.left < x && gap.right > x).map((gap) => gap.row)).size,
  }))
  const best = candidates.sort((a, b) => b.support - a.support)[0]
  const gutter = best?.support >= 2 ? best.x : undefined
  if (gutter === undefined) for (const line of lines) {
    if (lines.some((other) => other !== line && Math.abs(other.y - line.y) < Math.min(other.height, line.height) * .4
      && (other.x > line.x + line.width || line.x > other.x + other.width))) line.table = true
  }

  const fullWidth = gutter === undefined ? [] : lines.filter((line) => line.x < gutter && line.x + line.width > gutter)
  const buckets = new Map<string, { lines: Line[]; regionId: string; columnId: number }>()
  for (const line of lines) {
    const spanning = fullWidth.includes(line)
    const band = fullWidth.filter((item) => item.y + item.height * .5 < line.y).length
    const regionId = spanning ? `wide-${fullWidth.indexOf(line)}` : `body-${band}`
    const columnId = gutter === undefined || spanning || line.x + line.width / 2 < gutter ? 0 : 1
    const key = `${regionId}-${columnId}`
    const bucket = buckets.get(key) ?? { lines: [], regionId, columnId }
    bucket.lines.push(line)
    buckets.set(key, bucket)
  }

  const groups: ParagraphGroup[] = []
  for (const bucket of buckets.values()) {
    bucket.lines.sort((a, b) => a.y - b.y || a.x - b.x)
    const left = Math.min(...bucket.lines.map((line) => line.x))
    const right = Math.max(...bucket.lines.map((line) => line.x + line.width))
    const fontHeight = median(bucket.lines.map((line) => line.height))
    let current: ParagraphGroup | undefined
    for (const line of bucket.lines) {
      const previous = current?.lines.at(-1)
      const newIndent = line.x - left > fontHeight * .8
      const listStart = /^\s*(?:[•●▪]|\d+[.)]\s|[a-z][.)]\s)/i.test(line.text)
      const breakBefore = !previous || line.y - previous.y > Math.max(previous.height, line.height) * 1.65
        || Math.abs(previous.height - line.height) > fontHeight * .25 || newIndent || listStart
        || line.table || previous.table || line.review || previous.review
      if (breakBefore) {
        const excluded = /^[\d\s\-–—]+$/.test(line.text) || /^[\d\s=+×÷<>()[\]{}.,:;^_*\/\\−≤≥∑∫]+$/u.test(line.text)
        const review = Boolean(line.review || line.table)
        current = {
          regionId: bucket.regionId,
          columnId: bucket.columnId,
          lines: [],
          left,
          right,
          role: review ? 'review' : excluded ? 'excluded' : /^(fig(?:ure)?|table)\s*\d/i.test(line.text) ? 'caption' : line.height > fontHeight * 1.2 ? 'heading' : 'text',
        }
        groups.push(current)
      }
      current!.lines.push(line)
    }
  }

  return groups.sort((a, b) => {
    if (a.regionId === b.regionId) return a.columnId - b.columnId || a.lines[0].y - b.lines[0].y
    const top = (group: ParagraphGroup) => Math.min(...groups.filter((item) => item.regionId === group.regionId).map((item) => item.lines[0].y))
    return top(a) - top(b)
  })
}

export async function extractPdfParagraphSources(document: PdfDocumentData, paperId: string, signal: AbortSignal, onProgress?: (page: number, total: number) => void) {
  const pdf = await openPdf(document.bytes)
  const paragraphs: PdfParagraphSource[] = []
  try {
    for (let pageIndex = 0; pageIndex < pdf.numPages; pageIndex += 1) {
      signal.throwIfAborted()
      onProgress?.(pageIndex + 1, pdf.numPages)
      const page = await pdf.getPage(pageIndex + 1)
      const viewport = page.getViewport({ scale: 1 })
      const content = await page.getTextContent()
      const runs: PdfTextRun[] = content.items.flatMap((item, itemIndex) => {
        if (!('str' in item) || !item.str.trim()) return []
        const [x, baseline] = viewport.convertToViewportPoint(item.transform[4], item.transform[5])
        const height = Math.max(1, Math.hypot(item.transform[2], item.transform[3]))
        const ascent = content.styles[item.fontName]?.ascent ?? .8
        const y = baseline - height * ascent
        const width = item.width
        if (x + width <= 0 || x >= viewport.width || y + height <= 0 || y >= viewport.height) return []
        return [{ text: item.str, x, y, width, height, itemIndex, review: item.dir !== 'ltr' || Math.abs(item.transform[1]) > .05 * Math.abs(item.transform[0]) }]
      })
      const groups = groupPdfParagraphRuns(runs, viewport.width)
      for (const [order, group] of groups.entries()) {
        const sourceText = normalizeParagraph(group.lines.map((line) => line.text.trim()).join('\n'))
        if (!sourceText) continue
        const lines = group.lines.map((line) => {
          const x = Math.max(0, Math.min(.99999, line.x / viewport.width))
          const y = Math.max(0, Math.min(.99999, line.y / viewport.height))
          return { x, y, width: Math.max(.00001, Math.min(1 - x, line.width / viewport.width)), height: Math.max(.00001, Math.min(1 - y, line.height / viewport.height)) }
        })
        const sourceHash = await textHash(sourceText)
        paragraphs.push({ id: `${paperId}-paragraph-${pageIndex}-${order}`, paperId, pdfPageIndex: pageIndex, order, sourceText, sourceHash, lines, role: group.role })
      }
      await new Promise((resolve) => window.setTimeout(resolve, 0))
    }

    const margins = paragraphs.filter((paragraph) => paragraph.lines[0]?.y < .08 || paragraph.lines.at(-1)!.y > .92)
    const repetitions = new Map<string, Set<number>>()
    for (const paragraph of margins) {
      const pages = repetitions.get(paragraph.sourceText) ?? new Set<number>()
      pages.add(paragraph.pdfPageIndex)
      repetitions.set(paragraph.sourceText, pages)
    }
    for (const paragraph of margins) if ((repetitions.get(paragraph.sourceText)?.size ?? 0) >= 2) paragraph.role = 'excluded'
    signal.throwIfAborted()
    return paragraphs
  } finally {
    await pdf.cleanup()
  }
}
