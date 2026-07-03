/**
 * @vitest-environment node
 *
 * PersonalUsageService.breakdownByCategory — ADR-033 PR D.
 *
 * The /me personal-usage view surfaces the user's coding-agent cost split by
 * content category (system prompt / MCP tool defs / thinking / ...). Category
 * totals ride the reserved `langwatch.reserved.blockcat.<category>.{cost_usd,
 * tokens}` attributes the trace fold accumulates onto trace_summaries. This
 * test executes the real query against ClickHouse against seeded trace
 * summaries so a query regression surfaces as a throw or a wrong number, not a
 * silent string diff.
 *
 * Spec: specs/ai-gateway/governance/cost-breakdown-dashboard.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
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
import { PersonalUsageService } from "../personalUsage.service";

async function insertTrace(
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
        Models: ["claude-opus-4-8"],
        TotalCost: t.totalCost,
        NonBilledCost: 0,
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

describe("PersonalUsageService.breakdownByCategory", () => {
  const ns = `pucb-${nanoid(8)}`;
  const occurredAt = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  const window = {
    start: new Date(Date.UTC(2026, 0, 1)),
    end: new Date(Date.UTC(2026, 0, 31)),
  };
  let ch: ClickHouseClient | null = null;
  let orgId = "";
  let tenantId = "";

  beforeAll(async () => {
    const maybe = getTestClickHouseClient();
    if (!maybe) return;
    ch = maybe;

    const org = await prisma.organization.create({
      data: { name: ns, slug: `org-${ns}` },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: { name: `team-${ns}`, slug: `team-${ns}`, organizationId: org.id },
    });
    const project = await prisma.project.create({
      data: {
        name: `personal-${ns}`,
        slug: `personal-${ns}`,
        teamId: team.id,
        language: "en",
        framework: "openai",
        apiKey: `key-${ns}`,
      },
    });
    tenantId = project.id;

    // Two classified traces. system_prompt and mcp_tool_definitions accumulate
    // across both; thinking appears on one only.
    await insertTrace(ch, tenantId, {
      traceId: `t-1-${nanoid(6)}`,
      occurredAt,
      totalCost: 1.0,
      attrs: {
        [blockCategoryCostAttr("system_prompt")]: "0.6",
        [blockCategoryTokensAttr("system_prompt")]: "600",
        [blockCategoryCostAttr("mcp_tool_definitions")]: "0.3",
        [blockCategoryTokensAttr("mcp_tool_definitions")]: "300",
        [blockCategoryCostAttr("thinking")]: "0.1",
        [blockCategoryTokensAttr("thinking")]: "100",
      },
    });
    await insertTrace(ch, tenantId, {
      traceId: `t-2-${nanoid(6)}`,
      occurredAt,
      totalCost: 0.5,
      attrs: {
        [blockCategoryCostAttr("system_prompt")]: "0.2",
        [blockCategoryTokensAttr("system_prompt")]: "200",
        [blockCategoryCostAttr("mcp_tool_definitions")]: "0.3",
        [blockCategoryTokensAttr("mcp_tool_definitions")]: "300",
      },
    });
  });

  afterAll(async () => {
    if (!ch) return;
    await cleanupTestData(tenantId);
    await prisma.project
      .deleteMany({ where: { team: { organizationId: orgId } } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: orgId } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: orgId } })
      .catch(() => undefined);
  });

  describe("given a user whose coding-agent traffic produced classified category totals", () => {
    /** @scenario "The personal usage view shows the user's cost breakdown by category" */
    it("returns per-category cost + token totals summed across the window, sorted by cost desc", async () => {
      if (!ch) return;
      const rows = await new PersonalUsageService().breakdownByCategory({
        personalProjectId: tenantId,
        window,
      });

      const byCat = new Map(rows.map((r) => [r.category, r]));
      // system_prompt: 0.6 + 0.2 = 0.8 ; mcp_tool_definitions: 0.3 + 0.3 = 0.6
      expect(byCat.get("system_prompt")?.costUsd).toBeCloseTo(0.8, 5);
      expect(byCat.get("system_prompt")?.tokens).toBeCloseTo(800, 5);
      expect(byCat.get("mcp_tool_definitions")?.costUsd).toBeCloseTo(0.6, 5);
      expect(byCat.get("thinking")?.costUsd).toBeCloseTo(0.1, 5);
      // Sorted by cost desc: system_prompt first.
      expect(rows[0]?.category).toBe("system_prompt");
      // Categories with no attributes never surface.
      expect(byCat.has("image")).toBe(false);
    });
  });

  describe("given a user whose traffic produced no category totals", () => {
    it("returns an empty array so the UI can render the enablement hint", async () => {
      if (!ch) return;
      const emptyOrg = await prisma.organization.create({
        data: { name: `${ns}-empty`, slug: `org-${ns}-empty` },
      });
      const emptyTeam = await prisma.team.create({
        data: {
          name: `team-${ns}-empty`,
          slug: `team-${ns}-empty`,
          organizationId: emptyOrg.id,
        },
      });
      const emptyProject = await prisma.project.create({
        data: {
          name: `personal-${ns}-empty`,
          slug: `personal-${ns}-empty`,
          teamId: emptyTeam.id,
          language: "en",
          framework: "openai",
          apiKey: `key-${ns}-empty`,
        },
      });
      try {
        const rows = await new PersonalUsageService().breakdownByCategory({
          personalProjectId: emptyProject.id,
          window,
        });
        expect(rows).toEqual([]);
      } finally {
        await cleanupTestData(emptyProject.id);
        await prisma.project
          .deleteMany({ where: { team: { organizationId: emptyOrg.id } } })
          .catch(() => undefined);
        await prisma.team
          .deleteMany({ where: { organizationId: emptyOrg.id } })
          .catch(() => undefined);
        await prisma.organization
          .deleteMany({ where: { id: emptyOrg.id } })
          .catch(() => undefined);
      }
    });
  });
});
