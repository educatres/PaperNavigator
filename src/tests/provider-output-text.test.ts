import { describe, expect, it } from 'vitest'
import { googleText, responsesText } from '../ai/providers/outputText'

describe('provider output text extraction', () => {
  it('keeps only final assistant output from a Responses API payload', () => {
    expect(responsesText({
      output: [
        { type: 'reasoning', content: [{ type: 'summary_text', text: 'Need to produce Chinese summary.' }] },
        { type: 'message', role: 'assistant', channel: 'analysis', content: [{ type: 'output_text', text: 'The user wants a translation.' }] },
        { type: 'message', role: 'assistant', channel: 'final', content: [{ type: 'output_text', text: '這是最後答案。' }] },
      ],
    })).toBe('這是最後答案。')
  })

  it('falls back to output_text when no output items are present', () => {
    expect(responsesText({ output_text: '這是相容格式的答案。' })).toBe('這是相容格式的答案。')
  })

  it('excludes Google thought parts from visible output', () => {
    expect(googleText({ candidates: [{ content: { parts: [
      { thought: true, text: 'Need to produce Chinese summary.' },
      { text: '這是可見摘要。' },
    ] } }] })).toBe('這是可見摘要。')
  })
})
