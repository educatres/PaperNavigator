import { describe, expect, it } from 'vitest'
import { normalizedSelectionRect } from '../pdf/pdfScreenshot'

describe('PDF screenshot selection', () => {
  it('normalizes a drag in either direction and clamps it to the page', () => {
    expect(normalizedSelectionRect({ x: 180, y: 90 }, { x: 20, y: -10 }, 200, 100)).toEqual({
      x: .1, y: 0, width: .8, height: .9,
    })
  })

  it('rejects accidental clicks and tiny drags', () => {
    expect(normalizedSelectionRect({ x: 10, y: 10 }, { x: 14, y: 17 }, 200, 100)).toBeNull()
    expect(normalizedSelectionRect({ x: 10, y: 10 }, { x: 18, y: 18 }, 0, 100)).toBeNull()
  })
})
