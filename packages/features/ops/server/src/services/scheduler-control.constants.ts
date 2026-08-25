/**
 * How long a claimed scheduler slot must remain untouched before an operator
 * may clear it. This stays above the scheduler loop's normal lease window.
 */
export const SLOT_STALE_AFTER_MS = 15 * 60_000;
