import { describe, expect, it, vi } from 'vitest'
import { structuredOutputContract } from '../ai/providers/provider'
import { generateWithFormatRetries, STRUCTURED_FORMAT_ATTEMPTS, STRUCTURED_FORMAT_RETRIES } from '../ai/orchestrator/structuredRetry'
import { parseJsonResponse } from '../domain/schemas'

const usage = { inputTokens: 1, outputTokens: 2, totalTokens: 3 }

describe('Structured response format retries', () => {
  it('uses targeted guidance across all three corrective retries', async () => {
    const responses = ['not json', '{"ok":', '{"ok":"yes"}', '{"ok":true}']
    const prompts: string[] = []
    const notices: number[] = []

    const response = await generateWithFormatRetries({
      stage: '表格分析',
      prompt: 'Analyze the table.',
      generate: async (prompt) => {
        prompts.push(prompt)
        return { text: responses[prompts.length - 1], usage }
      },
      parseAndValidate: (text) => {
        const parsed = parseJsonResponse(text) as { ok?: unknown }
        if (parsed.ok !== true) throw new Error('Invalid input: expected true')
        return parsed as { ok: true }
      },
      onRetry: ({ retry }) => notices.push(retry),
    })

    expect(response.result).toEqual({ ok: true })
    expect(response.attempts).toBe(4)
    expect(prompts).toHaveLength(4)
    expect(prompts[1]).toContain('JSON 格式修正重做 1/3')
    expect(prompts[1]).toContain('沒有可解析的 JSON object')
    expect(prompts[2]).toContain('JSON 格式修正重做 2/3')
    expect(prompts[2]).toContain('可能因輸出過長而被截斷')
    expect(prompts[3]).toContain('JSON 格式修正重做 3/3')
    expect(prompts[3]).toContain('欄位或型別不符合 schema')
    expect(notices).toEqual([1, 2, 3])
    expect(response.usage).toEqual({ inputTokens: 4, outputTokens: 8, totalTokens: 12 })
  })

  it('stops after three invalid responses and preserves a concise final error', async () => {
    const generate = vi.fn(async () => ({ text: 'invalid', usage }))

    await expect(generateWithFormatRetries({
      stage: '第二遍閱讀',
      prompt: 'Analyze.',
      generate,
      parseAndValidate: (text) => JSON.parse(text),
    })).rejects.toThrow('初次 API 回應與 3 次重做都不是可辨識且符合格式的 JSON')

    expect(generate).toHaveBeenCalledTimes(STRUCTURED_FORMAT_ATTEMPTS)
    expect(STRUCTURED_FORMAT_RETRIES).toBe(3)
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

  it('uses one format-only repair call based on the invalid output before normal retries', async () => {
    const repair = vi.fn(async (rawText: string, issue: string) => {
      expect(rawText).toBe('{"value":1}')
      expect(issue).toContain('欄位或型別不符合 schema')
      return { text: '{"value":"fixed"}', usage }
    })
    const response = await generateWithFormatRetries({
      stage: '第三遍閱讀',
      prompt: 'Analyze.',
      generate: async () => ({ text: '{"value":1}', usage }),
      repair,
      parseAndValidate: (text) => {
        const parsed = JSON.parse(text) as { value?: unknown }
        if (typeof parsed.value !== 'string') throw new Error('欄位或型別不符合 schema')
        return parsed as { value: string }
      },
    })

    expect(response.result).toEqual({ value: 'fixed' })
    expect(repair).toHaveBeenCalledOnce()
    expect(response.attempts).toBe(2)
    expect(response.usage).toEqual({ inputTokens: 2, outputTokens: 4, totalTokens: 6 })
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
