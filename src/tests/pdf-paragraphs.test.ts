import { describe, expect, it } from 'vitest'
import { groupPdfParagraphRuns, type PdfTextRun } from '../pdf/pdfParagraphs'

function run(text: string, x: number, y: number, width = 200, itemIndex = 0): PdfTextRun {
  return { text, x, y, width, height: 12, itemIndex }
}

describe('PDF paragraph grouping', () => {
  it('joins nearby lines in the same column into one paragraph', () => {
    const groups = groupPdfParagraphRuns([
      run('This is the first line of a paragraph', 50, 100, 250, 0),
      run('and this is its second line', 50, 114, 220, 1),
      run('followed by the final line.', 50, 128, 190, 2),
    ], 600)

    expect(groups).toHaveLength(1)
    expect(groups[0].lines.map((line) => line.text)).toEqual([
      'This is the first line of a paragraph',
      'and this is its second line',
      'followed by the final line.',
    ])
  })

  it('never merges paragraph lines across a repeated two-column gutter', () => {
    const groups = groupPdfParagraphRuns([
      run('Left column first line', 40, 100, 190, 0),
      run('Right column first line', 350, 100, 190, 1),
      run('Left column second line', 40, 114, 190, 2),
      run('Right column second line', 350, 114, 190, 3),
    ], 600)

    expect(groups).toHaveLength(2)
    expect(groups[0].columnId).not.toBe(groups[1].columnId)
    expect(groups[0].lines.every((line) => line.x < 300)).toBe(true)
    expect(groups[1].lines.every((line) => line.x > 300)).toBe(true)
  })
})
