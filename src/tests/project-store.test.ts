import { describe, expect, it } from 'vitest'
import { migrateBundle } from '../storage/projectStore'
import type { ProjectBundle } from '../domain/types'

describe('project storage migration', () => {
  it('adds empty annotation lists to legacy papers', () => {
    const legacy = {
      schemaVersion: '1.0', exportedAt: '2026-01-01T00:00:00.000Z',
      project: { id: 'project', name: 'Legacy', researchQuestion: '', paperIds: ['paper'], createdAt: '', updatedAt: '' },
      papers: [{
        id: 'paper', projectId: 'project', sha256: 'hash', filename: 'paper.pdf', title: null, authors: [], year: null, doi: null,
        pageCount: 1, size: 100, uploadTime: '', tableAnalyses: [], citations: [], evidence: [], observations: [], notes: [],
      }],
      comparisons: [],
    } as unknown as ProjectBundle

    const paper = migrateBundle(legacy).papers[0]
    expect(paper.highlights).toEqual([])
    expect(paper.floatingNote).toBe('')
    expect(paper.aiRegionSummaries).toEqual([])
  })
})
