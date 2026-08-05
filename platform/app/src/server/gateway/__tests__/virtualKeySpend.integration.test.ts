/**
 * @vitest-environment node
 *
 * What a virtual key has spent, against real Postgres + real ClickHouse.
 *
 * These pin the two properties the "Spent this month" column and the Usage
 * tab both depend on, and that the budget-ledger source could not provide:
 * a key with no budget still reports its spend, and a key covered by
 * several budgets is not counted once per budget.
 *
 * They also pin the window boundary, because the reported symptom was
 * spend appearing about a day late. The window the pages ask for is a
 * rolling `[now - N days, now)`, so a request from a minute ago has to be
 * inside it, and a request from just before the start has to be outside.
 *
 * Spec: specs/ai-gateway/budgets.feature
 *       specs/ai-gateway/virtual-key-creation.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GatewayUsageService } from "../usage.service";
import {
  GatewayVirtualKeySpendRepository,
  startOfCurrentMonthUTC,
} from "../virtualKeySpend.clickhouse.repository";

const suffix = nanoid(8);
const ORG_ID = `org-spend-${suffix}`;
const TEAM_ID = `team-spend-${suffix}`;
const PROJECT_ID = `proj-spend-${suffix}`;
// A second project in the same org, standing in for the governance
// project org- and team-scoped keys resolve as their trace destination.
const GOV_PROJECT_ID = `proj-spend-gov-${suffix}`;
const USER_ID = `usr-spend-${suffix}`;
const VK_UNBUDGETED_ID = `vk_spend_nobudget_${suffix}`;
const VK_BUDGETED_ID = `vk_spend_budgeted_${suffix}`;
const VK_ORG_SCOPED_ID = `vk_spend_orgscoped_${suffix}`;
const BUDGET_ORG_ID = `bdg-spend-org-${suffix}`;
const BUDGET_PROJECT_ID = `bdg-spend-proj-${suffix}`;

async function insertGatewayTrace(args: {
  ch: ClickHouseClient;
  traceId: string;
  virtualKeyId: string;
  occurredAt: Date;
  totalCost: number;
  models?: string[];
  updatedAt?: Date;
  tenantId?: string;
}): Promise<void> {
  await args.ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `projn-${nanoid()}`,
        TenantId: args.tenantId ?? PROJECT_ID,
        TraceId: args.traceId,
        Version: "v1",
        Attributes: { "langwatch.virtual_key_id": args.virtualKeyId },
        OccurredAt: args.occurredAt,
        CreatedAt: args.occurredAt,
        UpdatedAt: args.updatedAt ?? args.occurredAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: null,
        ComputedOutput: null,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 250,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: args.models ?? ["gpt-5-mini"],
        TotalCost: args.totalCost,
        NonBilledCost: 0,
        TokensEstimated: false,
        TotalPromptTokenCount: 100,
        TotalCompletionTokenCount: 50,
        OutputFromRootSpan: 0,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: 0,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

function usageService(): GatewayUsageService {
  const ch = getTestClickHouseClient();
  if (!ch) throw new Error("test ClickHouse client not available");
  return GatewayUsageService.create({
    prisma,
    chRepo: undefined,
    spendRepo: new GatewayVirtualKeySpendRepository(async () => ch),
  });
}

describe("virtual key spend (real PG + real CH)", () => {
  beforeAll(async () => {
    await startTestContainers();

    await prisma.organization.create({
      data: {
        id: ORG_ID,
        name: `Spend Org ${suffix}`,
        slug: `spend-${suffix}`,
      },
    });
    await prisma.team.create({
      data: {
        id: TEAM_ID,
        name: `Spend Team ${suffix}`,
        slug: `spend-team-${suffix}`,
        organizationId: ORG_ID,
      },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: `Spend Project ${suffix}`,
        slug: `spend-proj-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `spend-key-${suffix}`,
      },
    });
    await prisma.project.create({
      data: {
        id: GOV_PROJECT_ID,
        name: `Spend Gov Project ${suffix}`,
        slug: `spend-gov-${suffix}`,
        teamId: TEAM_ID,
        language: "en",
        framework: "openai",
        apiKey: `spend-gov-key-${suffix}`,
      },
    });
    await prisma.user.create({
      data: { id: USER_ID, email: `${suffix}@spend.local`, name: "Spender" },
    });

    for (const [id, name] of [
      [VK_UNBUDGETED_ID, "no-budget-key"],
      [VK_BUDGETED_ID, "budgeted-key"],
    ] as const) {
      await prisma.virtualKey.create({
        data: {
          id,
          organizationId: ORG_ID,
          name,
          hashedSecret: `hash-${id}`,
          displayPrefix: "vk-lw-spd",
          createdById: USER_ID,
          scopes: { create: [{ scopeType: "PROJECT", scopeId: PROJECT_ID }] },
        },
      });
    }

    // Org-scoped key whose traces land in its trace-destination project,
    // NOT in the project a viewer would have selected. This is the shape
    // of every org- and team-scoped key in production.
    await prisma.virtualKey.create({
      data: {
        id: VK_ORG_SCOPED_ID,
        organizationId: ORG_ID,
        name: "org-scoped-key",
        hashedSecret: `hash-${VK_ORG_SCOPED_ID}`,
        displayPrefix: "vk-lw-org",
        createdById: USER_ID,
        traceProjectId: GOV_PROJECT_ID,
        scopes: { create: [{ scopeType: "ORGANIZATION", scopeId: ORG_ID }] },
      },
    });

    // Two budgets cover the budgeted key. The old ledger-backed read wrote
    // and summed one row per budget, so this key would have reported twice
    // its spend.
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_ORG_ID,
        name: `Org budget ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "ORGANIZATION",
        scopeId: ORG_ID,
        window: "MONTH",
        limitUsd: "100.00",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });
    await prisma.gatewayBudget.create({
      data: {
        id: BUDGET_PROJECT_ID,
        name: `Project budget ${suffix}`,
        organizationId: ORG_ID,
        scopeType: "PROJECT",
        scopeId: PROJECT_ID,
        window: "MONTH",
        limitUsd: "100.00",
        createdById: USER_ID,
        resetsAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
      },
    });

    const ch = getTestClickHouseClient();
    if (!ch) throw new Error("test ClickHouse client not available");
    const now = new Date();
    await insertGatewayTrace({
      ch,
      traceId: `trace-nobudget-${suffix}`,
      virtualKeyId: VK_UNBUDGETED_ID,
      occurredAt: new Date(now.getTime() - 60_000),
      totalCost: 0.4,
    });
    await insertGatewayTrace({
      ch,
      traceId: `trace-budgeted-${suffix}`,
      virtualKeyId: VK_BUDGETED_ID,
      occurredAt: new Date(now.getTime() - 60_000),
      totalCost: 0.25,
      models: ["claude-sonnet-4"],
    });
    await insertGatewayTrace({
      ch,
      traceId: `trace-orgscoped-${suffix}`,
      virtualKeyId: VK_ORG_SCOPED_ID,
      occurredAt: new Date(now.getTime() - 120_000),
      totalCost: 0.123456,
      tenantId: GOV_PROJECT_ID,
    });
  }, 120_000);

  afterAll(async () => {
    // The CH rows are tenant-isolated by the nanoid project id, but the
    // shared container should not accrue a suite's worth of rows per run.
    const ch = getTestClickHouseClient();
    if (ch) {
      for (const tenantId of [PROJECT_ID, GOV_PROJECT_ID]) {
        await ch.command({
          query:
            "DELETE FROM trace_summaries WHERE TenantId = {tenantId:String}",
          query_params: { tenantId },
        });
      }
    }
    await prisma.gatewayBudget.deleteMany({
      where: { organizationId: ORG_ID },
    });
    await prisma.virtualKey.deleteMany({
      where: {
        id: { in: [VK_UNBUDGETED_ID, VK_BUDGETED_ID, VK_ORG_SCOPED_ID] },
      },
    });
    await prisma.project.deleteMany({
      where: { id: { in: [PROJECT_ID, GOV_PROJECT_ID] } },
    });
    await prisma.team.deleteMany({ where: { id: TEAM_ID } });
    await prisma.user.deleteMany({ where: { id: USER_ID } });
    await prisma.organization.deleteMany({ where: { id: ORG_ID } });
    await stopTestContainers();
  }, 120_000);

  /** @scenario "A key with no budget still reports what it spent" */
  it("reports spend for a key nobody has capped", async () => {
    const now = new Date();
    const spend = await usageService().spendByVirtualKey({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_UNBUDGETED_ID],
      window: { fromDate: startOfCurrentMonthUTC(now), toDate: now },
    });
    expect(Number(spend.get(VK_UNBUDGETED_ID)?.spentUsd)).toBeCloseTo(0.4, 4);
    expect(spend.get(VK_UNBUDGETED_ID)?.requests).toBe(1);
  });

  /** @scenario "A key covered by several budgets is not counted once per budget" */
  it("counts a request once even when two budgets apply", async () => {
    const now = new Date();
    const spend = await usageService().spendByVirtualKey({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_BUDGETED_ID],
      window: { fromDate: startOfCurrentMonthUTC(now), toDate: now },
    });
    expect(Number(spend.get(VK_BUDGETED_ID)?.spentUsd)).toBeCloseTo(0.25, 4);
    expect(spend.get(VK_BUDGETED_ID)?.requests).toBe(1);
  });

  /** @scenario "Spend from minutes ago is inside the window the page asks for" */
  it("includes a request made moments ago in a rolling window", async () => {
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const summary = await usageService().summary({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_UNBUDGETED_ID, VK_BUDGETED_ID],
      window: {
        fromDate: new Date(now.getTime() - thirtyDays),
        toDate: now,
      },
    });
    expect(summary.totalRequests).toBe(2);
    expect(Number(summary.totalUsd)).toBeCloseTo(0.65, 4);
    expect(summary.byVirtualKey.map((v) => v.virtualKeyId).sort()).toEqual(
      [VK_BUDGETED_ID, VK_UNBUDGETED_ID].sort(),
    );
  });

  /** @scenario "The window start is inclusive and the window end is exclusive" */
  it("keeps the boundaries half-open so a request is counted exactly once", async () => {
    const ch = getTestClickHouseClient()!;
    // Outside every rolling window this suite queries (the widest is 30
    // days), derived from the clock rather than the calendar so it cannot
    // rot into one, and deliberately NEAR past: the CI ClickHouse proved
    // unwilling to serve rows anchored hundreds of days back, and this
    // test is about window boundaries, not retention.
    const anchor = new Date(Date.now() - 45 * 24 * 60 * 60 * 1000);
    await insertGatewayTrace({
      ch,
      traceId: `trace-boundary-${suffix}`,
      virtualKeyId: VK_UNBUDGETED_ID,
      occurredAt: anchor,
      totalCost: 1.5,
    });

    const service = usageService();
    const onStart = await service.summary({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_UNBUDGETED_ID],
      window: {
        fromDate: anchor,
        toDate: new Date(anchor.getTime() + 1000),
      },
    });
    expect(onStart.totalRequests).toBe(1);

    const onEnd = await service.summary({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_UNBUDGETED_ID],
      window: {
        fromDate: new Date(anchor.getTime() - 1000),
        toDate: anchor,
      },
    });
    expect(onEnd.totalRequests).toBe(0);
  });

  /** @scenario "A re-projected trace is counted once, at its latest cost" */
  it("counts a trace once when its projection is written twice", async () => {
    const ch = getTestClickHouseClient()!;
    const traceId = `trace-reprojected-${suffix}`;
    const anchor = new Date(Date.now() - 40 * 24 * 60 * 60 * 1000);
    // The same trace, projected twice before the engine merges the parts:
    // an early row with a partial cost and a later, correct one. Summing
    // both would over-report; taking the earlier one would under-report.
    await insertGatewayTrace({
      ch,
      traceId,
      virtualKeyId: VK_UNBUDGETED_ID,
      occurredAt: anchor,
      totalCost: 0.1,
    });
    await insertGatewayTrace({
      ch,
      traceId,
      virtualKeyId: VK_UNBUDGETED_ID,
      occurredAt: anchor,
      totalCost: 0.9,
      updatedAt: new Date(anchor.getTime() + 5_000),
    });

    const summary = await usageService().summary({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_UNBUDGETED_ID],
      window: {
        fromDate: anchor,
        toDate: new Date(anchor.getTime() + 60_000),
      },
    });
    expect(summary.totalRequests).toBe(1);
    expect(Number(summary.totalUsd)).toBeCloseTo(0.9, 4);
  });

  /** @scenario "Spend is reported per key with its own daily and model split" */
  it("breaks one key's spend down by day and model", async () => {
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const summary = await usageService().summaryForVirtualKey({
      organizationId: ORG_ID,
      virtualKeyId: VK_BUDGETED_ID,
      window: { fromDate: new Date(now.getTime() - thirtyDays), toDate: now },
    });
    expect(Number(summary.totalUsd)).toBeCloseTo(0.25, 4);
    expect(summary.byModel.map((m) => m.model)).toEqual(["claude-sonnet-4"]);
    expect(summary.byDay).toHaveLength(1);
    expect(summary.recentDebits).toHaveLength(1);
  });

  /** @scenario "Spend that lands in the key's trace project is visible from anywhere in the organization" */
  it("reports an org-scoped key's spend even though its traces live in another project's tenant", async () => {
    // The trace for VK_ORG_SCOPED_ID sits under GOV_PROJECT_ID, the shape
    // production always has for org- and team-scoped keys. Reading the
    // viewer's selected project instead of the org is the bug that made
    // the Usage page render "No usage in this window" for every key while
    // the keys table showed spend.
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const window = {
      fromDate: new Date(now.getTime() - thirtyDays),
      toDate: now,
    };
    const service = usageService();

    const perKey = await service.summaryForVirtualKey({
      organizationId: ORG_ID,
      virtualKeyId: VK_ORG_SCOPED_ID,
      window,
    });
    expect(perKey.totalRequests).toBe(1);
    expect(Number(perKey.totalUsd)).toBeCloseTo(0.123456, 6);
    expect(perKey.recentDebits).toHaveLength(1);

    // The number the page shows is the number the column shows.
    const column = await service.spendByVirtualKey({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_ORG_SCOPED_ID],
      window,
    });
    expect(Number(column.get(VK_ORG_SCOPED_ID)?.spentUsd)).toBeCloseTo(
      Number(perKey.totalUsd),
      6,
    );
    expect(column.get(VK_ORG_SCOPED_ID)?.requests).toBe(perKey.totalRequests);
  });

  /** @scenario "Spend that lands in the key's trace project is visible from anywhere in the organization" */
  it("includes the org-scoped key in the unfiltered org summary", async () => {
    const now = new Date();
    const thirtyDays = 30 * 24 * 60 * 60 * 1000;
    const summary = await usageService().summary({
      organizationId: ORG_ID,
      virtualKeyIds: [VK_UNBUDGETED_ID, VK_BUDGETED_ID, VK_ORG_SCOPED_ID],
      window: {
        fromDate: new Date(now.getTime() - thirtyDays),
        toDate: now,
      },
    });
    expect(summary.totalRequests).toBe(3);
    expect(Number(summary.totalUsd)).toBeCloseTo(0.773456, 4);
    expect(summary.byVirtualKey.map((v) => v.virtualKeyId).sort()).toEqual(
      [VK_BUDGETED_ID, VK_ORG_SCOPED_ID, VK_UNBUDGETED_ID].sort(),
    );
  });
});
