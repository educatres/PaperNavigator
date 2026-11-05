import { describe, expect, it } from 'vitest'
import { pass1Schema, validatePass1 } from '../domain/schemas'

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
})
