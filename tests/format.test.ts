import { describe, it, expect } from 'vitest'
import { formatCurrency } from '../utils/format'

describe('formatCurrency', () => {
  it('formats cents as USD currency string', () => {
    expect(formatCurrency(1999)).toBe('$19.99')
  })

  it('formats zero as $0.00', () => {
    expect(formatCurrency(0)).toBe('$0.00')
  })

  it('formats large amounts correctly', () => {
    expect(formatCurrency(100000)).toBe('$1,000.00')
  })
})
