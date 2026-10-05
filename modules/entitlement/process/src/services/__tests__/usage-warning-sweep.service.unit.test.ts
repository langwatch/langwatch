import { createTestLogger } from "@langwatch/test-harness";
import { describe, expect, it } from "vitest";

import { USAGE_UNKNOWN, type ProjectUsageCounts } from "../usage-enforcement.service.ts";
import {
  type CountedUsageReading,
  UsageWarningSweepService,
} from "../usage-warning-sweep.service.ts";

const COUNTS: Record<string, ProjectUsageCounts | "unlimited"> = {
  "org-warned": [
    { projectId: "project-1", count: 600 },
    { projectId: "project-2", count: 300 },
  ],
  "org-unlimited": "unlimited",
  "org-unknown": USAGE_UNKNOWN,
};

function sweepOver({ isSaas, organizations }: { isSaas: boolean; organizations: string[] }) {
  const sent: CountedUsageReading[] = [];
  const counted: string[] = [];
  const read: string[] = [];
  const service = UsageWarningSweepService.create({
    isSaas,
    logger: createTestLogger().logger,
    organizationIds: async () => {
      read.push("organizations");
      return organizations;
    },
    projectIds: async (organizationId) =>
      organizationId === "org-empty" ? [] : ["project-1", "project-2"],
    countByProjects: async ({ organizationId }) => {
      counted.push(organizationId);
      const count = COUNTS[organizationId];
      if (count === undefined) throw new Error(`count unavailable for ${organizationId}`);
      return count;
    },
    activePlan: async () => ({ maxMessagesPerMonth: 1000 }),
    send: async (input) => {
      sent.push(input);
      return { sent: true };
    },
  });
  return { service, sent, read, counted };
}

describe("UsageWarningSweepService", () => {
  describe("when an organization has usage against a capped plan", () => {
    /** @scenario "The sweep warns each organization against its plan's monthly limit" */
    it("checks the warning with the month's count, counted once per project", async () => {
      const { service, sent, counted } = sweepOver({ isSaas: true, organizations: ["org-warned"] });

      await service.sweep();

      expect(sent).toEqual([
        {
          organizationId: "org-warned",
          currentMonthMessagesCount: 900,
          maxMonthlyUsageLimit: 1000,
          projectCounts: COUNTS["org-warned"],
        },
      ]);
      expect(counted).toEqual(["org-warned"]);
    });
  });

  describe("when organizations cannot or need not be warned", () => {
    /** @scenario "The sweep passes over organizations it cannot or need not warn" */
    it("skips each of them and carries on past a failing one", async () => {
      const { service, sent } = sweepOver({
        isSaas: true,
        organizations: ["org-empty", "org-unlimited", "org-unknown", "org-broken", "org-warned"],
      });

      await service.sweep();

      expect(sent.map((input) => input.organizationId)).toEqual(["org-warned"]);
    });
  });

  describe("when the deployment is self-hosted", () => {
    /** @scenario "The sweep does nothing off Cloud" */
    it("reads no organization and checks no warning", async () => {
      const { service, sent, read } = sweepOver({ isSaas: false, organizations: ["org-warned"] });

      await service.sweep();

      expect(read).toEqual([]);
      expect(sent).toEqual([]);
    });
  });
});
