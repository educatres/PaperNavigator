import { describe, expect, it } from 'vitest'
import { verifyEvidence } from '../pdf/pdfClient'
import { comparisonCsv } from '../storage/exports'
import type { Paper } from '../domain/types'

describe('evidence verification', () => {
  it('normalizes whitespace and punctuation when matching a quote', () => {
    const [result] = verifyEvidence([{
      id: 'e1', paperId: 'p1', pdfPageIndex: 0, pdfPageDisplay: 1, printedPage: null,
      section: null, objectType: 'text', objectLabel: null, quote: 'Accuracy was 92.0%.',
      verificationStatus: 'unverified', notes: null,
    }], ['The experiment reports: Accuracy was 92.0 % on the held-out test set.'])
    expect(result.verificationStatus).toBe('matched')
  })
})

describe('CSV export', () => {
  it('escapes values that spreadsheet software could execute as formulas', () => {
    const paper: Paper = {
      id: 'p', projectId: 'project', sha256: 'hash', filename: 'p.pdf', title: '=HYPERLINK("bad")',
      authors: [], year: null, doi: null, pageCount: 1, size: 1, uploadTime: '', tableAnalyses: [], citations: [], evidence: [], notes: [], highlights: [],
      observations: [{ id: 'o', paperId: 'p', methodName: '+SUM(1,1)', methodOrigin: 'paper_proposed', task: 'task', dataset: null, datasetVersion: null, split: null, metricName: 'Accuracy', metricDefinition: null, direction: 'higher', rawValue: '92%', numericValue: 92, unit: '%', dispersion: null, pretrainedData: null, hardware: null, protocol: null, status: 'reported', evidenceIds: [] }],
    }
    const csv = comparisonCsv([paper])
    expect(csv).toContain("'=HYPERLINK")
    expect(csv).toContain("'+SUM")
  })
})
