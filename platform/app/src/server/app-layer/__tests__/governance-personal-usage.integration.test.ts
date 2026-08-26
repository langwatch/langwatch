/** @vitest-environment node */
/** Verifies composed personal-usage trace rollups split billed from theoretical spend. */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import {
  clearClickHouseTestApp,
  installClickHouseTestApp,
} from "~/test-utils/clickhouseTestApp";
import type { App } from "~/server/app-layer/app";

async function insertTrace(
  ch: ClickHouseClient,
  tenantId: string,
  t: {
    traceId: string;
    occurredAt: Date;
    totalCost: number;
    nonBilledCost: number | null;
    models: string[];
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
        Attributes: {},
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
        Models: t.models,
        TotalCost: t.totalCost,
        NonBilledCost: t.nonBilledCost,
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

describe("PersonalUsageService spend rollups", () => {
  const ns = `pu-${nanoid(8)}`;
  // Fixed, deterministic instant inside the query window.
  const occurredAt = new Date(Date.UTC(2026, 0, 15, 12, 0, 0));
  const window = {
    start: new Date(Date.UTC(2026, 0, 1)),
    end: new Date(Date.UTC(2026, 0, 31)),
  };
  let ch: ClickHouseClient | null = null;
  let app: App;
  let orgId = "";
  // The CH client resolves a project's cluster off its org in Postgres and
  // refuses unknown ids, so the tenant must be a real project row.
  let tenantId = "";

  beforeAll(async () => {
    const maybe = getTestClickHouseClient();
    if (!maybe) return;
    ch = maybe;
    app = installClickHouseTestApp({ resolveClient: async () => ch });

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

    // Bundled trace: a Claude Max session, fully non-billable (theoretical
    // cost lands, billed cost nets to zero).
    await insertTrace(ch, tenantId, {
      traceId: `t-bundled-${nanoid(6)}`,
      occurredAt,
      totalCost: 1.0,
      nonBilledCost: 1.0,
      models: ["claude-opus-4-8"],
    });
    // Billed trace: pay-per-token, nothing bundled.
    await insertTrace(ch, tenantId, {
      traceId: `t-billed-${nanoid(6)}`,
      occurredAt,
      totalCost: 0.5,
      nonBilledCost: 0,
      models: ["gpt-4o"],
    });
  });

  afterAll(async () => {
    if (!ch) return;
    await cleanupTestData(tenantId);
    await cleanupTestRows(prisma, [
      ["project", { team: { organizationId: orgId } }],
      ["team", { organizationId: orgId }],
      ["organization", { id: orgId }],
    ]);
    await clearClickHouseTestApp();
  });

  describe("given a bundled trace and a billed trace", () => {
    it("totals theoretical spend across both in the summary", async () => {
      if (!ch) return;
      const summary = await app.governance.personalUsageSummary({
        personalProjectId: tenantId,
        window: { startMs: window.start.getTime(), endMs: window.end.getTime() },
      });
      expect(summary.requests).toBe(2);
      expect(summary.spentUsd).toBeCloseTo(1.5, 5);
      // Only the billed trace counts toward billed; the bundled one nets to 0,
      // so the headline reflects real money out and bundled = spent - billed.
      expect(summary.billedUsd).toBeCloseTo(0.5, 5);
    });

    it("executes dailyBuckets and splits billed from theoretical", async () => {
      if (!ch) return;
      const buckets = await app.governance.personalUsageDailyBuckets({
        personalProjectId: tenantId,
        window: { startMs: window.start.getTime(), endMs: window.end.getTime() },
      });
      const nonEmpty = buckets.filter((b) => b.requests > 0);
      expect(nonEmpty).toHaveLength(1);
      expect(nonEmpty[0]!.spentUsd).toBeCloseTo(1.5, 5);
      // Only the billed trace counts toward billed; the bundled one nets to 0.
      expect(nonEmpty[0]!.billedUsd).toBeCloseTo(0.5, 5);
    });

    it("executes breakdownByModel and splits billed per model", async () => {
      if (!ch) return;
      const breakdown = await app.governance.personalUsageBreakdownByModel({
        personalProjectId: tenantId,
        window: { startMs: window.start.getTime(), endMs: window.end.getTime() },
      });
      const opus = breakdown.find((b) => b.label === "claude-opus-4-8");
      const gpt = breakdown.find((b) => b.label === "gpt-4o");
      expect(opus?.spentUsd).toBeCloseTo(1.0, 5);
      expect(opus?.billedUsd).toBeCloseTo(0, 5);
      expect(gpt?.spentUsd).toBeCloseTo(0.5, 5);
      expect(gpt?.billedUsd).toBeCloseTo(0.5, 5);
    });
  });
});
