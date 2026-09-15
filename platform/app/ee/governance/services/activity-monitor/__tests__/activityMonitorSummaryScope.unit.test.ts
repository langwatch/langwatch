// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * Adoption is an organization question, and the summary read answers it for
 * one project.
 *
 * `ActivityMonitorService.summary` resolves the hidden governance project and
 * hands ClickHouse `tenantId: govProjectId`
 * (`activityMonitor.service.ts:469-487`). Assistant traffic lands in the
 * organization's APPLICATION projects, so the headcount on the cost screen's
 * adoption card answers correctly for the one project it was given and
 * understates the organization every time. The figure is presented as a
 * measurement, so the reader has no way to tell. `spendByDepartment` two
 * hundred lines below already resolves every project of the organization and
 * passes `tenantIds` (`:586-620`), which is the shape this read is missing.
 *
 * WHY THIS IS NOT A PAGE TEST. The scope is decided entirely server-side: the
 * page renders `activeUsersThisWindow` off the summary DTO and has no way to
 * tell which projects were counted, so no assertion mounted against the cost
 * screen can distinguish a correct read from the understated one.
 *
 * WHY THE MONEY IS ASSERTED TOO. ADR-128 v3.18 widens the HEADCOUNT only —
 * "a spend figure must not change as a side effect of a headcount fix". A
 * test that asserted the headcount alone would be satisfied by widening the
 * whole read, which is the implementation the ADR forbids. The scope-aware
 * fake below answers a different spend for a widened read so that
 * implementation fails here rather than shipping.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "Adoption
 * counts the people of the whole organization".
 */
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { ActivityMonitorService } from "../activityMonitor.service";

const GOV_PROJECT = "project-governance";
const APP_PROJECT_A = "project-assistants";
const APP_PROJECT_B = "project-support-desk";

/** What the gov-scoped spend read answers, and what the card must keep. */
const GOV_SCOPED_SPEND = 500;
/** What a WIDENED spend read would answer. Reaching the card is the defect. */
const WIDENED_SPEND = 4242;
/** People the organization has active once every project is counted. */
const ORG_WIDE_USERS = 9;
/** People visible when only the hidden governance project is counted. */
const GOV_SCOPED_USERS = 3;

/** The tenant ids a repository call was scoped to, in either shape. */
const tenantsOf = (arg: unknown): string[] => {
  const input = arg as { tenantId?: string; tenantIds?: string[] } | undefined;
  if (Array.isArray(input?.tenantIds)) return input.tenantIds;
  return input?.tenantId ? [input.tenantId] : [];
};

/**
 * A recording repository that answers by the scope it was asked for.
 *
 * A Proxy rather than a literal because the headcount read may land on a
 * method this test cannot name yet — whatever it is called, it is recorded
 * and answers an org-wide count, so the assertions below describe the
 * behaviour rather than the method list.
 */
function makeRepository() {
  const calls: Array<{ method: string; arg: unknown }> = [];
  const repository = new Proxy(
    {},
    {
      get:
        (_target, method: string) =>
        (arg: unknown): Promise<unknown> => {
          calls.push({ method, arg });
          const tenants = tenantsOf(arg);
          const govScopedOnly =
            tenants.length === 1 && tenants[0] === GOV_PROJECT;
          return Promise.resolve({
            thisSpend: govScopedOnly ? GOV_SCOPED_SPEND : WIDENED_SPEND,
            prevSpend: 100,
            thisUsers: govScopedOnly ? GOV_SCOPED_USERS : ORG_WIDE_USERS,
          });
        },
    },
  );
  return { repository: repository as never, calls };
}

/** Prisma stubbed to an organization holding three projects, one hidden. */
const prisma = {
  anomalyAlert: { groupBy: async () => [] },
  project: {
    findFirst: async () => ({ id: GOV_PROJECT }),
    findMany: async () => [
      { id: GOV_PROJECT, departmentId: null },
      { id: APP_PROJECT_A, departmentId: null },
      { id: APP_PROJECT_B, departmentId: null },
    ],
  },
} as unknown as PrismaClient;

describe("the adoption headcount on the cost summary", () => {
  describe("given a person whose traffic ran under a project other than the governance one", () => {
    /** @scenario "Somebody active in another project of the organization is counted" */
    it("counts the whole organization's projects while the spend figure keeps its scope", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({ prisma, repository });

      const summary = await service.summary({
        organizationId: "org-1",
        windowDays: 30,
      });

      // Some read this summary makes must reach the application projects, or
      // the person who only ever worked in one of them is invisible.
      const counted = new Set(calls.flatMap((call) => tenantsOf(call.arg)));
      expect(calls.length).toBeGreaterThan(0);
      expect([...counted].sort()).toEqual(
        [GOV_PROJECT, APP_PROJECT_A, APP_PROJECT_B].sort(),
      );

      // And the widened read is what the card actually reports.
      expect(summary.activeUsersThisWindow).toBe(ORG_WIDE_USERS);

      // The money did not move with it.
      expect(summary.spentThisWindowUsd).toBe(GOV_SCOPED_SPEND);
    });
  });
});
