import type { SuiteRunStateData } from "@langwatch/suite-contract";

/** The fold statuses a suite run holds before its last item lands. */
export const OPEN_SUITE_RUN_STATUSES: readonly string[] = ["PENDING", "IN_PROGRESS"];

export function isOpenSuiteRun(run: Pick<SuiteRunStateData, "Status">): boolean {
  return OPEN_SUITE_RUN_STATUSES.includes(run.Status);
}
