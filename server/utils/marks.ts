export const MAX_REASON_LENGTH = 500

export function validateMarkReason(
  reason: unknown,
): { valid: true; value: string } | { valid: false; error: string } {
  if (typeof reason !== 'string' || !reason.trim()) {
    return { valid: false, error: 'reason is required' }
  }
  const trimmed = reason.trim()
  if (trimmed.length > MAX_REASON_LENGTH) {
    return { valid: false, error: `reason must not exceed ${MAX_REASON_LENGTH} characters` }
  }
  return { valid: true, value: trimmed }
}
