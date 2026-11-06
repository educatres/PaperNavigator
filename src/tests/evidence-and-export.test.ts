import { describe, expect, it } from 'vitest'
import { pagesForPrompt, verifyEvidence } from '../pdf/pdfClient'
import { comparisonCsv, fullReportHtmlDocument, paperMarkdown, pass3HtmlDocument } from '../storage/exports'
import type { Paper, PdfDocumentData } from '../domain/types'

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

describe('full-document prompt context', () => {
  it('keeps later pages instead of truncating the prompt at a fixed character cap', () => {
    const document = { pagesText: ['a'.repeat(160_000), '最後一頁的內容'] } as PdfDocumentData
    const prompt = pagesForPrompt(document)
    expect(prompt).toContain('[PDF page 1; pdfPageIndex 0]')
    expect(prompt).toContain('[PDF page 2; pdfPageIndex 1]')
    expect(prompt).toContain('最後一頁的內容')
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

describe('annotation export', () => {
  it('includes highlights, source locations, and AI region summaries in Markdown', () => {
    const paper: Paper = {
      id: 'p', projectId: 'project', sha256: 'hash', filename: 'p.pdf', title: 'Paper',
      authors: [], year: null, doi: null, pageCount: 2, size: 1, uploadTime: '', tableAnalyses: [], citations: [],
      evidence: [{ id: 'e1', paperId: 'p', pdfPageIndex: 1, pdfPageDisplay: 2, printedPage: null, section: null, objectType: 'text', objectLabel: null, quote: '定位文字', verificationStatus: 'matched', notes: null }],
      observations: [], notes: [],
      highlights: [{ id: 'h1', paperId: 'p', pdfPageIndex: 0, x: 0, y: 0, width: 1, height: 0.1, color: 'yellow', text: '螢光文字', aiSummary: '摘要文字', translation: '翻譯文字', createdAt: '' }],
      aiRegionSummaries: [{ id: 'a1', paperId: 'p', pdfPageIndex: 1, summary: '圈選摘要', createdAt: '' }],
    }

    const markdown = paperMarkdown(paper)
    expect(markdown).toContain('螢光文字')
    expect(markdown).toContain('摘要文字')
    expect(markdown).toContain('翻譯文字')
    expect(markdown).toContain('定位文字')
    expect(markdown).toContain('圈選摘要')
  })
})

describe('third-pass HTML export', () => {
  it('creates an HTML document from HTML or Markdown while removing unsafe markup', () => {
    const paper = {
      id: 'p', projectId: 'project', sha256: 'hash', filename: 'p.pdf', title: 'Paper',
      authors: [], year: null, doi: null, pageCount: 1, size: 1, uploadTime: '', tableAnalyses: [], citations: [], evidence: [], notes: [], highlights: [], observations: [],
    } as Paper
    const html = pass3HtmlDocument(paper, '<section><h2 onclick="bad()">重建</h2><script>bad()</script><p><span style="color:#B42318">重點</span>內容</p></section>')

    expect(html).toContain('<main><section><h2>重建</h2><p><span style="color:#b42318">重點</span>內容</p></section></main>')
    expect(html).toContain('background:#fff;color:#111')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<script>')
  })
})

describe('A4 full report HTML export', () => {
  const completePaper = (): Paper => ({
    id: 'p', projectId: 'project', sha256: 'hash', filename: 'paper.pdf', title: 'Paper <One>',
    authors: ['Ada'], year: 2026, doi: null, pageCount: 8, size: 1, uploadTime: '', tableAnalyses: [], citations: [], notes: [], highlights: [], observations: [],
    evidence: [{ id: 'e1', paperId: 'p', pdfPageIndex: 1, pdfPageDisplay: 2, printedPage: null, section: 'Methods', objectType: 'text', objectLabel: null, quote: 'Evidence <quoted>', verificationStatus: 'matched', notes: null }],
    pass1: {
      schemaVersion: '1.0', promptVersion: 'pass1.v1', title: 'Paper <One>', authors: ['Ada'], year: 2026, doi: null,
      oneSentenceTopic: 'Topic', researchQuestion: 'Question?', field: 'HCI', paperType: 'Study', outline: ['Intro'],
      fiveCs: [{ name: 'Category', summary: 'Category summary', evidenceIds: ['e1'] }], contributions: ['Contribution'],
      readingDecision: { recommendation: 'continue', reason: 'Relevant' }, unclearConcepts: ['Term'], evidence: [],
    },
    pass2: {
      schemaVersion: '1.0', promptVersion: 'pass2.v1', motivation: 'Motivation', problemDefinition: 'Problem', inputOutput: 'Input to output',
      methodSteps: ['Step'], modules: ['Module'], trainingSetup: null, inferenceSetup: null,
      datasets: [{ name: 'Dataset', version: null, size: null, split: null, externalValidation: null, leakageRisk: null, status: 'reported', evidenceIds: ['e1'] }],
      metrics: [{ name: 'Accuracy', definition: null, direction: 'higher', unit: '%', evidenceIds: ['e1'] }], figures: [], tables: [],
      claims: [{ claim: 'Claim', support: 'Support', limitation: 'Limit', evidenceIds: ['e1'] }], guideQuestions: ['Why?'], observations: [], references: [], evidence: [],
    },
    pass3Text: '<section><h2 onclick="bad()">Reconstruction</h2><script>bad()</script><p>Safe report</p></section>',
  })

  it('combines all three passes, evidence, safe markup, and A4 print styles', () => {
    const html = fullReportHtmlDocument(completePaper())

    expect(html).toContain('@page{size:A4')
    expect(html).toContain('第一遍：鳥瞰')
    expect(html).toContain('第二遍：理解')
    expect(html).toContain('第三遍：重建與批判')
    expect(html).toContain('證據附錄')
    expect(html).toContain('href="#evidence-1"')
    expect(html).toContain('Evidence &lt;quoted&gt;')
    expect(html).toContain('<h2>Reconstruction</h2>')
    expect(html).not.toContain('onclick')
    expect(html).not.toContain('<script>')
    expect(html).toContain('Paper &lt;One&gt;')
  })

  it('rejects export before the third pass is complete', () => {
    const paper = completePaper()
    paper.pass3Text = undefined
    expect(() => fullReportHtmlDocument(paper)).toThrow('請先完成三遍閱讀')
  })

  it('supports the legacy structured third-pass result', () => {
    const paper = completePaper()
    paper.pass3Text = undefined
    paper.pass3 = {
      schemaVersion: '1.0', promptVersion: 'pass3.v1',
      reconstruction: [{ step: 'Rebuild', detail: 'Reconstruction detail', status: 'explicit', evidenceIds: ['e1'] }],
      assumptions: [{ title: 'Assumption', assessment: 'Assessment', status: 'needs_verification', evidenceIds: [] }],
      threats: [], reproducibilityRisks: [],
      researchIdeas: [{ question: 'Next question?', motivation: 'Motivation', hypothesis: 'Hypothesis', minimumExperiment: 'Experiment', requiredData: 'Data', metric: 'Metric' }],
    }

    const html = fullReportHtmlDocument(paper)
    expect(html).toContain('Reconstruction detail')
    expect(html).toContain('Assumption')
    expect(html).toContain('Next question?')
  })
})
