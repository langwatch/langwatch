// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * "How many of these people are new" has to be asked of the people, not of
 * the money.
 *
 * `ActivityMonitorService.summary` reports `activeUsersThisWindow` from an
 * ORGANIZATION-WIDE headcount, read across every live project of the org.
 * The `newUsersThisWindow` field beside it is a conservative proxy until the
 * per-user first-seen fold lands (follow-up 3b): everybody active counts as
 * new when there was no prior baseline. The baseline question must therefore
 * be asked of that same org-wide population. Asked instead of the hidden
 * governance project's SPEND, an organization whose application projects
 * were busy last window but whose governance project happened to bill
 * nothing reports every active person as brand new.
 *
 * WHY THIS IS NOT A PAGE TEST. The page renders `newUsersThisWindow` off the
 * summary DTO and cannot tell which population the server asked about, so no
 * assertion mounted against the cost screen distinguishes the two.
 *
 * Pairs with `activityMonitorSummaryScope.unit.test.ts`, which pins the
 * headcount's scope; this pins the baseline the headcount is compared with.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "Adoption
 * counts the people of the whole organization".
 */
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { ActivityMonitorService } from "../activityMonitor.service";

const GOV_PROJECT = "project-governance";
const APP_PROJECT = "project-assistants";

/** People active in the window the card reports on. */
const USERS_THIS_WINDOW = 9;
/** People active in the window before it, org-wide. */
const USERS_PREVIOUS_WINDOW = 6;

/**
 * A repository whose money read and headcount read answer independently, so
 * a test can hold one fixed and move the other.
 */
function makeRepository({
  prevSpend,
  prevUsers,
}: {
  prevSpend: number;
  prevUsers: number;
}) {
  return {
    findSummarySpend: async () => ({
      thisSpend: 500,
      prevSpend,
      thisUsers: 0,
    }),
    findActiveUserCount: async () => ({
      thisUsers: USERS_THIS_WINDOW,
      prevUsers,
    }),
  } as never;
}

/** Prisma stubbed to an organization holding two projects, one hidden. */
const prisma = {
  anomalyAlert: { groupBy: async () => [] },
  project: {
    findFirst: async () => ({ id: GOV_PROJECT }),
    findMany: async () => [
      { id: GOV_PROJECT, departmentId: null },
      { id: APP_PROJECT, departmentId: null },
    ],
  },
} as unknown as PrismaClient;

describe("the new-people figure on the cost summary", () => {
  describe("given the organization had people active in the previous window while its governance project billed nothing", () => {
    /** @scenario "An organization active before this window reports nobody as new" */
    it("reports nobody as new rather than reading the whole headcount as brand new", async () => {
      const service = new ActivityMonitorService({
        prisma,
        repository: makeRepository({
          prevSpend: 0,
          prevUsers: USERS_PREVIOUS_WINDOW,
        }),
      });

      const summary = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(summary.activeUsersThisWindow).toBe(USERS_THIS_WINDOW);
      expect(summary.newUsersThisWindow).toBe(0);
    });
  });

  describe("given nobody in the organization was active in the previous window", () => {
    /** @scenario "An organization with no prior activity reports everybody as new" */
    it("keeps the conservative proxy and counts everybody active as new", async () => {
      const service = new ActivityMonitorService({
        prisma,
        // Money present in the previous window, people absent: the proxy has
        // to follow the people, so this still reports everybody as new.
        repository: makeRepository({ prevSpend: 1234, prevUsers: 0 }),
      });

      const summary = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
      });

      expect(summary.newUsersThisWindow).toBe(USERS_THIS_WINDOW);
    });
  });
});
