import { describe, expect, it } from 'vitest'
import { pass3Prompt } from '../ai/prompts/prompts'
import type { Pass1Result, Pass2Result, PdfHighlight, UserNote } from '../domain/types'

describe('third-pass prompt context', () => {
  it('includes current notes and highlight focus without requesting a full-text reread', () => {
    const note: UserNote = { id: 'n1', paperId: 'p1', body: '檢查資料洩漏', verification: 'pending', createdAt: '', updatedAt: '' }
    const highlight: PdfHighlight = { id: 'h1', paperId: 'p1', pdfPageIndex: 2, x: 0, y: 0, width: 0.2, height: 0.1, color: 'yellow', text: 'held-out test set', createdAt: '' }
    const prompt = pass3Prompt({} as Pass1Result, {} as Pass2Result, '', [note], [highlight], '浮動筆記內容')

    expect(prompt).toContain('不重新讀取或分析 PDF 全文')
    expect(prompt).toContain('HTML fragment')
    expect(prompt).toContain('不要輸出 Markdown')
    expect(prompt).toContain('檢查資料洩漏')
    expect(prompt).toContain('held-out test set')
    expect(prompt).toContain('浮動筆記內容')
  })
})
