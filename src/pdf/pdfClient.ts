import * as pdfjs from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'
import type { PDFDocumentProxy } from 'pdfjs-dist'
import { TextLayer } from 'pdfjs-dist'
import type { PdfDocumentData, SourceEvidence } from '../domain/types'

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl

const PDF_MAGIC = [0x25, 0x50, 0x44, 0x46, 0x2d]

function bytesToHex(bytes: ArrayBuffer) {
  return [...new Uint8Array(bytes)].map((value) => value.toString(16).padStart(2, '0')).join('')
}

export async function readPdf(file: File, onProgress?: (page: number, total: number) => void): Promise<PdfDocumentData> {
  if (!file.name.toLowerCase().endsWith('.pdf') && file.type !== 'application/pdf') throw new Error('只接受 PDF 檔案。')
  const bytes = new Uint8Array(await file.arrayBuffer())
  if (!PDF_MAGIC.every((value, index) => bytes[index] === value)) throw new Error('檔案內容不是有效 PDF（缺少 %PDF- 標頭）。')
  let pdf: PDFDocumentProxy
  try {
    pdf = await pdfjs.getDocument({ data: bytes.slice() }).promise
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (/password/i.test(message)) throw new Error('PDF 受密碼保護，請先解除保護後再匯入。')
    throw new Error(`PDF 無法開啟，可能已損毀：${message}`)
  }
  const metadata = await pdf.getMetadata().catch(() => null)
  const info = (metadata?.info ?? {}) as Record<string, unknown>
  const pagesText: string[] = []
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber)
    const content = await page.getTextContent()
    const text = content.items.map((item) => 'str' in item ? item.str : '').join(' ').replace(/\s+/g, ' ').trim()
    pagesText.push(text)
    onProgress?.(pageNumber, pdf.numPages)
  }
  const warnings: string[] = []
  if (file.size > 20 * 1024 * 1024) warnings.push('檔案超過建議的 20 MB，AI 上傳可能較慢並增加用量。')
  if (pdf.numPages > 100) warnings.push('頁數超過建議的 100 頁，分析時間與用量可能增加。')
  const textPages = pagesText.filter((page) => page.length >= 30).length
  if (textPages < Math.max(1, Math.ceil(pdf.numPages * 0.25))) warnings.push('可擷取文字的頁面偏少，可能是掃描 PDF；表格與引用定位需人工確認。')
  const sha256 = bytesToHex(await crypto.subtle.digest('SHA-256', bytes))
  await pdf.cleanup()
  return {
    file, bytes, sha256, filename: file.name, pageCount: pdf.numPages, size: file.size,
    title: typeof info.Title === 'string' && info.Title.trim() ? info.Title.trim() : null,
    author: typeof info.Author === 'string' && info.Author.trim() ? info.Author.trim() : null,
    pagesText, hasExtractableText: textPages > 0, warnings,
  }
}

export async function openPdf(bytes: Uint8Array) {
  return pdfjs.getDocument({ data: bytes.slice() }).promise
}

const canvasRenderQueues = new WeakMap<HTMLCanvasElement, Promise<void>>()

export async function renderPdfPage(pdf: PDFDocumentProxy, pageNumber: number, canvas: HTMLCanvasElement, maxWidth: number, textLayer?: HTMLElement, fixedScale?: number, signal?: AbortSignal) {
  const previous = canvasRenderQueues.get(canvas) ?? Promise.resolve()
  const render = previous.catch(() => undefined).then(async () => {
    if (signal?.aborted) return
    const page = await pdf.getPage(pageNumber)
    if (signal?.aborted) return
    const unscaled = page.getViewport({ scale: 1 })
    const scale = fixedScale ?? Math.min(2, Math.max(0.5, maxWidth / unscaled.width))
    const viewport = page.getViewport({ scale })
    const ratio = window.devicePixelRatio || 1
    canvas.width = Math.floor(viewport.width * ratio)
    canvas.height = Math.floor(viewport.height * ratio)
    canvas.style.width = `${Math.floor(viewport.width)}px`
    canvas.style.height = `${Math.floor(viewport.height)}px`
    const context = canvas.getContext('2d')
    if (!context) throw new Error('瀏覽器無法建立 PDF 畫布。')
    const renderTask = page.render({ canvasContext: context, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0], canvas })
    const cancel = () => renderTask.cancel()
    signal?.addEventListener('abort', cancel, { once: true })
    try {
      await renderTask.promise
    } catch (error) {
      if (signal?.aborted) return
      throw error
    } finally {
      signal?.removeEventListener('abort', cancel)
    }
    if (signal?.aborted || !textLayer) return
    textLayer.replaceChildren()
    textLayer.style.setProperty('--total-scale-factor', String(scale))
    textLayer.style.width = `${Math.floor(viewport.width)}px`
    textLayer.style.height = `${Math.floor(viewport.height)}px`
    const content = await page.getTextContent()
    if (signal?.aborted) return
    const layer = new TextLayer({ textContentSource: content, container: textLayer, viewport })
    await layer.render()
  })
  canvasRenderQueues.set(canvas, render)
  try {
    await render
  } finally {
    if (canvasRenderQueues.get(canvas) === render) canvasRenderQueues.delete(canvas)
  }
}

export function pagesForPrompt(data: PdfDocumentData, maxChars = Number.POSITIVE_INFINITY) {
  let used = 0
  const rows: string[] = []
  for (let index = 0; index < data.pagesText.length; index += 1) {
    const row = `[PDF page ${index + 1}; pdfPageIndex ${index}]\n${data.pagesText[index]}`
    if (used + row.length > maxChars) break
    rows.push(row)
    used += row.length
  }
  return rows.join('\n\n')
}

function normalized(value: string) {
  return value.toLocaleLowerCase().normalize('NFKC').replace(/\s+/g, '').replace(/[\p{P}\p{S}]/gu, '')
}

export function verifyEvidence(evidence: SourceEvidence[], pagesText: string[]): SourceEvidence[] {
  return evidence.map((item) => {
    if (item.pdfPageIndex === null || item.pdfPageIndex < 0 || item.pdfPageIndex >= pagesText.length) {
      return { ...item, verificationStatus: 'mismatch', notes: '頁碼不在此 PDF 範圍內。' }
    }
    if (!item.quote?.trim()) return { ...item, verificationStatus: 'unverified', notes: item.notes ?? '缺少可核對的短摘錄。' }
    const quote = normalized(item.quote)
    const page = normalized(pagesText[item.pdfPageIndex])
    if (quote.length >= 8 && page.includes(quote)) return { ...item, verificationStatus: 'matched', notes: item.notes }
    const anchor = quote.slice(0, Math.min(24, quote.length))
    if (anchor.length >= 8 && page.includes(anchor)) return { ...item, verificationStatus: 'matched', notes: '以正規化後的部分摘錄定位。' }
    return { ...item, verificationStatus: 'unverified', notes: '在指定頁面未找到相符摘錄，請人工核對。' }
  })
}

export function cropCanvas(canvas: HTMLCanvasElement, rect: { x: number; y: number; width: number; height: number }) {
  const ratioX = canvas.width / canvas.clientWidth
  const ratioY = canvas.height / canvas.clientHeight
  const output = document.createElement('canvas')
  output.width = Math.max(1, Math.round(rect.width * ratioX))
  output.height = Math.max(1, Math.round(rect.height * ratioY))
  const context = output.getContext('2d')
  context?.drawImage(canvas, rect.x * ratioX, rect.y * ratioY, rect.width * ratioX, rect.height * ratioY, 0, 0, output.width, output.height)
  return output.toDataURL('image/png')
}
