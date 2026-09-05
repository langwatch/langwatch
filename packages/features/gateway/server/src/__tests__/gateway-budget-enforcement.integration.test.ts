/**
 * @vitest-environment node
 * Real Postgres + real ClickHouse. Regression for #6141: budgets accrued nothing on 4 of 6 windows, so warn/block never fired. Spec: specs/ai-gateway/budgets.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";

import { PrismaGatewayAdapter } from "../adapters/prisma.gateway.adapter";
import { NANO_USD_PER_USD } from "../adapters/model-catalog.gateway-spend-rating.adapter";
import { GatewayBudgetClickHouseRepository } from "../repositories/clickhouse/clickhouse.gateway-budget.repository";
import {
  createTestClickHouseClient,
  testClickHouseUrl,
} from "../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support";
import type { GatewayService } from "../services/gateway.service";
import { TestProjectService } from "./support/test-project-service";

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

const suffix = nanoid(8);
const ORG_ID = `org-enf-${suffix}`;
const TEAM_ID = `team-enf-${suffix}`;
const PROJECT_ID = `proj-enf-${suffix}`;
const IDLE_PROJECT_ID = `proj-idle-${suffix}`;
const USER_ID = `usr-enf-${suffix}`;
const VK_ID = `vk_enf_${suffix}`;
const BUDGET_ID = `bdg-enf-${suffix}`;
const IDLE_BUDGET_ID = `bdg-idle-${suffix}`;

/** $0.001 per request against a $0.005 ceiling: 20% a request. */
const LIMIT_USD = "0.005";
const COST_PER_REQUEST = 0.001;

/**
 * The two project reads the decision path makes: which tenants an
 * organization's spend can land in, and where each key's traces go. Both are
 * answered from the rows this suite writes.
 */
class SuiteProjectService extends TestProjectService {
  override async listIdsByOrganization(): ReturnType<ProjectService["listIdsByOrganization"]> {
    return [PROJECT_ID, IDLE_PROJECT_ID];
  }

  override async listTraceDestinations(
    projectIds: string[],
  ): ReturnType<ProjectService["listTraceDestinations"]> {
    return await prisma.project.findMany({
      where: { id: { in: projectIds } },
      select: { id: true, teamId: true, apiKey: true, archivedAt: true },
    });
  }
}

let chRepo: GatewayBudgetClickHouseRepository;
let service: GatewayService;

describe.skipIf(!databaseUrl || !chUrl)(
  "given a blocking budget on traffic the gateway is serving",
  () => {
    const decide = async () =>
      await service.check({
        organizationId: ORG_ID,
        teamId: TEAM_ID,
        projectId: PROJECT_ID,
        virtualKeyId: VK_ID,
        principalUserId: USER_ID,
        projectedCostUsd: "0.000001",
      });

    /** One served request's debit, as the spend pipeline mints it. */
    const recordOneRequest = async () => {
      await chRepo.insertDebitsForBudgets([
        {
          tenantId: PROJECT_ID,
          budgetId: BUDGET_ID,
          scope: "PROJECT",
          scopeId: PROJECT_ID,
          window: "DAY",
          virtualKeyId: VK_ID,
          gatewayRequestId: `grq_${nanoid()}`,
          amountNanoUsd: COST_PER_REQUEST * NANO_USD_PER_USD,
          tokensInput: 300,
          tokensOutput: 150,
          tokensCacheRead: 0,
          tokensCacheWrite: 0,
          model: "gpt-5-mini",
          durationMs: 120,
          status: "SUCCESS",
          occurredAt: new Date(),
        },
      ]);
    };

    beforeAll(async () => {
      await prisma.organization.create({
        data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
      });
      await prisma.team.create({
        data: { id: TEAM_ID, name: `Team ${suffix}`, slug: TEAM_ID, organizationId: ORG_ID },
      });
      for (const id of [PROJECT_ID, IDLE_PROJECT_ID]) {
        await prisma.project.create({
          data: {
            id,
            name: id,
            slug: id,
            teamId: TEAM_ID,
            language: "en",
            framework: "openai",
            apiKey: `key-${id}`,
          },
        });
      }
      await prisma.user.create({
        data: { id: USER_ID, email: `${suffix}@acme.test`, name: "ACME Admin" },
      });
      await prisma.virtualKey.create({
        data: {
          id: VK_ID,
          organizationId: ORG_ID,
          name: "enforcement-key",
          hashedSecret: `hash-${suffix}`,
          displayPrefix: "vk-lw-xxxxxxx",
          principalUserId: USER_ID,
          createdById: USER_ID,
          // The destination is stored on the key rather than taken from its
          // scope, so a row written straight to PG has to carry it.
          traceProjectId: PROJECT_ID,
          scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
        },
      });
      await prisma.gatewayBudget.create({
        data: {
          id: BUDGET_ID,
          name: `enforced-${suffix}`,
          organizationId: ORG_ID,
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          window: "DAY",
          limitUsd: LIMIT_USD,
          onBreach: "BLOCK",
          createdById: USER_ID,
          resetsAt: new Date(Date.now() + 86_400_000),
        },
      });
      // A budget pointed at a project no key sends traffic to.
      await prisma.gatewayBudget.create({
        data: {
          id: IDLE_BUDGET_ID,
          name: `unreachable-${suffix}`,
          organizationId: ORG_ID,
          scopeType: "PROJECT",
          scopeId: IDLE_PROJECT_ID,
          window: "DAY",
          limitUsd: LIMIT_USD,
          onBreach: "BLOCK",
          createdById: USER_ID,
          resetsAt: new Date(Date.now() + 86_400_000),
        },
      });

      chRepo = new GatewayBudgetClickHouseRepository(async () =>
        createTestClickHouseClient(chUrl!),
      );
      service = PrismaGatewayAdapter.create({
        database: prisma,
        projects: new SuiteProjectService(),
        evaluators: {} as never,
        monitors: {} as never,
        changes: {} as never,
        audit: {} as never,
        budgetSpend: chRepo,
      }).build();
    }, 120_000);

    afterAll(async () => {
      const client = createTestClickHouseClient(chUrl!);
      for (const table of ["gateway_budget_ledger_events", "gateway_budget_scope_totals"]) {
        await client.command({
          query: `DELETE FROM ${table} WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId: PROJECT_ID },
        });
      }
      await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
      await prisma.virtualKey.deleteMany({ where: { id: VK_ID } });
      await prisma.user.deleteMany({ where: { id: USER_ID } });
      await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
      await prisma.team.deleteMany({ where: { id: TEAM_ID } });
      await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    }, 120_000);

    describe("when spend is still well under the limit", () => {
      it("lets the request through with no warning", async () => {
        await recordOneRequest();

        const decision = await decide();

        expect(decision.decision).toBe("allow");
        expect(decision.warnings).toHaveLength(0);
      });
    });

    describe("when spend has passed 80% of the limit but not the limit", () => {
      /** @scenario "A blocking budget warns before it blocks" */
      it("still lets the request through, and warns", async () => {
        // Three more requests: 4 x $0.001 against a $0.005 ceiling = 80%.
        await recordOneRequest();
        await recordOneRequest();
        await recordOneRequest();

        const decision = await decide();

        expect(decision.decision).toBe("soft_warn");
        expect(decision.warnings.length).toBeGreaterThan(0);
        expect(decision.warnings[0]!.scope).toBe("project");
        expect(decision.warnings[0]!.pctUsed).toBeGreaterThanOrEqual(80);
        expect(decision.blockedBy).toHaveLength(0);
      });
    });

    describe("when spend has passed the limit", () => {
      /** @scenario "A blocking budget blocks once its recorded spend passes the limit" */
      it("refuses the request and names the budget that was exceeded", async () => {
        // Two more takes it to $0.006 against the $0.005 ceiling.
        await recordOneRequest();
        await recordOneRequest();

        const decision = await decide();

        expect(decision.decision).toBe("hard_block");
        expect(decision.blockReason).toBeTruthy();
        expect(decision.blockedBy.map((b) => b.budgetId)).toContain(BUDGET_ID);
      });
    });

    describe("when a budget points at a project no key sends traffic to", () => {
      /** @scenario "A budget warns when no key can ever spend against it" */
      it("reports it as unreachable, and where the keys do send traffic", async () => {
        const { scopeReach } = await service.listWithHealth(ORG_ID);

        const idle = scopeReach.get(IDLE_BUDGET_ID);

        expect(idle?.reachable).toBe(false);
        // Naming where traffic does land is what makes the warning
        // actionable: without it the reader knows the budget is inert but
        // not what to re-scope it to.
        expect(idle?.reachableProjectIds).toContain(PROJECT_ID);
        expect(idle?.reachableProjectIds).not.toContain(IDLE_PROJECT_ID);
      });
    });

    describe("when a budget points at the project a key does send traffic to", () => {
      /** @scenario "A budget that some key can spend against carries no warning" */
      it("reports it as reachable", async () => {
        const { scopeReach } = await service.listWithHealth(ORG_ID);

        expect(scopeReach.get(BUDGET_ID)?.reachable).toBe(true);
      });
    });

    describe("when spend totals cannot be read", () => {
      /** @scenario "A budget whose spend cannot be totalled says so instead of showing zero" */
      it("reports spend as unavailable rather than as zero", async () => {
        const withoutLedger = PrismaGatewayAdapter.create({
          database: prisma,
          projects: new SuiteProjectService(),
          evaluators: {} as never,
          monitors: {} as never,
          changes: {} as never,
          audit: {} as never,
        }).build();

        const { budgets, spendAvailable } = await withoutLedger.listWithHealth(ORG_ID);

        expect(spendAvailable).toBe(false);
        // The budget is still listed, and the only spend figure left on it is
        // the Postgres column, which reads 0 even though $0.006 was really
        // spent above. Rendering that as "$0.00 spent, 0% of limit" is the
        // lie the flag exists to prevent.
        const budget = budgets.find((b) => b.id === BUDGET_ID);
        expect(budget).toBeDefined();
        expect(Number(budget!.spentUsd)).toBe(0);
      });
    });
  },
);
