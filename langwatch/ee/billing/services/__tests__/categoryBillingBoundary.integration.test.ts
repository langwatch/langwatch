/**
 * @vitest-environment node
 *
 * ADR-033 invariant "Never feeds billing", behavioural half: the executable
 * billing usage count (`queryTraceSummariesTotalUniq`, the trace-count path
 * that reads trace_summaries for plan-limit checking) must return the SAME
 * number whether or not the trace summaries carry `blockcat` category
 * attributes. Two tenants with byte-identical traces — one classified, one not
 * — must meter identically. Pairs with categoryBillingBoundary.unit.test.ts
 * (static import check).
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
import { queryTraceSummariesTotalUniq } from "../billableEventsQuery";

// Fixed instant inside a stable billing month (matches queryTraceSummariesTotalUniq's
// CreatedAt filter, which uses the billing-month range).
const CREATED_AT = new Date(Date.UTC(2026, 2, 15, 12, 0, 0));
const BILLING_MONTH = "2026-03";

async function insertTrace(
  ch: ClickHouseClient,
  tenantId: string,
  attrs: Record<string, string>,
): Promise<void> {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: `t-${nanoid()}`,
        Version: "v1",
        Attributes: attrs,
        OccurredAt: CREATED_AT,
        CreatedAt: CREATED_AT,
        UpdatedAt: CREATED_AT,
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
        TotalCost: 1.0,
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

describe("ADR-033 billing boundary: usage count ignores category attributes", () => {
  const ns = `cbb-${nanoid(8)}`;
  let ch: ClickHouseClient;
  let orgId = "";
  let classifiedProjectId = "";
  let plainProjectId = "";

  beforeAll(async () => {
    const maybe = getTestClickHouseClient();
    if (!maybe) throw new Error("ClickHouse test container not available");
    ch = maybe;

    const org = await prisma.organization.create({
      data: { name: ns, slug: `org-${ns}` },
    });
    orgId = org.id;
    const team = await prisma.team.create({
      data: { name: `team-${ns}`, slug: `team-${ns}`, organizationId: org.id },
    });
    const classified = await prisma.project.create({
      data: {
        name: `classified-${ns}`,
        slug: `classified-${ns}`,
        teamId: team.id,
        language: "en",
        framework: "openai",
        apiKey: `key-c-${ns}`,
      },
    });
    const plain = await prisma.project.create({
      data: {
        name: `plain-${ns}`,
        slug: `plain-${ns}`,
        teamId: team.id,
        language: "en",
        framework: "openai",
        apiKey: `key-p-${ns}`,
      },
    });
    classifiedProjectId = classified.id;
    plainProjectId = plain.id;

    // Three traces per tenant. The classified tenant carries category attrs;
    // the plain tenant carries none. Everything else is identical.
    for (let i = 0; i < 3; i++) {
      await insertTrace(ch, classifiedProjectId, {
        [blockCategoryCostAttr("system_prompt")]: "0.4",
        [blockCategoryTokensAttr("system_prompt")]: "400",
        [blockCategoryCostAttr("thinking")]: "0.1",
        [blockCategoryTokensAttr("thinking")]: "100",
      });
      await insertTrace(ch, plainProjectId, {});
    }
  });

  afterAll(async () => {
    await cleanupTestData(classifiedProjectId);
    await cleanupTestData(plainProjectId);
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

  describe("given one project with blockcat attrs and one without, otherwise identical", () => {
    it("meters the same billable trace count for both", async () => {
      const classifiedCount = await queryTraceSummariesTotalUniq({
        projectIds: [classifiedProjectId],
        billingMonth: BILLING_MONTH,
      });
      const plainCount = await queryTraceSummariesTotalUniq({
        projectIds: [plainProjectId],
        billingMonth: BILLING_MONTH,
      });
      expect(classifiedCount).toBe(3);
      expect(plainCount).toBe(3);
      expect(classifiedCount).toBe(plainCount);
    });
  });
});
