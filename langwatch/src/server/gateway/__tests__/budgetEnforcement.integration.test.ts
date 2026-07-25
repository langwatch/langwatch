/**
 * @vitest-environment node
 *
 * A blocking budget must actually block, and must warn before it does.
 *
 * Real Postgres + real ClickHouse, no mocks. Spend is folded by the real
 * trace-fold reactor and read back through the real service, so this covers
 * the whole control-plane path the gateway enforces from: fold -> ledger ->
 * rollup -> decision.
 *
 * Regression guard for issue #6141, where budgets accrued nothing on four of
 * six windows and so never warned and never blocked however much traffic ran.
 * A budget that silently never enforces is worse than no budget, so this fails
 * if the ladder from allow to warn to block ever stops working.
 */
import { createGatewayBudgetSyncReactor } from "@ee/governance/reactors/gatewayBudgetSync.reactor";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { TraceProcessingEvent } from "~/server/event-sourcing/pipelines/trace-processing/schemas/events";
import type { ReactorContext } from "~/server/event-sourcing/reactors/reactor.types";

import { GatewayBudgetClickHouseRepository } from "../budget.clickhouse.repository";
import { GatewayBudgetRepository } from "../budget.repository";
import { GatewayBudgetService } from "../budget.service";

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

function foldState(attrs: Record<string, string>): TraceSummaryData {
  const now = Date.now();
  return {
    traceId: `trace-${nanoid()}`,
    spanCount: 1,
    totalDurationMs: 120,
    computedIOSchemaVersion: "2025-12-18",
    computedInput: "ping",
    computedOutput: "pong",
    timeToFirstTokenMs: null,
    timeToLastTokenMs: null,
    tokensPerSecond: null,
    containsErrorStatus: false,
    containsOKStatus: true,
    errorMessage: null,
    models: ["gpt-5-mini"],
    totalCost: COST_PER_REQUEST,
    nonBilledCost: null,
    tokensEstimated: false,
    totalPromptTokenCount: 300,
    totalCompletionTokenCount: 150,
    outputFromRootSpan: false,
    outputSpanEndTimeMs: 0,
    blockedByGuardrail: false,
    rootSpanType: null,
    containsAi: false,
    containsPrompt: false,
    selectedPromptId: null,
    selectedPromptSpanId: null,
    selectedPromptStartTimeMs: null,
    lastUsedPromptId: null,
    lastUsedPromptVersionNumber: null,
    lastUsedPromptVersionId: null,
    lastUsedPromptSpanId: null,
    lastUsedPromptStartTimeMs: null,
    topicId: null,
    subTopicId: null,
    traceName: "",
    annotationIds: [],
    attributes: attrs,
    occurredAt: now,
    createdAt: now,
    updatedAt: now,
    LastEventOccurredAt: now,
  } as unknown as TraceSummaryData;
}

describe("given a blocking budget on traffic the gateway is serving", () => {
  let service: GatewayBudgetService;
  let recordOneRequest: () => Promise<void>;

  const decide = async () =>
    await service.check({
      organizationId: ORG_ID,
      teamId: TEAM_ID,
      projectId: PROJECT_ID,
      virtualKeyId: VK_ID,
      principalUserId: USER_ID,
      projectedCostUsd: "0.000001",
    });

  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: { id: ORG_ID, name: `Org ${suffix}`, slug: ORG_ID },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Team ${suffix}`,
        slug: TEAM_ID,
        organizationId: ORG_ID,
      },
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

    const resolveClient = async (tenantId: string) => {
      const client = await getClickHouseClientForProject(tenantId);
      if (!client) throw new Error("no ClickHouse client in test environment");
      return client;
    };
    const chRepo = new GatewayBudgetClickHouseRepository(resolveClient);
    service = GatewayBudgetService.create(prisma, chRepo);

    const reactor = createGatewayBudgetSyncReactor({
      prisma,
      budgetRepository: new GatewayBudgetRepository(prisma),
      budgetCHRepository: chRepo,
    });

    recordOneRequest = async () => {
      const gatewayRequestId = `grq_${nanoid()}`;
      const state = foldState({
        "langwatch.virtual_key_id": VK_ID,
        "langwatch.gateway_request_id": gatewayRequestId,
      });
      await reactor.handle({} as TraceProcessingEvent, {
        tenantId: PROJECT_ID,
        aggregateId: state.traceId,
        foldState: state,
      } as ReactorContext<TraceSummaryData>);
    };
  }, 120_000);

  afterAll(async () => {
    await prisma.gatewayBudget.deleteMany({ where: { organizationId: ORG_ID } });
    await prisma.virtualKey.deleteMany({ where: { id: VK_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.project.deleteMany({ where: { teamId: TEAM_ID } });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
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
      const withoutLedger = GatewayBudgetService.create(prisma, undefined);

      const { budgets, spendAvailable } =
        await withoutLedger.listWithHealth(ORG_ID);

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
});
