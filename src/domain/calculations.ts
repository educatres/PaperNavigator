import type { ComparabilityAssessment, MetricObservation } from './types'

export function metricDelta(current: number, baseline: number) {
  return {
    absolute: current - baseline,
    relativePercent: baseline === 0 ? null : ((current - baseline) / Math.abs(baseline)) * 100,
  }
}

export function percentagePointChange(currentPercent: number, baselinePercent: number) {
  return metricDelta(currentPercent, baselinePercent)
}

export function assessComparability(left: MetricObservation, right: MetricObservation): ComparabilityAssessment {
  const required = [left.task, right.task, left.dataset, right.dataset, left.datasetVersion, right.datasetVersion, left.split, right.split, left.metricDefinition, right.metricDefinition, left.protocol, right.protocol]
  if (required.some((value) => value === null || value === '') || left.direction === 'unknown' || right.direction === 'unknown') {
    return { label: 'insufficient', reasons: ['缺少任務、資料集版本、split、指標定義／方向或測試協議。'] }
  }
  const mismatches = [
    left.task !== right.task && '任務不同',
    left.dataset !== right.dataset && '資料集不同',
    left.datasetVersion !== right.datasetVersion && '資料集版本不同',
    left.split !== right.split && '測試 split 不同',
    left.metricName.toLocaleLowerCase() !== right.metricName.toLocaleLowerCase() && '指標名稱不同，需人工確認是否同義',
    left.metricDefinition !== right.metricDefinition && '指標定義不同',
    left.direction !== right.direction && '指標最佳化方向不同',
    left.protocol !== right.protocol && '測試協議不同',
  ].filter((value): value is string => Boolean(value))
  if (mismatches.length) return { label: 'not_comparable', reasons: mismatches }
  const fairness = [
    left.pretrainedData !== right.pretrainedData && '預訓練資料不同',
    left.hardware !== right.hardware && '硬體不同',
  ].filter((value): value is string => Boolean(value))
  return fairness.length
    ? { label: 'reference_only', reasons: fairness }
    : { label: 'direct', reasons: ['任務、資料集、split、指標定義與測試協議一致。'] }
}
