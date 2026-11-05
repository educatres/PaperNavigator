import { describe, expect, it } from 'vitest'
import { assessComparability, metricDelta, percentagePointChange } from '../domain/calculations'
import type { MetricObservation } from '../domain/types'

const observation = (overrides: Partial<MetricObservation> = {}): MetricObservation => ({
  id: 'o1', paperId: 'p1', methodName: 'Method', methodOrigin: 'paper_proposed',
  task: 'classification', dataset: 'Dataset A', datasetVersion: '1', split: 'test',
  metricName: 'Accuracy', metricDefinition: 'top-1 accuracy', direction: 'higher',
  rawValue: '90%', numericValue: 90, unit: '%', dispersion: null, pretrainedData: 'ImageNet',
  hardware: 'A100', protocol: 'official test', status: 'reported', evidenceIds: ['e1'], ...overrides,
})

describe('comparison calculations', () => {
  it('separates percentage points from relative percentage', () => {
    const value = percentagePointChange(92, 90)
    expect(value.absolute).toBe(2)
    expect(value.relativePercent).toBeCloseTo(2.2222, 3)
  })

  it('does not divide by a zero baseline', () => {
    expect(metricDelta(4, 0)).toEqual({ absolute: 4, relativePercent: null })
  })

  it('blocks direct comparison across datasets', () => {
    const result = assessComparability(observation(), observation({ dataset: 'Dataset B' }))
    expect(result.label).toBe('not_comparable')
    expect(result.reasons).toContain('資料集不同')
  })

  it('downgrades otherwise equal results when hardware differs', () => {
    const result = assessComparability(observation(), observation({ hardware: 'H100' }))
    expect(result.label).toBe('reference_only')
  })

  it('treats a missing protocol as insufficient information', () => {
    const result = assessComparability(observation(), observation({ protocol: null }))
    expect(result.label).toBe('insufficient')
  })
})
