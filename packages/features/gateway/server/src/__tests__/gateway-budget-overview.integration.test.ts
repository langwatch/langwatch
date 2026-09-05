/**
 * @vitest-environment node
 * Real Postgres + real ClickHouse. What a member sees about budgets binding their key, via the one service the /me page, CLI epilogue and REST mirror share. Spec: specs/ai-gateway/budget-overview.feature
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";

import { PrismaGatewayAdapter } from "../adapters/prisma.gateway.adapter";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";
import { BudgetOverviewService } from "../services/gateway-budget-overview.service";
import type { GatewayService } from "../services/gateway.service";
import { TestFeatureFlagService } from "./support/test-feature-flag-service";
import { TestOrganizationService } from "./support/test-organization-service";
import { TestProjectService } from "./support/test-project-service";
import {
  BUDGET_ARCHIVED_ID,
  BUDGET_GROUP_ID,
  BUDGET_ORG_ID,
  BUDGET_PRINCIPAL_ID,
  BUDGET_PROVIDER_ID,
  ORG_ID,
  OUTSIDER_USER_ID,
  PERSONAL_PROJECT_ID,
  PERSONAL_TEAM_ID,
  seedBudgetOverviewFixture,
  suffix,
  teardownBudgetOverviewFixture,
  TENANTS,
  USER_ID,
} from "./support/budget-overview.fixture";

import { PrismaGatewayProviderLabelRepository } from "../repositories/prisma/prisma.gateway-provider-label.repository";
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

const databaseUrl = process.env.DATABASE_URL;
const chUrl = testClickHouseUrl();
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;
const prisma = connection?.client as PrismaClient;

/** The organization's projects, and the labels the scope targets carry. */
class SuiteProjectService extends TestProjectService {
  override async listIdsByOrganization(): ReturnType<ProjectService["listIdsByOrganization"]> {
    return TENANTS;
  }

  override async listNamesByIds({
    projectIds,
  }: {
    projectIds: string[];
  }): ReturnType<ProjectService["listNamesByIds"]> {
    return await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: {
        id: true,
        name: true,
        slug: true,
        teamId: true,
        organizationId: true,
        isPersonal: true,
        ownerUserId: true,
      },
    });
  }
}

/** Membership and the personal workspace: the two reads the overview makes. */
class SuiteOrganizationService extends TestOrganizationService {
  override isMember = async ({
    organizationId,
    userId,
  }: {
    organizationId: string;
    userId: string;
  }): Promise<boolean> =>
    (await prisma.organizationUser.count({ where: { organizationId, userId } })) > 0;

  override tryFindPersonalWorkspace = async ({
    userId,
  }: {
    userId: string;
    organizationId: string;
  }): ReturnType<OrganizationService["tryFindPersonalWorkspace"]> => {
    if (userId !== USER_ID) return null;
    const team = await prisma.team.findUniqueOrThrow({ where: { id: PERSONAL_TEAM_ID } });
    const project = await prisma.project.findUniqueOrThrow({ where: { id: PERSONAL_PROJECT_ID } });
    return {
      team: {
        id: team.id,
        name: team.name,
        slug: team.slug,
        createdAtMs: team.createdAt.getTime(),
      },
      project: {
        id: project.id,
        name: project.name,
        slug: project.slug,
        apiKey: project.apiKey,
        createdAtMs: project.createdAt.getTime(),
      },
    };
  };
}

let chRepo: GatewayBudgetClickHouseRepository;
let budgetDecisions: GatewayService;
const featureFlags = new TestFeatureFlagService();

const overviewService = (): BudgetOverviewService =>
  BudgetOverviewService.create({
    database: prisma,
    organizations: new SuiteOrganizationService(),
    featureFlags,
    personalVirtualKeys: {
      listActiveForPrincipal: async ({ userId, organizationId }) =>
        await prisma.virtualKey.findMany({
          where: { organizationId, principalUserId: userId, revokedAt: null },
          select: { id: true },
        }),
    },
    budgetDecisions,
    providerLabels: PrismaGatewayProviderLabelRepository.create(prisma),
    budgetRepository: chRepo,
  });

describe.skipIf(!databaseUrl || !chUrl)("budget overview (real PG + real CH)", () => {
  beforeAll(async () => {
    chRepo = new GatewayBudgetClickHouseRepository(async () => createTestClickHouseClient(chUrl!));
    budgetDecisions = PrismaGatewayAdapter.create({
      database: prisma,
      projects: new SuiteProjectService(),
      evaluators: {} as never,
      monitors: {} as never,
      changes: {} as never,
      audit: {} as never,
      budgetSpend: chRepo,
    }).build();
    await seedBudgetOverviewFixture(prisma, chRepo);
  }, 120_000);

  afterAll(async () => {
    await teardownBudgetOverviewFixture(prisma, createTestClickHouseClient(chUrl!));
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
      featureFlags.enabled = false;
      try {
        const overview = await overviewService().overviewForUser({
          organizationId: ORG_ID,
          userId: USER_ID,
        });
        expect(overview.gatewayAccess).toBe(false);
        expect(overview.reason).toBe("flag_off");
        expect(overview.budgets).toEqual([]);
      } finally {
        featureFlags.enabled = true;
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

  describe("given an organization budget whose only spend sits in an archived project", () => {
    /** @scenario "Spend recorded in an archived project still counts, on every surface" */
    it("counts it on the member overview and on the budget's own read alike", async () => {
      const service = overviewService();
      const overview = await service.overviewForUser({
        organizationId: ORG_ID,
        userId: USER_ID,
      });
      const onOverview = overview.budgets.find((b) => b.id === BUDGET_ARCHIVED_ID);
      expect(onOverview).toBeDefined();

      const detail = await service.overviewForBudget({
        organizationId: ORG_ID,
        budgetId: BUDGET_ARCHIVED_ID,
      });

      // Archiving a project retires it from the product, not from the
      // ledger: the gateway still enforces against these debits, so a
      // surface that dropped them would promise headroom that is not
      // there. The tRPC and REST mirrors above this service are transports
      // over the same two reads.
      expect(Number(onOverview!.spentUsd)).toBeCloseTo(3.3, 6);
      expect(Number(detail!.spentUsd)).toBeCloseTo(3.3, 6);
    });
  });

  describe("given an organization budget with debits in two projects", () => {
    /** @scenario "An organization budget's recent activity lists debits from every project it spans" */
    it("lists the org budget's debits from both projects", async () => {
      const detail = await budgetDecisions.tryGetDetail({
        id: BUDGET_ORG_ID,
        organizationId: ORG_ID,
      });
      expect(detail).not.toBeNull();
      const ids = detail!.recentLedger.map((l) => l.id);
      expect(ids).toContain(`req-bov-org-work-${suffix}`);
      expect(ids).toContain(`req-bov-org-personal-${suffix}`);
    });
  });
});
