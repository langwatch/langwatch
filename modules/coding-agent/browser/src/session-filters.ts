import type { ReadableDate } from "@langwatch/coding-agent-browser-kit";

import type { SessionListRow } from "./session-list-row.ts";

export type Period = { startDate: ReadableDate; endDate: ReadableDate };
export type PeriodMode = "relative" | "absolute";

/** A period the reader picked, and which way they picked it. */
export interface PeriodSelection {
  period: Period;
  mode: PeriodMode;
}

/**
 * What the reader has to type to keep a row: everything named on the row,
 * plus branches and models that aren't — a session is often remembered by
 * its branch rather than its title. A numeric query also matches a pull request number.
 */
export function matchesSessionSearch({
  row,
  query,
}: {
  row: SessionListRow;
  query: string;
}): boolean {
  const needle = query.trim().toLowerCase();
  if (needle === "") return true;

  const digits = needle.startsWith("#") ? needle.slice(1) : needle;
  const isNumberMatch =
    /^\d+$/.test(digits) &&
    row.pullRequests.some((pullRequest) => String(pullRequest.number).includes(digits));
  if (isNumberMatch) {
    return true;
  }

  return [
    row.title ?? "",
    row.repositoryName,
    row.repositoryFullName,
    row.agent,
    ...row.gitBranches,
    ...row.models,
  ].some((field) => field.toLowerCase().includes(needle));
}

/** Whether a row's last update falls inside the period, if there is one. */
export function isWithinPeriod({
  lastUpdateAtMs,
  period,
}: {
  lastUpdateAtMs: number;
  period: Period | null;
}): boolean {
  if (period === null) return true;
  return lastUpdateAtMs >= period.startDate.getTime() && lastUpdateAtMs <= period.endDate.getTime();
}
