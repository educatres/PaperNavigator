import { describe, expect, it } from 'vitest'
import { highlightSummaryPrompt, highlightTranslationPrompt } from '../ai/prompts/prompts'

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
})
