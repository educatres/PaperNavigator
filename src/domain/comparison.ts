import type { MetricObservation, Paper } from './types'
import { assessComparability, metricDelta } from './calculations'

export interface ComparisonRow {
  paper: Paper
  observation: MetricObservation
}

export function comparisonRows(papers: Paper[], query: { task: string; dataset: string; metric: string }) {
  return papers.flatMap((paper) => paper.observations
    .filter((item) => !query.task || item.task.toLocaleLowerCase().includes(query.task.toLocaleLowerCase()))
    .filter((item) => !query.dataset || (item.dataset ?? '').toLocaleLowerCase().includes(query.dataset.toLocaleLowerCase()))
    .filter((item) => !query.metric || item.metricName.toLocaleLowerCase().includes(query.metric.toLocaleLowerCase()))
    .map((observation) => ({ paper, observation })))
}

export function compareRows(rows: ComparisonRow[]) {
  if (rows.length < 2) return { globallyComparable: false, pairs: [], reason: '至少需要兩筆結果。' }
  const pairs = rows.slice(1).map((row) => {
    const baseline = rows[0]
    const assessment = assessComparability(row.observation, baseline.observation)
    const delta = assessment.label === 'direct' && row.observation.numericValue !== null && baseline.observation.numericValue !== null
      ? metricDelta(row.observation.numericValue, baseline.observation.numericValue)
      : null
    return { baseline, current: row, assessment, delta }
  })
  const globallyComparable = pairs.every((pair) => pair.assessment.label === 'direct')
  return { globallyComparable, pairs, reason: globallyComparable ? '全部結果符合直接比較條件。' : '存在非直接可比結果，因此不顯示全體第一名。' }
}
