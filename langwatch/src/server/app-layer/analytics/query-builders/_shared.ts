/**
 * Internal helpers shared by the slim + rollup timeseries SQL builders
 * (ADR-034 Phase 3 app-layer module). Both builders need the same
 * `toStartOf…` bucket function over different time columns; centralising
 * keeps bucket boundaries identical between the two destination tables
 * (and identical to the legacy `trace_summaries` builder for parity).
 */

const MINUTES_PER_HOUR = 60;
const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
const DAYS_PER_WEEK = 7;
const DAYS_PER_MONTH = 31;

export function validateTimeZone(tz: string): string {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: tz });
    return tz;
  } catch {
    return "UTC";
  }
}

/**
 * Build a ClickHouse date-bucket function over a given column for a given
 * timeScale (in minutes) and timezone. Mirrors the legacy builder's logic
 * exactly so the bucket boundaries match the trace_summaries path.
 */
export function dateTrunc(
  column: string,
  timeScaleMinutes: number,
  timeZone: string,
): string {
  const tz = validateTimeZone(timeZone);
  if (timeScaleMinutes <= 1) {
    return `toStartOfMinute(${column}, '${tz}')`;
  } else if (timeScaleMinutes < MINUTES_PER_DAY) {
    if (timeScaleMinutes % MINUTES_PER_HOUR === 0) {
      const hours = timeScaleMinutes / MINUTES_PER_HOUR;
      return `toStartOfInterval(${column}, INTERVAL ${hours} HOUR, '${tz}')`;
    }
    return `toStartOfInterval(${column}, INTERVAL ${timeScaleMinutes} MINUTE, '${tz}')`;
  } else {
    const days = Math.floor(timeScaleMinutes / MINUTES_PER_DAY);
    if (days === 1) return `toStartOfDay(${column}, '${tz}')`;
    if (days <= DAYS_PER_WEEK)
      return `toStartOfInterval(${column}, INTERVAL ${days} DAY, '${tz}')`;
    if (days <= DAYS_PER_MONTH) return `toStartOfWeek(${column}, 1, '${tz}')`;
    return `toStartOfMonth(${column}, '${tz}')`;
  }
}

export function hasFilterValues(
  v:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>
    | undefined,
): boolean {
  if (v === undefined) return false;
  if (Array.isArray(v)) return v.length > 0;
  if (typeof v !== "object") return false;
  for (const inner of Object.values(v)) {
    if (Array.isArray(inner) && inner.length > 0) return true;
    if (typeof inner === "object" && inner !== null) {
      for (const vv of Object.values(inner)) {
        if (Array.isArray(vv) && vv.length > 0) return true;
      }
    }
  }
  return false;
}

export function collectStringValues(
  value:
    | string[]
    | Record<string, string[]>
    | Record<string, Record<string, string[]>>,
): string[] {
  if (Array.isArray(value)) return value;
  const out: string[] = [];
  for (const inner of Object.values(value)) {
    if (Array.isArray(inner)) {
      out.push(...inner);
      continue;
    }
    if (typeof inner === "object" && inner !== null) {
      for (const v of Object.values(inner)) {
        if (Array.isArray(v)) out.push(...v);
      }
    }
  }
  return out;
}
