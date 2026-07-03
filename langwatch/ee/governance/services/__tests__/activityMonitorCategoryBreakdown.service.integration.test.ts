/**
 * @vitest-environment node
 *
 * ActivityMonitorService.categoryBreakdown — ADR-033 PR D.
 *
 * The org Activity Monitor aggregates the coding-agent cost split by content
 * category across every user's governance-origin traffic. Category totals ride
 * the reserved `langwatch.reserved.blockcat.<category>.{cost_usd,tokens}`
 * attributes the trace fold accumulates onto trace_summaries. This test seeds
 * governance-origin rows directly and exercises the read query against real
 * ClickHouse — TenantId isolation and origin filtering must hold exactly as
 * they do for spendByUser.
 *
 * Spec: specs/ai-gateway/governance/cost-breakdown-dashboard.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Organization, Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  blockCategoryCostAttr,
  blockCategoryTokensAttr,
} from "~/server/app-layer/traces/block-classification/categories";
import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ActivityMonitorService } from "../activity-monitor/activityMonitor.service";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";

const ORIGIN_KEY = "langwatch.origin.kind";
const ORIGIN_VALUE = "ingestion_source";
const USER_KEY = "langwatch.user_id";

async function insertTraceSummary(
  ch: ClickHouseClient,
  tenantId: string,
  t: {
    traceId: string;
    occurredAt: Date;
    totalCost: number;
    attrs: Record<string, string>;
  },
): Promise<void> {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: t.traceId,
        Version: "v1",
        Attributes: t.attrs,
        OccurredAt: t.occurredAt,
        CreatedAt: t.occurredAt,
        UpdatedAt: t.occurredAt,
        ComputedIOSchemaVersion: "",
        ComputedInput: null,
        ComputedOutput: null,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 100,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: ["claude-sonnet-4"],
        TotalCost: t.totalCost,
        TokensEstimated: false,
        TotalPromptTokenCount: 10,
        TotalCompletionTokenCount: 5,
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

describe("ActivityMonitorService.categoryBreakdown", () => {
  const namespace = `amcb-${nanoid(8)}`;
  let ch: ClickHouseClient;
  let primaryOrg: Organization;
  let primaryGovProject: Project;
  let crossOrg: Organization;
  let crossGovProject: Project;

  beforeAll(async () => {
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) throw new Error("ClickHouse test container not available");
    ch = maybeCh;

    primaryOrg = await prisma.organization.create({
      data: { name: `Primary ${namespace}`, slug: `primary-${namespace}` },
    });
    await prisma.team.create({
      data: {
        name: `Primary Team ${namespace}`,
        slug: `primary-team-${namespace}`,
        organizationId: primaryOrg.id,
      },
    });
    crossOrg = await prisma.organization.create({
      data: { name: `Cross ${namespace}`, slug: `cross-${namespace}` },
    });
    await prisma.team.create({
      data: {
        name: `Cross Team ${namespace}`,
        slug: `cross-team-${namespace}`,
        organizationId: crossOrg.id,
      },
    });
    primaryGovProject = await ensureHiddenGovernanceProject(
      prisma,
      primaryOrg.id,
    );
    crossGovProject = await ensureHiddenGovernanceProject(prisma, crossOrg.id);

    const inWindow = new Date(Date.now() - 12 * 60 * 60 * 1000);

    // Alice: system_prompt 0.5 / mcp_tool_definitions 0.2
    await insertTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-a-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 0.7,
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [USER_KEY]: "alice@example.com",
        [blockCategoryCostAttr("system_prompt")]: "0.5",
        [blockCategoryTokensAttr("system_prompt")]: "500",
        [blockCategoryCostAttr("mcp_tool_definitions")]: "0.2",
        [blockCategoryTokensAttr("mcp_tool_definitions")]: "200",
      },
    });
    // Bob: system_prompt 0.3 / thinking 0.4 — aggregates across users
    await insertTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-b-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 0.7,
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [USER_KEY]: "bob@example.com",
        [blockCategoryCostAttr("system_prompt")]: "0.3",
        [blockCategoryTokensAttr("system_prompt")]: "300",
        [blockCategoryCostAttr("thinking")]: "0.4",
        [blockCategoryTokensAttr("thinking")]: "400",
      },
    });
    // Non-governance-origin app trace — must be excluded.
    await insertTraceSummary(ch, primaryGovProject.id, {
      traceId: `tr-app-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 99,
      attrs: {
        [blockCategoryCostAttr("system_prompt")]: "99",
        [blockCategoryTokensAttr("system_prompt")]: "99000",
      },
    });
    // Cross-org governance trace — must be excluded by TenantId isolation.
    await insertTraceSummary(ch, crossGovProject.id, {
      traceId: `tr-cross-${nanoid()}`,
      occurredAt: inWindow,
      totalCost: 50,
      attrs: {
        [ORIGIN_KEY]: ORIGIN_VALUE,
        [USER_KEY]: "eve@cross.example.com",
        [blockCategoryCostAttr("system_prompt")]: "50",
        [blockCategoryTokensAttr("system_prompt")]: "50000",
      },
    });
  });

  afterAll(async () => {
    await prisma.project
      .deleteMany({
        where: { id: { in: [primaryGovProject.id, crossGovProject.id] } },
      })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({
        where: { organizationId: { in: [primaryOrg.id, crossOrg.id] } },
      })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: { in: [primaryOrg.id, crossOrg.id] } } })
      .catch(() => undefined);
    await cleanupTestData(primaryGovProject.id);
    await cleanupTestData(crossGovProject.id);
  });

  describe("given an organization with classified coding-agent traffic from several users", () => {
    /** @scenario "The org activity monitor aggregates category totals across users" */
    it("sums per-category cost + tokens across users, excluding app + cross-org traffic", async () => {
      const service = ActivityMonitorService.create(prisma);
      const rows = await service.categoryBreakdown({
        organizationId: primaryOrg.id,
        windowDays: 7,
      });

      const byCat = new Map(rows.map((r) => [r.category, r]));
      // system_prompt: alice 0.5 + bob 0.3 = 0.8 (app 99 + cross 50 excluded)
      expect(byCat.get("system_prompt")?.costUsd).toBeCloseTo(0.8, 5);
      expect(byCat.get("system_prompt")?.tokens).toBeCloseTo(800, 5);
      expect(byCat.get("mcp_tool_definitions")?.costUsd).toBeCloseTo(0.2, 5);
      expect(byCat.get("thinking")?.costUsd).toBeCloseTo(0.4, 5);
      // Sorted by cost desc.
      expect(rows[0]?.category).toBe("system_prompt");
      // No cross-org / app leakage: total bounded well below the excluded $149.
      const total = rows.reduce((s, r) => s + r.costUsd, 0);
      expect(total).toBeLessThan(2);
    });
  });

  describe("given an org with no hidden Governance Project", () => {
    it("returns [] without touching ClickHouse", async () => {
      const orphan = await prisma.organization.create({
        data: { name: `Orphan ${nanoid(6)}`, slug: `orphan-${nanoid(6)}` },
      });
      try {
        const service = ActivityMonitorService.create(prisma);
        const rows = await service.categoryBreakdown({
          organizationId: orphan.id,
          windowDays: 7,
        });
        expect(rows).toEqual([]);
      } finally {
        await prisma.organization
          .delete({ where: { id: orphan.id } })
          .catch(() => undefined);
      }
    });
  });
});
