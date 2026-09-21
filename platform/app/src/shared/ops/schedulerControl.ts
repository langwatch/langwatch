/**
 * Thresholds both sides of the scheduler controls have to agree on (ADR-091).
 *
 * Framework-free and imported by the page and the service alike. They were
 * originally declared once per side with a comment asking the next person to
 * keep them equal, which is the arrangement that eventually offers an operator
 * a repair the server then refuses.
 */

/**
 * How long a claimed slot must sit untouched before clearing it is offered.
 *
 * Comfortably past the loop's lease window, so "stale" means the worker has
 * genuinely stopped rather than that it is mid-run. Offering the repair sooner
 * would invite an operator to race a healthy worker.
 */
export const SLOT_STALE_AFTER_MS = 15 * 60_000;
