/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it } from "vitest";

import { outcomeOfExitCode } from "../first-install-upgrade.ts";

describe("outcomeOfExitCode()", () => {
  /** @scenario "The worker waits on the run's outcome, never on a process exit code" */
  it("maps 0, 3 and any other exit code to done, lease_not_acquired and failed", () => {
    expect([0, 3, 1, 2, 137].map(outcomeOfExitCode)).toEqual([
      "done",
      "lease_not_acquired",
      "failed",
      "failed",
      "failed",
    ]);
  });
});
