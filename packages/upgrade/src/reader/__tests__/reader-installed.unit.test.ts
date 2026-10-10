/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-reader.feature
 */
import { describe, expect, it } from "vitest";

import { computeInstallationState } from "../installation-state.ts";
import type { LedgerRunRow } from "../reader.repository.ts";
import { pickInstalled } from "../reader.service.ts";

const unreleasedUpgrade: LedgerRunRow = {
  id: "run_up",
  kind: "upgrade",
  release: null,
  floor: "3.20.1",
  started_at: "2026-10-05T10:00:00Z",
  finished_at: "2026-10-05T10:01:00Z",
  outcome: "succeeded",
  plan: null,
  report: null,
};

describe("pickInstalled", () => {
  describe("when the newest succeeded run is an upgrade by an unreleased image", () => {
    /** @scenario "An upgrade by an unreleased image reads as installed unreleased" */
    it("reads unreleased, not a settled step's release below the floor", () => {
      const picked = pickInstalled({
        succeededRun: unreleasedUpgrade,
        stepFacts: [
          {
            id: "prisma:1",
            kind: "postgres-schema",
            mode: "blocking",
            status: "done",
            release: "3.19.0",
            inferred: true,
          },
        ],
      });
      expect(picked).toEqual({ installed: "unreleased", origin: "recorded" });
      const verdict = computeInstallationState({
        imageRelease: "unreleased",
        imageSteps: [],
        floor: "3.20.1",
        installed: picked.installed,
        ledgerFloor: "3.20.1",
        ledgerHoldsRecords: true,
        steps: [],
        failedTargets: 0,
        holdsLease: false,
        lastRunFailed: false,
      });
      expect(verdict.state).toBe("up-to-date");
    });
  });
});
