/**
 * The activity ops functions' pure decisions (ADR-202): UTC day and week buckets, and the
 * collapse of stored codes to one plain word so free text never leaves through a code field.
 */
import type { InstantEvalDailyRunCount } from "@langwatch/instant-eval-contract";
import type { StaffAccessFunctionOutput } from "@langwatch/staff-access-contract";

import { isoOfMs } from "./staff-access-function.rules.ts";

export const DAY_MS = 24 * 60 * 60 * 1000;
export const WEEK_MS = 7 * DAY_MS;
const PLAIN_CODE = /^[a-z][a-z0-9_.-]{0,63}$/;

/** A stored agent kind or error code as it may leave: one plain lowercase word, else `other`. */
export function plainCode(stored: string): string {
  return PLAIN_CODE.test(stored) ? stored : "other";
}

/** The start of the UTC Monday week holding `ms`, epoch milliseconds. */
export function weekStartOf(ms: number): number {
  const dayIndex = Math.floor(ms / DAY_MS);
  const sinceMonday = (((dayIndex + 3) % 7) + 7) % 7;
  return (dayIndex - sinceMonday) * DAY_MS;
}

/** The starts of the last `weeks` UTC weeks up to the one holding `at`, oldest first. */
export function weekStartsBack({ weeks, at }: { weeks: number; at: number }): number[] {
  const current = weekStartOf(at);
  return Array.from({ length: weeks }, (_, index) => current - (weeks - 1 - index) * WEEK_MS);
}

/** Code counts merged into one record, stored codes collapsed first. */
export function mergeCodeCounts(
  into: Record<string, number>,
  counts: readonly { code: string; count: number }[],
): Record<string, number> {
  const merged = new Map(Object.entries(into));
  for (const { code, count } of counts) {
    const plain = plainCode(code);
    merged.set(plain, (merged.get(plain) ?? 0) + count);
  }
  return Object.fromEntries(merged);
}

/** Sums of `valueOf` per week start over rows dated by `dayOf`. */
export function sumByWeek<Row>({
  rows,
  dayOf,
  valueOf,
}: {
  rows: readonly Row[];
  dayOf: (row: Row) => number;
  valueOf: (row: Row) => number;
}): Map<number, number> {
  const sums = new Map<number, number>();
  for (const row of rows) {
    const week = weekStartOf(dayOf(row));
    sums.set(week, (sums.get(week) ?? 0) + valueOf(row));
  }
  return sums;
}
/** Instant Eval days folded per project into UTC Monday weeks, failure codes collapsed. */
export function foldInstantEvalWeeks(
  days: readonly InstantEvalDailyRunCount[],
): StaffAccessFunctionOutput<"org.instant_evals">["items"] {
  const weeks = new Map<
    string,
    StaffAccessFunctionOutput<"org.instant_evals">["items"][number] & { lastMs: number }
  >();
  for (const day of days) {
    const week = isoOfMs(weekStartOf(day.day));
    const key = `${week}/${day.projectId}`;
    const known = weeks.get(key);
    const lastMs = Math.max(known?.lastMs ?? 0, day.lastRunAt);
    weeks.set(key, {
      week,
      projectId: day.projectId,
      runs: (known?.runs ?? 0) + day.runs,
      judgedRows: (known?.judgedRows ?? 0) + day.judgedRows,
      largestRun: Math.max(known?.largestRun ?? 0, day.largestRun),
      failedRuns: (known?.failedRuns ?? 0) + day.failedRuns,
      failedByCode: mergeCodeCounts(known?.failedByCode ?? {}, day.failedByCode),
      priceUsd: (known?.priceUsd ?? 0) + day.priceUsd,
      lastRunAt: isoOfMs(lastMs),
      lastMs,
    });
  }
  return [...weeks.values()].map(({ lastMs: _lastMs, ...row }) => row);
}
