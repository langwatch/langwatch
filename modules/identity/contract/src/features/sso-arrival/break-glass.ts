/**
 * The way back in, and its expiry (D05, ADR-117 §5). Pure and clock-free, so
 * the sweep that sends the warnings and the surface that renders them agree
 * by construction.
 */

/**
 * Fourteen is far enough that renewing is a calendar entry rather than an
 * incident; one is close enough that whoever ignored the first two still has
 * a working morning.
 */
export const BREAK_GLASS_WARNING_DAYS = [14, 7, 1] as const;
export type BreakGlassWarningDay = (typeof BREAK_GLASS_WARNING_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * The longest a way in may be granted for. Ninety days covers a migration or
 * a contested rollout and still forces somebody to look again in a quarter —
 * the expiry is the whole of what stops a permanent second door.
 */
export const BREAK_GLASS_MAX_WINDOW_DAYS = 90;
export const BREAK_GLASS_MAX_WINDOW_MS = BREAK_GLASS_MAX_WINDOW_DAYS * DAY_MS;

/**
 * Whether this expiry is one a grant may carry: in the future, and inside the
 * window. Pure, so the guard and the surface ask the same question.
 */
export function breakGlassExpiryIsAllowed({
  expiresAtMs,
  nowMs,
  maxWindowMs = BREAK_GLASS_MAX_WINDOW_MS,
}: {
  expiresAtMs: number;
  nowMs: number;
  maxWindowMs?: number;
}): boolean {
  return expiresAtMs > nowMs && expiresAtMs <= nowMs + maxWindowMs;
}

/**
 * One binding as everything that reads them sees it. Immutable: a renewal
 * writes a NEW binding naming the one it replaced, so the date a way in
 * previously ended is still readable afterwards.
 */
export interface BreakGlassBinding {
  bindingId: string;
  organizationId: string;
  /** Who holds the way in. */
  userId: string;
  /** Who granted it. A way back in is never self-served. */
  grantedByUserId: string;
  grantedAtMs: number;
  expiresAtMs: number;
  /** Set when a renewal replaced this row. */
  supersededAtMs: number | null;
  /** The binding this one renewed, or null for a first grant. */
  renewedFromBindingId: string | null;
  /** Which warnings have already been sent, so a sweep never repeats one. */
  warnedDays: number[];
}

/**
 * Superseded rows are history, expired ones are over — and nothing had to act
 * for the second: the expiry is a comparison, not a job that might not run.
 */
export function breakGlassIsLive({
  binding,
  nowMs,
}: {
  binding: BreakGlassBinding;
  nowMs: number;
}): boolean {
  if (binding.supersededAtMs !== null) return false;
  return nowMs < binding.expiresAtMs;
}

/** Whole days left before a binding ends, rounded UP: with anything left of
 *  the last day, a person still has that day. */
export function breakGlassDaysRemaining({
  binding,
  nowMs,
}: {
  binding: BreakGlassBinding;
  nowMs: number;
}): number {
  return Math.max(0, Math.ceil((binding.expiresAtMs - nowMs) / DAY_MS));
}

/**
 * A sweep that missed a mark still sends it: the question is which marks this
 * binding has passed, not which one is exactly today. `warnedDays` keeps each
 * to once.
 */
export function breakGlassWarningsDue({
  binding,
  nowMs,
}: {
  binding: BreakGlassBinding;
  nowMs: number;
}): number[] {
  if (!breakGlassIsLive({ binding, nowMs })) return [];
  const remaining = breakGlassDaysRemaining({ binding, nowMs });
  const sent = new Set(binding.warnedDays);

  return BREAK_GLASS_WARNING_DAYS.filter((day) => remaining <= day && !sent.has(day));
}

/**
 * One grant as a surface reads it: the row, with the two people on it named.
 * A view rather than the binding, because "who can still get in" answered in
 * user ids answers it for nobody.
 */
export interface BreakGlassGrantView {
  bindingId: string;
  userId: string;
  name: string | null;
  email: string | null;
  grantedByUserId: string;
  grantedByName: string | null;
  grantedAtMs: number;
  expiresAtMs: number;
  supersededAtMs: number | null;
  live: boolean;
  daysRemaining: number;
}

/** Somebody a way back in can be granted to: an administrator, today. */
export interface BreakGlassCandidateView {
  userId: string;
  name: string | null;
  email: string | null;
}
