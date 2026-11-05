import { describe, expect, it } from 'vitest'
import { normalizePass1Response, pass1Schema, validatePass1 } from '../domain/schemas'

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
