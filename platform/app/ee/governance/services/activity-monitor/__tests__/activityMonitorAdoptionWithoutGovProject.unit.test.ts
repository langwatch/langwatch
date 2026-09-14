// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Adoption is an organization question, and the summary read gates it on one
 * hidden project existing.
 *
 * `ActivityMonitorService.summary` resolves the hidden governance project and
 * returns the empty summary when there is none
 * (`activityMonitor.service.ts:516-521`), so the org-wide headcount below it
 * never runs. An organization whose people are busy in its application
 * projects, and which has never minted an ingestion source, is told nobody
 * uses AI tools. The figure is presented as a measurement, so the reader has
 * no way to tell it was never taken.
 *
 * WHY THE MONEY IS ASSERTED TOO. The money fields answer the governance
 * project's question, and there is no governance project — they must stay at
 * their empty values. A fix that also ran the spend read against some other
 * scope would move a spend figure as a side effect of a headcount fix, which
 * ADR-128 ruling 6 forbids. The fake below answers a non-zero spend for any
 * spend read at all, so that implementation fails here rather than shipping.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "Adoption
 * counts the people of the whole organization".
 */
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { ActivityMonitorService } from "../activityMonitor.service";

const APP_PROJECT_A = "project-assistants";
const APP_PROJECT_B = "project-support-desk";

/** People the organization has active across its application projects. */
const ORG_WIDE_USERS = 7;
/** What any spend read would answer. Reaching the card is the defect. */
const SPEND_IF_READ = 4242;

/** Prisma stubbed to an organization with projects but no governance one. */
const prisma = {
  anomalyAlert: {
    groupBy: async () => [
      { severity: "warning", _count: { _all: 2 } },
      { severity: "critical", _count: { _all: 1 } },
    ],
  },
  project: {
    // No hidden governance project has ever been minted for this org.
    findFirst: async () => null,
    findMany: async () => [
      { id: APP_PROJECT_A, departmentId: null },
      { id: APP_PROJECT_B, departmentId: null },
    ],
  },
} as unknown as PrismaClient;

function makeRepository() {
  const calls: string[] = [];
  return {
    calls,
    repository: {
      findSummarySpend: async () => {
        calls.push("findSummarySpend");
        return { thisSpend: SPEND_IF_READ, prevSpend: SPEND_IF_READ };
      },
      findActiveUserCount: async ({ tenantIds }: { tenantIds: string[] }) => {
        calls.push(`findActiveUserCount:${[...tenantIds].sort().join(",")}`);
        return { thisUsers: ORG_WIDE_USERS, prevUsers: 4 };
      },
    } as never,
  };
}

describe("the adoption headcount on the cost summary", () => {
  describe("given an organization whose people are active but which has no hidden governance project", () => {
    /** @scenario "People active in an organization with no governance project are still counted" */
    it("counts them while the money fields stay empty", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({ prisma, repository });

      const summary = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
      });

      // The headcount ran, against every project of the organization.
      expect(calls).toContain(
        `findActiveUserCount:${[APP_PROJECT_A, APP_PROJECT_B].sort().join(",")}`,
      );
      expect(summary.activeUsersThisWindow).toBe(ORG_WIDE_USERS);
      // Somebody was active in the window before, so nobody is new.
      expect(summary.newUsersThisWindow).toBe(0);

      // The money question has no governance project to answer it.
      expect(calls).not.toContain("findSummarySpend");
      expect(summary.spentThisWindowUsd).toBe(0);
      expect(summary.windowOverPreviousPct).toBe(0);
      expect(summary.hasPriorBaseline).toBe(false);

      // Anomalies are unaffected by the governance project's absence.
      expect(summary.openAnomalyCount).toBe(3);
      expect(summary.anomalyBreakdown).toEqual({
        critical: 1,
        warning: 2,
        info: 0,
      });
    });
  });
});
