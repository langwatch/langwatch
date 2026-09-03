import type { SessionListRow } from "./session-list-row";

export type Period = { startDate: Date; endDate: Date };
export type PeriodMode = "relative" | "absolute";

/** A period the reader picked, and which way they picked it. */
export interface PeriodSelection {
  period: Period;
  mode: PeriodMode;
}

/**
 * What the reader has to type to keep a row. Everything named on the row is
 * matchable, plus the branches and models that are not: a session is often
 * remembered by the branch it ran on rather than by the title an agent gave
 * it. A query that is a number, with or without GitHub's leading hash, also
 * matches a pull request number.
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
  if (
    /^\d+$/.test(digits) &&
    row.pullRequests.some((pullRequest) => String(pullRequest.number).includes(digits))
  ) {
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
