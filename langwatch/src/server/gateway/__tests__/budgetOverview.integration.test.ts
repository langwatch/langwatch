/**
 * @vitest-environment node
 *
 * The budget overview against real Postgres + real ClickHouse + real
 * Redis: what a member sees about the budgets that bind their key, and
 * the one-source property the service exists for - the /me procedure,
 * the CLI REST endpoint, and the budgets settings read must report the
 * SAME spend for the same budget from the same seed.
 *
 * Spec: specs/ai-gateway/budget-overview.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { appRouter } from "~/server/api/root";
import { createInnerTRPCContext } from "~/server/api/trpc";
import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { GatewayBudgetService } from "../budget.service";
import { BudgetOverviewService } from "../budgetOverview.service";
import { groupBucketScopeId } from "../budgetResolution.service";

const suffix = nanoid(8);
const ORG_ID = `org-bov-${suffix}`;
const TEAM_ID = `team-bov-${suffix}`;
const WORK_PROJECT_ID = `proj-bov-work-${suffix}`;
const PERSONAL_TEAM_ID = `pteam-bov-${suffix}`;
const PERSONAL_PROJECT_ID = `proj-bov-personal-${suffix}`;
const USER_ID = `usr-bov-${suffix}`;
const OTHER_USER_ID = `usr-bov-other-${suffix}`;
const OUTSIDER_USER_ID = `usr-bov-outsider-${suffix}`;
const GROUP_ID = `grp-bov-${suffix}`;
const MP_OPENAI_ID = `mp-bov-openai-${suffix}`;
const VK_PERSONAL_ID = `vk_bov_personal_${suffix}`;
const BUDGET_ORG_ID = `bdg-bov-org-${suffix}`;
const BUDGET_PRINCIPAL_ID = `bdg-bov-principal-${suffix}`;
const BUDGET_PROVIDER_ID = `bdg-bov-provider-${suffix}`;
const BUDGET_GROUP_ID = `bdg-bov-group-${suffix}`;
const ACCESS_TOKEN = `lw_at_bov-${suffix}`;

const TENANTS = [WORK_PROJECT_ID, PERSONAL_PROJECT_ID];

function chRepo(): GatewayBudgetClickHouseRepository {
  const ch = getTestClickHouseClient();
  return new GatewayBudgetClickHouseRepository(
    async () => ch as ClickHouseClient,
  );
}

function overviewService(): BudgetOverviewService {
  return BudgetOverviewService.create(prisma, chRepo());
}

async function seedDebit(input: {
  tenantId: string;
  budgetId: string;
  scope: "ORGANIZATION" | "PRINCIPAL" | "GROUP";
  bucketScopeId: string;
  window: "MONTH" | "WEEK";
  amountUsd: string;
  requestId: string;
}) {
  await chRepo().insertDebit([
    {
      tenantId: input.tenantId,
      budgetId: input.budgetId,
      scope: input.scope,
      scopeId: input.bucketScopeId,
      window: input.window,
      virtualKeyId: VK_PERSONAL_ID,
      gatewayRequestId: input.requestId,
      amountUsd: input.amountUsd,
      tokensInput: 10,
      tokensOutput: 5,
      tokensCacheRead: 0,
      tokensCacheWrite: 0,
      model: "gpt-5-mini",
      status: "SUCCESS",
      occurredAt: new Date(),
    },
  ]);
}

describe("budget overview (real PG + CH + Redis)", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `ACME ${suffix}`, slug: `bov-${suffix}` },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `bov-${suffix}@acme.test`, name: "Member" },
    });
    await prisma.user.create({
      data: {
        id: OTHER_USER_ID,
        email: `bov-other-${suffix}@acme.test`,
        name: "Colleague",
      },
    });
    await prisma.user.create({
      data: {
        id: OUTSIDER_USER_ID,
        email: `bov-outsider-${suffix}@acme.test`,
        name: "Outsider",
      },
    });
    // ADMIN so the same caller can also read gatewayBudgets.get in the
    // differential test; role does not change what budgets bind them.
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: USER_ID, role: "ADMIN" },
    });
    await prisma.organizationUser.create({
      data: { organizationId: ORG_ID, userId: OTHER_USER_ID, role: "MEMBER" },
    });

    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Core ${suffix}`,
        slug: `bov-core-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: WORK_PROJECT_ID,
        name: `Work ${suffix}`,
        slug: `bov-work-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `bov-work-key-${suffix}`,
      },
    });
    // Admin power flows through team/role bindings, not OrgUser.role:
    // a TeamUser ADMIN row on the (non-personal) team is what lets the
    // differential caller read gatewayBudgets.get.
    await prisma.teamUser.create({
      data: { teamId: TEAM_ID, userId: USER_ID, role: "ADMIN" },
    });

    // Personal workspace, the same shape PersonalWorkspaceService.ensure
    // creates: personal team + personal project owned by the user.
    await prisma.team.create({
      data: {
        id: PERSONAL_TEAM_ID,
        name: `Member's Workspace ${suffix}`,
        slug: `bov-pteam-${suffix}`,
        organizationId: ORG_ID,
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PERSONAL_PROJECT_ID,
        name: `Member's Project ${suffix}`,
        slug: `bov-pproj-${suffix}`,
        teamId: PERSONAL_TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `bov-personal-key-${suffix}`,
        isPersonal: true,
        ownerUserId: USER_ID,
      },
    });
    await prisma.virtualKey.create({
      data: {
        id: VK_PERSONAL_ID,
        organizationId: ORG_ID,
        name: "member-personal-key",
        hashedSecret: `hash-bov-${suffix}`,
        displayPrefix: "vk-lw-bov",
        principalUserId: USER_ID,
        createdById: USER_ID,
        scopes: {
          create: [{ scopeType: "PROJECT", scopeId: PERSONAL_PROJECT_ID }],
        },
      },
    });

    await prisma.group.create({
      data: {
        id: GROUP_ID,
        organizationId: ORG_ID,
        name: `Engineering ${suffix}`,
        slug: `bov-eng-${suffix}`,
        members: {
          create: [{ userId: USER_ID }, { userId: OTHER_USER_ID }],
        },
      },
    });
    await prisma.modelProvider.create({
      data: {
        id: MP_OPENAI_ID,
        name: "OpenAI",
        provider: "openai",
        enabled: true,
        organizationId: ORG_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });

    const resetsAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_ORG_ID,
        name: `Org monthly ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
        window: "MONTH",
        limitUsd: "100.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt,
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_PRINCIPAL_ID,
        name: `Member cap ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PRINCIPAL",
        scopeId: USER_ID,
        window: "MONTH",
        limitUsd: "25.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt,
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_PROVIDER_ID,
        name: `Org OpenAI only ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
        providerKey: MP_OPENAI_ID,
        window: "MONTH",
        limitUsd: "40.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt,
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_GROUP_ID,
        name: `Engineering per-member ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "GROUP",
        scopeId: GROUP_ID,
        window: "WEEK",
        limitUsd: "50.00",
        onBreach: "BLOCK",
        createdById: USER_ID,
        resetsAt,
      },
    });

    // Spend, written the way the trace-fold reactor writes it. The org
    // budget accrues in TWO different project tenants (the whole point
    // of the fan-out): $1.50 + $0.93 = $2.43.
    await seedDebit({
      tenantId: WORK_PROJECT_ID,
      budgetId: BUDGET_ORG_ID,
      scope: "ORGANIZATION",
      bucketScopeId: ORG_ID,
      window: "MONTH",
      amountUsd: "1.50",
      requestId: `req-bov-org-work-${suffix}`,
    });
    await seedDebit({
      tenantId: PERSONAL_PROJECT_ID,
      budgetId: BUDGET_ORG_ID,
      scope: "ORGANIZATION",
      bucketScopeId: ORG_ID,
      window: "MONTH",
      amountUsd: "0.93",
      requestId: `req-bov-org-personal-${suffix}`,
    });
    await seedDebit({
      tenantId: PERSONAL_PROJECT_ID,
      budgetId: BUDGET_PRINCIPAL_ID,
      scope: "PRINCIPAL",
      bucketScopeId: USER_ID,
      window: "MONTH",
      amountUsd: "0.10",
      requestId: `req-bov-principal-${suffix}`,
    });
    await seedDebit({
      tenantId: WORK_PROJECT_ID,
      budgetId: BUDGET_PROVIDER_ID,
      scope: "ORGANIZATION",
      bucketScopeId: `${ORG_ID}|provider:${MP_OPENAI_ID}`,
      window: "MONTH",
      amountUsd: "0.05",
      requestId: `req-bov-provider-${suffix}`,
    });
    // The member's own department bucket vs a colleague's: the member
    // must see only their own $2.00, never the group's $11.00.
    await seedDebit({
      tenantId: PERSONAL_PROJECT_ID,
      budgetId: BUDGET_GROUP_ID,
      scope: "GROUP",
      bucketScopeId: groupBucketScopeId(GROUP_ID, USER_ID),
      window: "WEEK",
      amountUsd: "2.00",
      requestId: `req-bov-group-self-${suffix}`,
    });
    await seedDebit({
      tenantId: WORK_PROJECT_ID,
      budgetId: BUDGET_GROUP_ID,
      scope: "GROUP",
      bucketScopeId: groupBucketScopeId(GROUP_ID, OTHER_USER_ID),
      window: "WEEK",
      amountUsd: "9.00",
      requestId: `req-bov-group-other-${suffix}`,
    });
  }, 120_000);

  afterAll(async () => {
    delete process.env.RELEASE_UI_AI_GOVERNANCE_ENABLED;
    const ch = getTestClickHouseClient();
    if (ch) {
      for (const tenantId of TENANTS) {
        await ch.command({
          query:
            "DELETE FROM gateway_budget_ledger_events WHERE TenantId = {tenantId:String}",
          query_params: { tenantId },
        });
        await ch.command({
          query:
            "DELETE FROM gateway_budget_scope_totals WHERE TenantId = {tenantId:String}",
          query_params: { tenantId },
        });
      }
    }
    const { connection: redis } = await import("~/server/redis");
    if (redis) await redis.del(`lwcli:access:${ACCESS_TOKEN}`);
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.groupMembership.deleteMany({ where: { groupId: GROUP_ID } });
    await prisma.group.deleteMany({ where: { id: GROUP_ID } });
    await prisma.modelProvider.deleteMany({ where: { id: MP_OPENAI_ID } });
    await prisma.project.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.teamUser.deleteMany({
      where: { team: { organizationId: ORG_ID } },
    });
    await prisma.team.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.organizationUser.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await prisma.user.deleteMany({
      where: { id: { in: [USER_ID, OTHER_USER_ID, OUTSIDER_USER_ID] } },
    });
    await stopTestContainers();
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
      const personal = overview.budgets.find(
        (b) => b.id === BUDGET_PRINCIPAL_ID,
      );
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
      expect(ids.indexOf(BUDGET_PRINCIPAL_ID)).toBeLessThan(
        ids.indexOf(BUDGET_ORG_ID),
      );
      expect(ids.indexOf(BUDGET_GROUP_ID)).toBeLessThan(
        ids.indexOf(BUDGET_ORG_ID),
      );
    });

    /** @scenario "A provider-filtered budget names its provider" */
    it("carries the provider display name on a filtered budget", async () => {
      const overview = await overviewService().overviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });
      const filtered = overview.budgets.find(
        (b) => b.id === BUDGET_PROVIDER_ID,
      );
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
      expect(dept!.scopePhrase).toBe(
        `department budget (Engineering ${suffix})`,
      );
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

  describe("one source across every surface", () => {
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

      const { connection: redis } = await import("~/server/redis");
      expect(redis).toBeTruthy();
      await redis!.set(
        `lwcli:access:${ACCESS_TOKEN}`,
        JSON.stringify({
          user_id: USER_ID,
          organization_id: ORG_ID,
          issued_at: Date.now(),
          expires_at: Date.now() + 60 * 60 * 1000,
        }),
        "EX",
        60 * 60,
      );
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
      expect(Number(restOrg!.spentUsd)).toBeCloseTo(
        Number(trpcOrg!.spentUsd),
        6,
      );
      expect(Number(viaSettings.spentUsd)).toBeCloseTo(
        Number(trpcOrg!.spentUsd),
        6,
      );
      expect(restOrg!.scopePhrase).toBe(trpcOrg!.scopePhrase);
    });
  });

  describe("budget detail recent activity", () => {
    /** @scenario "An organization budget's recent activity lists debits from every project it spans" */
    it("lists the org budget's debits from both projects", async () => {
      const service = GatewayBudgetService.create(prisma, chRepo());
      const detail = await service.getDetail(BUDGET_ORG_ID, ORG_ID);
      expect(detail).not.toBeNull();
      const ids = detail!.recentLedger.map((l) => l.id);
      expect(ids).toContain(`req-bov-org-work-${suffix}`);
      expect(ids).toContain(`req-bov-org-personal-${suffix}`);
    });
  });
});
