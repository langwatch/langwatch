/** Spec: modules/ops/specs/queue-stranded-groups.feature */
import { describe, expect, it } from "vitest";

import { describeReapReport } from "../queue-reap-report.ts";

const NOTHING = {
  strandedGroups: 0,
  strandedJobs: 0,
  deletedGroups: 0,
  failedDeletes: 0,
  totalPendingNow: null,
};

describe("describeReapReport", () => {
  /** @scenario "The Queue screen reports what clearing stuck groups freed" */
  it("names the groups cleared, the failures and the pending count", () => {
    expect(
      describeReapReport({
        strandedGroups: 3,
        strandedJobs: 120,
        deletedGroups: 2,
        failedDeletes: 1,
        totalPendingNow: 4500,
      }),
    ).toBe("Cleared 2 of 3 stuck groups (120 jobs); 1 could not be deleted; 4500 jobs pending now");
  });

  /** @scenario "The Queue screen says when no stuck groups were found" */
  it("says nothing was stuck", () => {
    expect(describeReapReport(NOTHING)).toBe("No stuck groups found");
  });
});
