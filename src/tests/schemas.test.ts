import { describe, expect, it } from 'vitest'
import { normalizePass1Response, normalizePass2Response, normalizePass3Response, normalizeTableResponse, parseJsonResponse, pass1Schema, pass2Schema, pass3Schema, schemaValidationMessage, tableAnalysisSchema, validatePass1 } from '../domain/schemas'

function validPass1() {
  return {
    schemaVersion: '1.0', promptVersion: 'pass1.v1', title: 'Paper', authors: ['A. Author'], year: 2025, doi: null,
    oneSentenceTopic: '一篇測試論文', researchQuestion: '如何測試？', field: 'Testing', paperType: 'Empirical', outline: ['Introduction'],
    fiveCs: ['Category', 'Context', 'Correctness', 'Contributions', 'Clarity'].map((name) => ({ name, summary: `${name} summary`, evidenceIds: ['e1'] })),
    contributions: ['貢獻一'], readingDecision: { recommendation: 'continue', reason: '值得深入' }, unclearConcepts: [],
    evidence: [{ id: 'e1', paperId: '', pdfPageIndex: 1, pdfPageDisplay: 2, printedPage: null, section: 'Methods', objectType: 'text', objectLabel: null, quote: 'source quote', verificationStatus: 'unverified', notes: null }],
  }
}

describe('Pass 1 validation', () => {
  it('accepts the complete five-C structure', () => {
    expect(pass1Schema.parse(validPass1()).fiveCs).toHaveLength(5)
  })

  it('marks out-of-range evidence as mismatch', () => {
    const input = validPass1()
    input.evidence[0].pdfPageIndex = 9
    input.evidence[0].pdfPageDisplay = 10
    const parsed = validatePass1(input, 2, 'paper-1')
    expect(parsed.evidence[0].paperId).toBe('paper-1')
    expect(parsed.evidence[0].verificationStatus).toBe('mismatch')
  })

  it('rejects a missing five-C item', () => {
    const input = validPass1()
    input.fiveCs.pop()
    expect(() => pass1Schema.parse(input)).toThrow()
  })

  it('normalizes a compact provider response before strict validation', () => {
    const compact = {
      schemaVersion: 1,
      topic: '精簡格式的研究主題',
      question: '模型回傳格式不同時如何處理？',
      domain: 'Software Engineering',
      category: 'Empirical',
      fiveCs: {
        category: { summary: '實證研究', evidence: ['source-1'] },
        context: '延續既有結構化輸出研究',
        correctness: '仍需人工核對',
        contributions: '提出相容層',
        clarity: '敘述清楚',
      },
      mainContributions: ['相容精簡 JSON'],
      decision: 'continue',
      evidence: [{ id: 'source-1', page: 2, section: 'Methods', excerpt: 'A compact response.' }],
    }
    const parsed = validatePass1(compact, 4, 'paper-compact')
    expect(parsed.schemaVersion).toBe('1.0')
    expect(parsed.fiveCs).toHaveLength(5)
    expect(parsed.fiveCs[0].evidenceIds).toEqual(['source-1'])
    expect(parsed.evidence[0]).toMatchObject({
      paperId: 'paper-compact', pdfPageIndex: 1, pdfPageDisplay: 2,
      objectType: 'text', verificationStatus: 'unverified', printedPage: null, notes: null,
    })
  })

  it('unwraps a nested result and uses explicit missing-information labels', () => {
    const normalized = normalizePass1Response({ result: { summary: '只有摘要', evidence: [] } })
    const parsed = pass1Schema.parse(normalized)
    expect(parsed.oneSentenceTopic).toBe('只有摘要')
    expect(parsed.researchQuestion).toBe('未找到研究問題')
    expect(parsed.authors).toEqual([])
  })
})

describe('Pass 2 compatibility', () => {
  it('accepts a useful compact response and fills omitted structural fields', () => {
    const parsed = pass2Schema.parse(normalizePass2Response({ result: {
      motivation: '降低推論成本',
      problem: '如何維持準確率？',
      steps: ['壓縮模型', '評估結果'],
      results: [{ method: 'Method A', task: '分類', metric: 'Accuracy', value: '92%' }],
    } }))

    expect(parsed.problemDefinition).toBe('如何維持準確率？')
    expect(parsed.methodSteps).toEqual(['壓縮模型', '評估結果'])
    expect(parsed.observations[0]).toMatchObject({ methodName: 'Method A', metricName: 'Accuracy', rawValue: '92%' })
    expect(parsed.datasets).toEqual([])
    expect(parsed.evidence).toEqual([])
  })
})

describe('Best-effort structured response compatibility', () => {
  it('accepts a partial third reading and leaves omitted sections empty', () => {
    const parsed = pass3Schema.parse(normalizePass3Response({ analysis: {
      assumptions: ['資料切分方式需要確認'],
      ideas: [{ question: '能否在外部資料集重現？' }],
    } }))

    expect(parsed.reconstruction).toEqual([])
    expect(parsed.assumptions[0]).toMatchObject({
      title: '資料切分方式需要確認', status: 'indeterminate', evidenceIds: [],
    })
    expect(parsed.researchIdeas[0]).toMatchObject({
      question: '能否在外部資料集重現？', motivation: '未報告', metric: '未報告',
    })
    expect(parsed.threats).toEqual([])
  })

  it('accepts a partial table response and normalizes primitive cells', () => {
    const parsed = tableAnalysisSchema.parse(normalizeTableResponse({ result: {
      caption: '主要結果',
      headers: ['方法', '準確率'],
      rows: [['Method A', { value: '92%', bold: true }]],
      results: [{ method: 'Method A', metric: 'Accuracy', value: '92%' }],
    } }))

    expect(parsed).toMatchObject({
      title: '主要結果', columns: ['方法', '準確率'], footnotes: [], positioning: [], tradeoffs: [], limitations: [], evidence: [],
    })
    expect(parsed.rows[0]).toEqual([
      { raw: 'Method A', emphasized: false },
      { raw: '92%', emphasized: true },
    ])
    expect(parsed.observations[0]).toMatchObject({ methodName: 'Method A', metricName: 'Accuracy', rawValue: '92%' })
  })

  it('recovers keyed table rows and compact observation maps', () => {
    const parsed = tableAnalysisSchema.parse(normalizeTableResponse({ data: { tableAnalysis: {
      tableTitle: '主要結果',
      headers: [{ name: '方法' }, { label: 'Accuracy' }],
      rows: [{ cells: { 方法: 'Ours', Accuracy: { display: '92%', is_bold: true } } }, { 方法: 'Baseline', Accuracy: '88%' }],
      observations: [{ method: 'Ours', metrics: { Accuracy: '92%' } }, { method: 'Baseline', metrics: { Accuracy: '88%' } }],
    } } }))

    expect(parsed.columns).toEqual(['方法', 'Accuracy'])
    expect(parsed.rows).toEqual([
      [{ raw: 'Ours', emphasized: false }, { raw: '92%', emphasized: true }],
      [{ raw: 'Baseline', emphasized: false }, { raw: '88%', emphasized: false }],
    ])
    expect(parsed.observations).toEqual(expect.arrayContaining([
      expect.objectContaining({ methodName: 'Ours', metricName: 'Accuracy', rawValue: '92%' }),
      expect.objectContaining({ methodName: 'Baseline', metricName: 'Accuracy', rawValue: '88%' }),
    ]))

    const single = tableAnalysisSchema.parse(normalizeTableResponse({ observations: { method: 'Ours', metric: 'Accuracy', value: '92%' } }))
    expect(single.observations).toHaveLength(1)
    expect(single.observations[0]).toMatchObject({ methodName: 'Ours', metricName: 'Accuracy', rawValue: '92%' })

    const oneRow = tableAnalysisSchema.parse(normalizeTableResponse({ headers: ['方法', 'Accuracy'], rows: { method: 'Ours', Accuracy: '92%' } }))
    expect(oneRow.rows).toEqual([[{ raw: 'Ours', emphasized: false }, { raw: '92%', emphasized: false }]])
  })

  it('allows every analysis stage to omit non-returned sections', () => {
    expect(() => validatePass1({}, 1, 'paper-1')).not.toThrow()
    expect(() => pass2Schema.parse(normalizePass2Response({}))).not.toThrow()
    expect(() => pass3Schema.parse(normalizePass3Response({}))).not.toThrow()
    expect(() => tableAnalysisSchema.parse(normalizeTableResponse({}))).not.toThrow()
  })

  it('does not expose a missing-field count if conversion is impossible', () => {
    const result = tableAnalysisSchema.safeParse({})
    expect(result.success).toBe(false)
    if (!result.success) expect(schemaValidationMessage(result.error, '表格分析')).not.toContain('個欄位')
  })
})

describe('Recoverable JSON response parsing', () => {
  it('accepts exactly one JSON object', () => {
    expect(parseJsonResponse('  {"ok":true}  ')).toEqual({ ok: true })
  })

  it.each([
    ['```json\n{"ok":true}\n```', { ok: true }],
    ['以下是結果：{"ok":true}。', { ok: true }],
    ['```json\n{"ok":true,}\n```', { ok: true }],
    ['說明 {"text":"保留字串內的 } 符號","nested":{"value":1}} 完成', { text: '保留字串內的 } 符號', nested: { value: 1 } }],
  ])('repairs a common model wrapper before requesting another API call', (raw, expected) => {
    expect(parseJsonResponse(raw)).toEqual(expected)
  })

  it('still rejects a top-level array', () => {
    expect(() => parseJsonResponse('[{"ok":true}]')).toThrow('JSON 頂層必須是 object')
  })

  it('identifies a likely truncated object for targeted retry guidance', () => {
    expect(() => parseJsonResponse('{"ok":')).toThrow('可能被截斷或括號未閉合')
  })
})
