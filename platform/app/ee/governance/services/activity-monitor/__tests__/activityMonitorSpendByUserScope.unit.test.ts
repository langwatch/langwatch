// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The cost screen's two people-facing panels read the same table and report
 * the same unit over different populations.
 *
 * ADR-128 ruling 8 turned "spend by person" into "tokens by person" so that it
 * and the department panel beside it "agree on what they measure". They agree
 * on the unit and disagree on the population: `spendByDepartment` resolves
 * every live project of the organization
 * (`activityMonitor.service.ts:673-692`), while `spendByUser` resolves the one
 * hidden governance project and hands ClickHouse `tenantId: govProjectId`,
 * returning `[]` when the organization has never minted one. Against a store
 * holding an organization's own traffic the department panel therefore prints
 * a token count and the person panel beside it prints "nothing in this window
 * yet" over the very same rows.
 *
 * WHY THE SCOPE IS A CHOICE AND NOT A WIDENING. `spendByUser` has four render
 * sites and ruling 8 keeps three of them on dollars. Widening the read
 * unconditionally would move a money figure on those three as a side effect,
 * which is what ruling 6 forbids. ADR-128 solved the identical problem for the
 * unit by moving the decision to the render layer; the scope rides the same
 * seam. The default is the behaviour those three already have, so a caller
 * that names no scope is unaffected.
 *
 * WHY THE MISSING-GOVERNANCE-PROJECT GATE MUST NOT FIRE. The hidden governance
 * project is minted by connecting a provider bill, so its absence says nothing
 * about an organization's people — the lesson ADR-128 v3.20 recorded when it
 * deleted the same gate from the adoption read. In organization scope the read
 * must issue against the org's projects whether or not one was ever minted.
 *
 * Spec: specs/governance/governance-cost-screen.feature — rule "A people panel
 * measures tokens and says which store it read".
 */
import { describe, expect, it } from "vitest";

import type { PrismaClient } from "~/generated/prisma/client";
import { ActivityMonitorService } from "../activityMonitor.service";

const GOV_PROJECT = "project-governance";
const APP_PROJECT_A = "project-assistants";
const APP_PROJECT_B = "project-support-desk";
const ARCHIVED_PROJECT = "project-retired";

/** One ClickHouse row, in the string shape the repository hands back. */
const CH_ROW = {
  actor: "someone@acme.test",
  spendUsdStr: "12.50",
  requests: "7",
  lastActivityMs: String(Date.UTC(2026, 0, 15)),
  mostUsedTarget: "gpt-5-mini",
  tokensStr: "545",
  tokensEstimatedStr: "0",
};

/** The tenant ids a repository call was scoped to, in either shape. */
const tenantsOf = (arg: unknown): string[] => {
  const input = arg as { tenantId?: string; tenantIds?: string[] } | undefined;
  if (Array.isArray(input?.tenantIds)) return input.tenantIds;
  return input?.tenantId ? [input.tenantId] : [];
};

/** A repository that records what `findSpendByUser` was asked for. */
function makeRepository() {
  const calls: unknown[] = [];
  return {
    calls,
    repository: {
      findSpendByUser: (arg: unknown) => {
        calls.push(arg);
        return Promise.resolve([CH_ROW]);
      },
    } as never,
  };
}

/**
 * Prisma stubbed to an organization holding three live projects and one
 * archived. `hasGovProject: false` is the organization that never connected a
 * provider bill.
 */
const prismaFor = ({ hasGovProject }: { hasGovProject: boolean }) =>
  ({
    anomalyAlert: { groupBy: async () => [] },
    project: {
      findFirst: async () => (hasGovProject ? { id: GOV_PROJECT } : null),
      // `organizationProjects` filters `archivedAt: null` in the query, so the
      // archived project is absent from what Prisma answers here. It is named
      // only to say which projects a widened read is expected to reach.
      findMany: async () => [
        { id: GOV_PROJECT, departmentId: null },
        { id: APP_PROJECT_A, departmentId: null },
        { id: APP_PROJECT_B, departmentId: null },
      ],
    },
  }) as unknown as PrismaClient;

const ARGS = { organizationId: "org-1", windowDays: 30 };

describe("the population the per-person spend read is asked for", () => {
  describe("given a caller that names no scope", () => {
    /** @scenario "A reader of the person figures other than the cost screen keeps the governance scope" */
    it("reads the hidden governance project alone, in the governance scope", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({
        prisma: prismaFor({ hasGovProject: true }),
        repository,
      });

      await service.spendByUser(ARGS);

      expect(calls).toHaveLength(1);
      expect(tenantsOf(calls[0])).toEqual([GOV_PROJECT]);
      expect(calls[0]).toMatchObject({ scope: "governance" });
    });
  });

  describe("given the cost screen asking for the organization's people", () => {
    /** @scenario "The panel counting people covers every project of the organization" */
    it("reads every live project of the organization, in the organization scope", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({
        prisma: prismaFor({ hasGovProject: true }),
        repository,
      });

      await service.spendByUser({ ...ARGS, scope: "organization" });

      expect(calls).toHaveLength(1);
      expect(tenantsOf(calls[0]).sort()).toEqual(
        [GOV_PROJECT, APP_PROJECT_A, APP_PROJECT_B].sort(),
      );
      expect(tenantsOf(calls[0])).not.toContain(ARCHIVED_PROJECT);
      expect(calls[0]).toMatchObject({ scope: "organization" });
    });
  });

  describe("given an organization that never connected a provider bill", () => {
    /** @scenario "People active in an organization with no governance project appear on the person panel" */
    it("still reads the organization's own projects rather than answering empty", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({
        prisma: prismaFor({ hasGovProject: false }),
        repository,
      });

      const rows = await service.spendByUser({
        ...ARGS,
        scope: "organization",
      });

      expect(calls).toHaveLength(1);
      expect(tenantsOf(calls[0]).sort()).toEqual(
        [GOV_PROJECT, APP_PROJECT_A, APP_PROJECT_B].sort(),
      );
      expect(rows.map((row) => row.actor)).toEqual([CH_ROW.actor]);
      expect(rows[0]?.tokens).toBe(545);
    });

    /** @scenario "A reader of the person figures other than the cost screen keeps the governance scope" */
    it("answers the governance scope empty, without issuing a read", async () => {
      const { repository, calls } = makeRepository();
      const service = new ActivityMonitorService({
        prisma: prismaFor({ hasGovProject: false }),
        repository,
      });

      const rows = await service.spendByUser(ARGS);

      expect(rows).toEqual([]);
      expect(calls).toHaveLength(0);
    });
  });
});
