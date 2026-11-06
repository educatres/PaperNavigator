import { describe, expect, it } from 'vitest'
import { highlightSummaryPrompt, highlightTranslationPrompt } from '../ai/prompts/prompts'

describe('highlight AI prompts', () => {
  const selected = 'Accuracy was 92%.\nThe held-out test set was used.'

  it('sends exactly the displayed highlight text to the summary prompt', () => {
    const prompt = highlightSummaryPrompt(selected)

    expect(prompt).toContain(selected)
    expect(prompt).toContain('螢光筆與 AI 摘要')
    expect(prompt).toContain('不得使用 PDF 其他頁面')
  })

  it('limits translation to every line in the selected highlight', () => {
    const prompt = highlightTranslationPrompt(selected)

    expect(prompt).toContain(selected)
    expect(prompt).toContain('跨越的所有行與句子')
    expect(prompt).toContain('不得翻譯或補充螢光區域以外的內容')
  })
})
