/** @see modules/staff-access/specs/staff-access-functions-langy.feature */
import type { LangyApi } from "@langwatch/langy-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { StaffAccessLangyFunctionReadsService } from "../staff-access-langy-function-reads.service.ts";

const AT = Temporal.Instant.from("2026-11-02T10:00:00Z");

function readsOver({ truncated }: { truncated: boolean }) {
  return StaffAccessLangyFunctionReadsService.create({
    projects: createApiFixture<ProjectApi>({
      listIdsByOrganization: async () => ["acme_project"],
    }),
    langy: createApiFixture<LangyApi>({
      findTurnOutcomeCounts: async () => ({
        counts: [
          {
            day: "2026-11-01",
            model: "openai/gpt-5.4-mini",
            turnState: "completed",
            failureCode: null,
            toolErrorsByTool: {},
            turns: 50_000,
            users: 12,
          },
        ],
        truncated,
      }),
    }),
  }).reads;
}

describe("the langy ops function reads", () => {
  describe("when the turn read stopped at its cap", () => {
    it("marks every row's counts as floors", async () => {
      const answered = await readsOver({ truncated: true })["org.langy"]({
        input: { since: "2026-10-27T10:00:00Z" },
        organizationId: "acme",
        at: AT,
      });

      expect(answered.items.map((row) => row.turnScanComplete)).toEqual([false]);
    });
  });

  describe("when the turn read held the whole window", () => {
    it("marks the rows complete", async () => {
      const answered = await readsOver({ truncated: false })["org.langy"]({
        input: { since: "2026-10-27T10:00:00Z" },
        organizationId: "acme",
        at: AT,
      });

      expect(answered.items.map((row) => row.turnScanComplete)).toEqual([true]);
    });
  });
});
