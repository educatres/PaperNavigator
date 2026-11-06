import { describe, expect, it } from 'vitest'
import { cleanHighlightResponse, highlightSummaryPrompt, highlightTranslationPrompt } from '../ai/prompts/prompts'

describe('highlight AI prompts', () => {
  const selected = 'Accuracy was 92%.\nThe held-out test set was used.'

  it('sends exactly the displayed highlight text to the summary prompt', () => {
    const prompt = highlightSummaryPrompt(selected)

    expect(prompt).toContain(selected)
    expect(prompt).toContain('螢光筆與 AI 摘要')
    expect(prompt).toContain('AI 摘要」，不是翻譯')
    expect(prompt).toContain('不要逐句翻譯')
    expect(prompt).toContain('繁體中文摘要')
    expect(prompt).toContain('不得使用 PDF 其他頁面')
  })

  it('limits translation to every line in the selected highlight', () => {
    const prompt = highlightTranslationPrompt(selected)

    expect(prompt).toContain(selected)
    expect(prompt).toContain('翻譯」，不是摘要')
    expect(prompt).toContain('完整翻譯成自然、準確的繁體中文')
    expect(prompt).toContain('不可刪節、濃縮、摘要、改寫')
    expect(prompt).toContain('跨越的所有行與句子')
    expect(prompt).toContain('不可刪節、濃縮、摘要、改寫或補充螢光區域以外的內容')
  })

  it('does not display an echoed prompt as generated content', () => {
    const prompt = highlightSummaryPrompt(selected)

    expect(cleanHighlightResponse(prompt, prompt)).toBe('')
    expect(cleanHighlightResponse(`${prompt}\n\n### 重點\n測試摘要`, prompt)).toBe('### 重點\n測試摘要')
    expect(cleanHighlightResponse('這是正常摘要。', prompt)).toBe('這是正常摘要。')
  })

  it('removes the leaked summary instruction shown in the result', () => {
    const prompt = highlightSummaryPrompt(selected)
    const response = 'Need to produce Chinese summary of highlighted text, max 3 sentences. 本段說明測試集的準確率為 92%。'

    expect(cleanHighlightResponse(response, prompt, selected)).toBe('本段說明測試集的準確率為 92%。')
  })

  it('removes the leaked translation instruction and echoed English source', () => {
    const prompt = highlightTranslationPrompt(selected)
    const response = `The user wants translation of the highlighted text. Provide translation in Traditional Chinese, preserving format.${selected}\n準確率為 92%。\n使用了保留測試集。`

    expect(cleanHighlightResponse(response, prompt, selected)).toBe('準確率為 92%。\n使用了保留測試集。')
    expect(cleanHighlightResponse(response, '', selected)).toBe('準確率為 92%。\n使用了保留測試集。')
  })

  it('displays only the content of a JSON-wrapped summary', () => {
    const response = JSON.stringify({ summary: '本文概述了空間轉錄體技術與高通量視覺化平台。' }, null, 2)

    expect(cleanHighlightResponse(response, '', selected)).toBe('本文概述了空間轉錄體技術與高通量視覺化平台。')
  })

  it('unwraps fenced and nested JSON translation output', () => {
    const response = '```json\n{"result":{"translation":"準確率為 92%。"}}\n```'

    expect(cleanHighlightResponse(response, '', selected)).toBe('準確率為 92%。')
  })

  it('keeps ordinary Markdown and malformed JSON unchanged', () => {
    expect(cleanHighlightResponse('### 摘要\n保留 {重要條件}。', '', selected)).toBe('### 摘要\n保留 {重要條件}。')
    expect(cleanHighlightResponse('{ summary: 未加引號 }', '', selected)).toBe('{ summary: 未加引號 }')
  })
})
