/**
 * @vitest-environment node
 *
 * The budget overview against real Postgres + real ClickHouse + real
 * Redis: what a member sees about the budgets that bind their key, and
 * the one-source property the service exists for - the /me procedure,
 * the CLI REST endpoint, and the budgets settings read must report the
 * SAME spend for the same budget from the same seed.
 *
 * The world these assertions read against lives in
 * `support/budgetOverviewFixture.ts`.
 *
 * Spec: specs/ai-gateway/budget-overview.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { prisma } from "~/server/db";
import { GatewayService } from "@langwatch/gateway-server";
import {
  ACCESS_TOKEN,
  BUDGET_ARCHIVED_ID,
  BUDGET_GROUP_ID,
  BUDGET_ORG_ID,
  BUDGET_PRINCIPAL_ID,
  BUDGET_PROVIDER_ID,
  chRepo,
  ORG_ID,
  OUTSIDER_USER_ID,
  overviewService,
  seedBudgetOverviewFixture,
  suffix,
  teardownBudgetOverviewFixture,
  USER_ID,
} from "./support/budgetOverviewFixture";

describe("budget overview (real PG + CH + Redis)", () => {
  beforeAll(async () => {
    await seedBudgetOverviewFixture();
  }, 120_000);

  afterAll(async () => {
    await teardownBudgetOverviewFixture();
  }, 120_000);

  describe("given a member with org-wide and personal budgets", () => {
    /** @scenario "A member sees every budget that binds their key, labelled with its scope" */
    it("lists both, labelled, with spend, most binding first", async () => {
      const overview = await overviewService().overviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });

      expect(overview.gatewayAccess).toBe(true);
      const org = overview.budgets.find((b) => b.id === BUDGET_ORG_ID);
      const personal = overview.budgets.find((b) => b.id === BUDGET_PRINCIPAL_ID);
      expect(org).toBeDefined();
      expect(personal).toBeDefined();

      expect(org!.scopeClass).toBe("organization");
      expect(org!.scopePhrase).toBe("whole organization budget");
      expect(Number(org!.spentUsd)).toBeCloseTo(2.43, 6);
      expect(Number(org!.limitUsd)).toBeCloseTo(100, 6);
      expect(org!.resetsAt).toBeTruthy();

      expect(personal!.scopeClass).toBe("personal");
      expect(personal!.scopePhrase).toBe("personal budget");
      expect(Number(personal!.spentUsd)).toBeCloseTo(0.1, 6);
      expect(Number(personal!.limitUsd)).toBeCloseTo(25, 6);

      // Most binding first: the personal cap leads, the org pool trails.
      const ids = overview.budgets.map((b) => b.id);
      expect(ids.indexOf(BUDGET_PRINCIPAL_ID)).toBeLessThan(ids.indexOf(BUDGET_ORG_ID));
      expect(ids.indexOf(BUDGET_GROUP_ID)).toBeLessThan(ids.indexOf(BUDGET_ORG_ID));
    });

    /** @scenario "A provider-filtered budget names its provider" */
    it("carries the provider display name on a filtered budget", async () => {
      const overview = await overviewService().overviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });
      const filtered = overview.budgets.find((b) => b.id === BUDGET_PROVIDER_ID);
      expect(filtered).toBeDefined();
      expect(filtered!.providerLabel).toBe("OpenAI");
      expect(Number(filtered!.spentUsd)).toBeCloseTo(0.05, 6);
    });

    /** @scenario "A department budget shows the member their own allowance, not the group total" */
    it("shows the member's own department bucket, labelled and per-member", async () => {
      const overview = await overviewService().overviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });
      const dept = overview.budgets.find((b) => b.id === BUDGET_GROUP_ID);
      expect(dept).toBeDefined();
      expect(dept!.scopeClass).toBe("department");
      expect(dept!.scopePhrase).toBe(`department budget (Engineering ${suffix})`);
      expect(dept!.isPerMember).toBe(true);
      // Their own $2.00, not the group's $11.00.
      expect(Number(dept!.spentUsd)).toBeCloseTo(2, 6);
    });
  });

  describe("given an organization with governance switched off", () => {
    /** @scenario "The overview says nothing when the organization has governance switched off" */
    it("reports no gateway access and no budgets", async () => {
      process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED = "0";
      try {
        const overview = await overviewService().overviewForUser({
          organizationId: ORG_ID,
          userId: USER_ID,
        });
        expect(overview.gatewayAccess).toBe(false);
        expect(overview.reason).toBe("flag_off");
        expect(overview.budgets).toEqual([]);
      } finally {
        delete process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED;
      }
    });
  });

  describe("given a caller who is not a member of the organization", () => {
    /** @scenario "The overview says nothing for a caller who is not a member of the organization" */
    it("reports no gateway access and no budgets", async () => {
      const overview = await overviewService().overviewForUser({
        organizationId: ORG_ID,
        userId: OUTSIDER_USER_ID,
      });
      expect(overview.gatewayAccess).toBe(false);
      expect(overview.reason).toBe("no_membership");
      expect(overview.budgets).toEqual([]);
    });
  });

  describe("given the same seeded budget read through every surface", () => {
    /** @scenario "Every surface reports the same spend for the same budget" */
    it("tRPC user.budgetOverview, the CLI REST endpoint, and gatewayBudgets.get agree on spentUsd", async () => {
      const caller = appRouter.createCaller(
        createInnerTRPCContext({
          session: { user: { id: USER_ID }, expires: "1" },
        }),
      );

      const viaTrpc = await caller.user.budgetOverview({
        organizationId: ORG_ID,
      });
      const trpcOrg = viaTrpc.budgets.find((b) => b.id === BUDGET_ORG_ID);
      expect(trpcOrg).toBeDefined();

      const { app } = await import("~/server/routes/auth-cli");
      const res = await app.request("/api/auth/cli/budget-overview", {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const viaRest = (await res.json()) as {
        gatewayAccess: boolean;
        budgets: Array<{ id: string; spentUsd: string; scopePhrase: string }>;
      };
      expect(viaRest.gatewayAccess).toBe(true);
      const restOrg = viaRest.budgets.find((b) => b.id === BUDGET_ORG_ID);
      expect(restOrg).toBeDefined();

      const viaSettings = await caller.gatewayBudgets.get({
        organizationId: ORG_ID,
        id: BUDGET_ORG_ID,
      });

      // The property the initiative exists for: one number, everywhere.
      expect(Number(trpcOrg!.spentUsd)).toBeCloseTo(2.43, 6);
      expect(Number(restOrg!.spentUsd)).toBeCloseTo(Number(trpcOrg!.spentUsd), 6);
      expect(Number(viaSettings.spentUsd)).toBeCloseTo(Number(trpcOrg!.spentUsd), 6);
      expect(restOrg!.scopePhrase).toBe(trpcOrg!.scopePhrase);
    });
  });

  describe("given an organization budget whose only spend sits in an archived project", () => {
    /** @scenario "Spend recorded in an archived project still counts, on every surface" */
    it("counts it on the overview, the CLI endpoint and the budgets settings read alike", async () => {
      const caller = appRouter.createCaller(
        createInnerTRPCContext({
          session: { user: { id: USER_ID }, expires: "1" },
        }),
      );

      const viaTrpc = await caller.user.budgetOverview({
        organizationId: ORG_ID,
      });
      const trpcArchived = viaTrpc.budgets.find((b) => b.id === BUDGET_ARCHIVED_ID);
      expect(trpcArchived).toBeDefined();

      const { app } = await import("~/server/routes/auth-cli");
      const res = await app.request("/api/auth/cli/budget-overview", {
        headers: { Authorization: `Bearer ${ACCESS_TOKEN}` },
      });
      expect(res.status).toBe(200);
      const viaRest = (await res.json()) as {
        budgets: Array<{ id: string; spentUsd: string }>;
      };
      const restArchived = viaRest.budgets.find((b) => b.id === BUDGET_ARCHIVED_ID);
      expect(restArchived).toBeDefined();

      const viaSettings = await caller.gatewayBudgets.get({
        organizationId: ORG_ID,
        id: BUDGET_ARCHIVED_ID,
      });

      // Archiving a project retires it from the product, not from the
      // ledger: the gateway still enforces against these debits, so a
      // surface that dropped them would promise headroom that is not
      // there.
      expect(Number(trpcArchived!.spentUsd)).toBeCloseTo(3.3, 6);
      expect(Number(restArchived!.spentUsd)).toBeCloseTo(3.3, 6);
      expect(Number(viaSettings.spentUsd)).toBeCloseTo(3.3, 6);
    });
  });

  describe("given an organization budget with debits in two projects", () => {
    /** @scenario "An organization budget's recent activity lists debits from every project it spans" */
    it("lists the org budget's debits from both projects", async () => {
      const service = GatewayService.create(prisma, chRepo());
      const detail = await service.getDetail(BUDGET_ORG_ID, ORG_ID);
      expect(detail).not.toBeNull();
      const ids = detail!.recentLedger.map((l) => l.id);
      expect(ids).toContain(`req-bov-org-work-${suffix}`);
      expect(ids).toContain(`req-bov-org-personal-${suffix}`);
    });
  });
});
