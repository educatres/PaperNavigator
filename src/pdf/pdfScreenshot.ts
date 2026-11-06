import type { PdfHighlightRect } from '../domain/types'

export interface DragPoint { x: number; y: number }

export function normalizedSelectionRect(start: DragPoint, end: DragPoint, width: number, height: number, minimumPixels = 8): PdfHighlightRect | null {
  if (width <= 0 || height <= 0) return null
  const left = Math.max(0, Math.min(width, Math.min(start.x, end.x)))
  const top = Math.max(0, Math.min(height, Math.min(start.y, end.y)))
  const right = Math.max(0, Math.min(width, Math.max(start.x, end.x)))
  const bottom = Math.max(0, Math.min(height, Math.max(start.y, end.y)))
  if (right - left < minimumPixels || bottom - top < minimumPixels) return null
  return { x: left / width, y: top / height, width: (right - left) / width, height: (bottom - top) / height }
}

export function captureCanvasSelection(canvas: HTMLCanvasElement, rect: PdfHighlightRect) {
  const sourceX = Math.round(rect.x * canvas.width)
  const sourceY = Math.round(rect.y * canvas.height)
  const sourceWidth = Math.max(1, Math.round(rect.width * canvas.width))
  const sourceHeight = Math.max(1, Math.round(rect.height * canvas.height))
  const scale = Math.min(1, 1800 / Math.max(sourceWidth, sourceHeight))
  const output = window.document.createElement('canvas')
  output.width = Math.max(1, Math.round(sourceWidth * scale))
  output.height = Math.max(1, Math.round(sourceHeight * scale))
  const context = output.getContext('2d')
  if (!context) throw new Error('瀏覽器無法建立截圖畫布。')
  context.drawImage(canvas, sourceX, sourceY, sourceWidth, sourceHeight, 0, 0, output.width, output.height)
  const webp = output.toDataURL('image/webp', .9)
  return webp.startsWith('data:image/webp') ? webp : output.toDataURL('image/png')
}
