/**
 * The way back in, and its expiry (D05, ADR-117 §5).
 *
 * A break-glass binding is one named person who may still sign in without
 * the identity provider while their organization's sign-in belongs to one,
 * and a date on which that stops. Activation asks whether such a person
 * exists, because the failure it prevents is the only one that cannot be
 * recovered from inside the product: a misconfigured connection goes live,
 * every member is handed to an identity provider that will not authenticate
 * them, and nobody is left who can turn it off.
 *
 * Pure and clock-free like the rest of this package. The rows live in the
 * app; whether a row is live, when to warn about it, and when to wake next
 * are decided here, so the sweep that sends the warnings and the surface
 * that renders them agree by construction.
 */

/**
 * How many days out somebody is told. Fourteen is far enough that renewing is
 * a calendar entry rather than an incident; one is close enough that the
 * person who ignored the first two still has a working morning.
 */
export const BREAK_GLASS_WARNING_DAYS = [14, 7, 1] as const;
export type BreakGlassWarningDay = (typeof BREAK_GLASS_WARNING_DAYS)[number];

const DAY_MS = 24 * 60 * 60 * 1000;

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
 * Whether a binding is a way in right now. Superseded rows are history and
 * expired ones are over — and nothing had to act for the second of those,
 * which is the point: the expiry is a comparison, not a job that might not
 * have run.
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
 * Which warnings are due now and have not been sent yet.
 *
 * A sweep that missed a mark — a worker down over a weekend, an installation
 * started after the fourteen-day point — still sends the marks it skipped,
 * because the question is "which of these has this binding passed", not
 * "which one is it exactly today". Every mark is sent at most once, which is
 * what `warnedDays` is for.
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
  return BREAK_GLASS_WARNING_DAYS.filter(
    (day) => remaining <= day && !sent.has(day),
  );
}

/**
 * When the sweep next has something to say about this binding, or null when
 * it has nothing left: every warning sent, or the binding already over.
 */
function breakGlassNextWarningAtMs({
  binding,
  nowMs,
}: {
  binding: BreakGlassBinding;
  nowMs: number;
}): number | null {
  if (!breakGlassIsLive({ binding, nowMs })) return null;
  const sent = new Set(binding.warnedDays);
  const upcoming = BREAK_GLASS_WARNING_DAYS.filter((day) => !sent.has(day)).map(
    (day) => binding.expiresAtMs - day * DAY_MS,
  );
  if (upcoming.length === 0) return null;
  return Math.max(nowMs, Math.min(...upcoming));
}
