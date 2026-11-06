import { describe, expect, it, vi } from 'vitest'
import { structuredOutputContract } from '../ai/providers/provider'
import { generateWithFormatRetries, STRUCTURED_FORMAT_ATTEMPTS } from '../ai/orchestrator/structuredRetry'

const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 }

describe('Structured response format retries', () => {
  it('forces a complete redo and succeeds on the third attempt', async () => {
    const responses = ['not json', '```json\n{"ok":true}\n```', '{"ok":true}']
    const prompts: string[] = []
    const notices: number[] = []

    const response = await generateWithFormatRetries({
      stage: '表格分析',
      prompt: 'Analyze the table.',
      generate: async (prompt) => {
        prompts.push(prompt)
        return { text: responses[prompts.length - 1], usage }
      },
      parseAndValidate: (text) => JSON.parse(text) as { ok: boolean },
      onRetry: ({ attempt }) => notices.push(attempt),
    })

    expect(response.result).toEqual({ ok: true })
    expect(response.attempts).toBe(3)
    expect(prompts).toHaveLength(3)
    expect(prompts[1]).toContain('JSON 格式修正重做 2/3')
    expect(prompts[2]).toContain('JSON 格式修正重做 3/3')
    expect(notices).toEqual([2, 3])
    expect(response.usage).toEqual({ inputTokens: 3, outputTokens: 6, totalTokens: 9 })
  })

  it('stops after three invalid responses and preserves a concise final error', async () => {
    const generate = vi.fn(async () => ({ text: 'invalid', usage }))

    await expect(generateWithFormatRetries({
      stage: '第二遍閱讀',
      prompt: 'Analyze.',
      generate,
      parseAndValidate: (text) => JSON.parse(text),
    })).rejects.toThrow('連續 3 次不是可辨識且符合格式的 JSON')

    expect(generate).toHaveBeenCalledTimes(STRUCTURED_FORMAT_ATTEMPTS)
  })

  it('retries JSON that parses but fails the required schema', async () => {
    const responses = ['{"value":1}', '{"value":"ok"}']
    const generate = vi.fn(async () => ({ text: responses[generate.mock.calls.length - 1], usage }))

    const response = await generateWithFormatRetries({
      stage: '表格分析',
      prompt: 'Analyze.',
      generate,
      parseAndValidate: (text) => {
        const parsed = JSON.parse(text) as { value?: unknown }
        if (typeof parsed.value !== 'string') throw new Error('value must be a string')
        return parsed as { value: string }
      },
    })

    expect(response.result).toEqual({ value: 'ok' })
    expect(response.attempts).toBe(2)
    expect(generate).toHaveBeenCalledTimes(2)
  })

  it('does not turn network or permission failures into format retries', async () => {
    const generate = vi.fn(async () => { throw new Error('API Key 無效或遺失') })

    await expect(generateWithFormatRetries({
      stage: '第一遍閱讀',
      prompt: 'Analyze.',
      generate,
      parseAndValidate: JSON.parse,
    })).rejects.toThrow('API Key 無效或遺失')

    expect(generate).toHaveBeenCalledOnce()
  })

  it('includes the exact schema and JSON-only rules in every provider request', () => {
    const contract = structuredOutputContract({
      type: 'object', properties: { value: { type: 'string' } }, required: ['value'],
    })

    expect(contract).toContain('第一個非空白字元必須是 {')
    expect(contract).toContain('禁止 Markdown 程式碼區塊')
    expect(contract).toContain('"required":["value"]')
  })
})
