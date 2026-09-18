/** Day helpers for the agent-economics seed. All dates are UTC. */

export const DAY_MS = 24 * 60 * 60_000;

export function utcDayStart(epochMs: number): number {
  const d = new Date(epochMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/** Parse a YYYY-MM-DD anchor into the UTC midnight epoch, or real today. */
export function resolveToday(flag: string | undefined): number {
  if (!flag) return utcDayStart(Date.now());
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(flag);
  if (!match) throw new Error(`--today must be YYYY-MM-DD, got "${flag}"`);
  const [, y, m, d] = match;
  return Date.UTC(Number(y), Number(m) - 1, Number(d));
}

export function dateKey(epochMs: number): string {
  return new Date(epochMs).toISOString().slice(0, 10);
}

/** 0 = Sunday … 6 = Saturday, in UTC. */
export function dayOfWeek(epochMs: number): number {
  return new Date(epochMs).getUTCDay();
}

export function isWeekend(epochMs: number): boolean {
  const dow = dayOfWeek(epochMs);
  return dow === 0 || dow === 6;
}

/** First day (UTC midnight) of the fiscal year that contains `todayMs`. */
export function fiscalYearStart(todayMs: number): number {
  return Date.UTC(new Date(todayMs).getUTCFullYear(), 0, 1);
}

/** Whole days between two UTC-midnight epochs (b - a). */
export function daysBetween(aMs: number, bMs: number): number {
  return Math.round((utcDayStart(bMs) - utcDayStart(aMs)) / DAY_MS);
}
