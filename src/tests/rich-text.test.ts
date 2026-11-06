import { describe, expect, it } from 'vitest'
import { markdownToHtml, richTextToHtml, sanitizeReportHtml } from '../lib/richText'

describe('rich report rendering', () => {
  it('renders existing Markdown reports', () => {
    expect(markdownToHtml('## 重建\n\n- 步驟一\n- 步驟二')).toBe('<h2>重建</h2><ul><li>步驟一</li><li>步驟二</li></ul>')
    expect(richTextToHtml('## 重建')).toBe('<h2>重建</h2>')
  })

  it('renders HTML fragments and removes attributes and unsafe elements', () => {
    const html = '<section class="report"><h2 onclick="alert(1)">重建</h2><script>alert(1)</script><p>內容</p></section>'

    expect(richTextToHtml(html)).toBe('<section><h2>重建</h2><p>內容</p></section>')
  })

  it('unwraps an HTML code fence and retains only allowed tags', () => {
    expect(richTextToHtml('```html\n<h2>標題</h2><img src=x onerror=alert(1)><p><strong>內容</strong></p>\n```'))
      .toBe('<h2>標題</h2><p><strong>內容</strong></p>')
  })

  it('escapes text from disallowed markup', () => {
    expect(sanitizeReportHtml('<p>1 & 2</p><custom>文字</custom>')).toBe('<p>1 &amp; 2</p>文字')
  })
})
