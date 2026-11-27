/** @see modules/staff-access/specs/staff-access-functions-platform.feature */
import type { EvaluationApi, EvaluatorTypeUsage } from "@langwatch/evaluation-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import {
  platformPeers,
  platformPeerState,
} from "../../app/__tests__/support/staff-access-platform-peers.ts";
import { StaffAccessPlatformFunctionReadsService } from "../staff-access-platform-function-reads.service.ts";

const AT = Temporal.Instant.from("2026-11-02T10:00:00Z");

function readsOver({
  parkedTenants = 3,
  evaluations,
}: {
  parkedTenants?: number;
  evaluations?: Pick<EvaluationApi, "countEvaluatorUsageByType">;
}) {
  const state = platformPeerState();
  state.parkedTenants = parkedTenants;
  return StaffAccessPlatformFunctionReadsService.create({
    ops: platformPeers.ops(state),
    langy: platformPeers.mirror(state),
    projects: createApiFixture({}),
    dataRetention: platformPeers.dataRetention(),
    traces: createApiFixture({}),
    evaluations: evaluations ?? platformPeers.evaluatorUsage(state),
  }).reads;
}

function usage(evaluatorType: string): EvaluatorTypeUsage {
  return { evaluatorType, projects: 1, runs: 1, errors: 0, skipped: 0, errorsByCode: [] };
}

describe("the platform ops function reads", () => {
  /** @scenario "The tenant ids of one step are capped" */
  it("counts every parked tenant of a step and lists at most 20 ids", async () => {
    const reads = readsOver({ parkedTenants: 30 });

    const answered = await reads["upgrade.step_failures"]({
      input: { stepId: "dataset:move-records" },
      organizationId: "",
      at: AT,
    });

    expect(answered.items).toHaveLength(1);
    expect(answered.items[0]?.failedTenants).toBe(30);
    expect(answered.items[0]?.tenantIds).toHaveLength(20);
    expect(answered.items[0]?.tenantScanComplete).toBe(true);
  });

  describe("when a step parked more tenants than one read scans", () => {
    it("marks the count incomplete", async () => {
      const reads = readsOver({ parkedTenants: 10_001 });

      const answered = await reads["upgrade.step_failures"]({
        input: { stepId: "dataset:move-records" },
        organizationId: "",
        at: AT,
      });

      expect(answered.items[0]?.failedTenants).toBe(10_000);
      expect(answered.items[0]?.tenantScanComplete).toBe(false);
    });
  });

  describe("when several stored evaluator types read as other", () => {
    it("pages through every one of them", async () => {
      const reads = readsOver({
        evaluations: createApiFixture<Pick<EvaluationApi, "countEvaluatorUsageByType">>({
          countEvaluatorUsageByType: async () => [
            usage("custom/ACME tone (v1)"),
            usage("custom/ACME tone (v2)"),
            usage("langevals/llm_boolean"),
          ],
        }),
      });

      const seen: string[] = [];
      let cursor: string | undefined;
      for (let page = 0; page < 5; page += 1) {
        const answered = await reads["evaluators.platform_usage"]({
          input: { since: "2026-10-30T10:00:00Z", limit: 1, ...(cursor ? { cursor } : {}) },
          organizationId: "",
          at: AT,
        });
        seen.push(...answered.items.map((item) => item.evaluatorType));
        if (answered.nextCursor === null) break;
        cursor = answered.nextCursor;
      }

      expect(seen.toSorted()).toEqual(["langevals/llm_boolean", "other", "other"]);
      expect(JSON.stringify(seen)).not.toContain("ACME");
    });
  });
});
