import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  getTestClickHouseClient,
  cleanupTestData,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { generateClickHouseFilterConditions } from "../clickhouse/filter-conditions";
import type { FilterField } from "../types";
import type { FilterParam } from "~/hooks/useFilterParams";
import type { ClickHouseClient } from "@clickhouse/client";

const tenantId = `test-filter-${nanoid()}`;
// Traces with all three legacy key formats for metadata
const traceCanonical = `trace-canonical-${nanoid()}`;
const traceLwPrefix = `trace-lw-prefix-${nanoid()}`;
const traceBareKey = `trace-bare-key-${nanoid()}`;
const traceNoMeta = `trace-nometa-${nanoid()}`;
const now = Date.now();

async function insertTraceSummary(
  ch: ClickHouseClient,
  traceId: string,
  attributes: Record<string, string>,
) {
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes: attributes,
        OccurredAt: new Date(now),
        CreatedAt: new Date(now),
        UpdatedAt: new Date(now),
        ComputedIOSchemaVersion: "",
        ComputedInput: "hello",
        ComputedOutput: "world",
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 100,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: 0,
        ContainsOKStatus: 1,
        ErrorMessage: null,
        Models: [],
        TotalCost: null,
        TokensEstimated: false,
        TotalPromptTokenCount: null,
        TotalCompletionTokenCount: null,
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

async function insertStoredSpan(
  ch: ClickHouseClient,
  traceId: string,
  spanType: string,
) {
  await ch.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: `span-${nanoid()}`,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(now),
        EndTime: new Date(now + 100),
        DurationMs: 100,
        SpanName: "test-span",
        SpanKind: 1,
        ServiceName: "test",
        ResourceAttributes: {},
        SpanAttributes: { "langwatch.span.type": spanType },
        StatusCode: 1,
        StatusMessage: "",
        EventCount: 0,
        LinkCount: 0,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

async function queryWithFilters(
  ch: ClickHouseClient,
  filters: Partial<Record<FilterField, FilterParam>>,
): Promise<string[]> {
  const { conditions, params } = generateClickHouseFilterConditions(filters);
  const whereClause =
    conditions.length > 0 ? `AND ${conditions.join(" AND ")}` : "";

  const result = await ch.query({
    query: `
      SELECT ts.TraceId
      FROM trace_summaries ts
      WHERE ts.TenantId = {tenantId:String}
        ${whereClause}
      ORDER BY ts.TraceId
    `,
    query_params: { tenantId, ...params },
    format: "JSONEachRow",
  });

  const rows = await result.json<{ TraceId: string }>();
  return rows.map((r) => r.TraceId);
}

describe("filter-conditions ClickHouse integration", () => {
  let ch: ClickHouseClient;

  beforeAll(async () => {
    ch = getTestClickHouseClient()!;
    if (!ch) throw new Error("ClickHouse client not available");

    // Canonical format: metadata.{key} (from Python SDK canonicalization)
    await insertTraceSummary(ch, traceCanonical, {
      "metadata.canary": "true",
    });
    // Legacy REST collector format: langwatch.metadata.{key}
    await insertTraceSummary(ch, traceLwPrefix, {
      "langwatch.metadata.canary": "true",
    });
    // Legacy bare OTEL format: {key}
    await insertTraceSummary(ch, traceBareKey, {
      canary: "true",
    });
    // No metadata
    await insertTraceSummary(ch, traceNoMeta, {
      "langwatch.user_id": "user-3",
    });

    await insertStoredSpan(ch, traceCanonical, "llm");
    await insertStoredSpan(ch, traceLwPrefix, "tool");
  });

  afterAll(async () => {
    await cleanupTestData(tenantId);
  });

  describe("when filtering by metadata.value", () => {
    it("matches canonical metadata.{key} format", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["true"] },
      });
      expect(traceIds).toContain(traceCanonical);
    });

    it("matches legacy langwatch.metadata.{key} format", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["true"] },
      });
      expect(traceIds).toContain(traceLwPrefix);
    });

    it("matches legacy bare {key} format", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["true"] },
      });
      expect(traceIds).toContain(traceBareKey);
    });

    it("does not match traces without the metadata", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["true"] },
      });
      expect(traceIds).not.toContain(traceNoMeta);
    });

    it("returns no traces for non-matching value", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["false"] },
      });
      expect(traceIds).toEqual([]);
    });
  });

  describe("when filtering by metadata.key", () => {
    it("matches all three key formats", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.key": ["canary"],
      });
      expect(traceIds).toContain(traceCanonical);
      expect(traceIds).toContain(traceLwPrefix);
      expect(traceIds).toContain(traceBareKey);
      expect(traceIds).not.toContain(traceNoMeta);
    });

    it("returns no traces for non-existing key", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.key": ["nonexistent"],
      });
      expect(traceIds).toEqual([]);
    });
  });

  describe("when filtering by spans.type", () => {
    it("returns traces with matching span type", async () => {
      const traceIds = await queryWithFilters(ch, {
        "spans.type": ["llm"],
      });
      expect(traceIds).toEqual([traceCanonical]);
    });

    it("returns traces with tool span type", async () => {
      const traceIds = await queryWithFilters(ch, {
        "spans.type": ["tool"],
      });
      expect(traceIds).toEqual([traceLwPrefix]);
    });

    it("returns both when filtering by multiple span types", async () => {
      const traceIds = await queryWithFilters(ch, {
        "spans.type": ["llm", "tool"],
      });
      expect(traceIds).toContain(traceCanonical);
      expect(traceIds).toContain(traceLwPrefix);
      expect(traceIds).not.toContain(traceNoMeta);
    });
  });

  describe("when combining filters", () => {
    it("intersects metadata.value and spans.type", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["true"] },
        "spans.type": ["llm"],
      });
      expect(traceIds).toEqual([traceCanonical]);
    });

    it("returns empty when filters contradict", async () => {
      const traceIds = await queryWithFilters(ch, {
        "metadata.value": { canary: ["true"] },
        "spans.type": ["tool"],
      });
      // traceLwPrefix has canary via langwatch.metadata.canary AND tool span
      expect(traceIds).toEqual([traceLwPrefix]);
    });
  });
});
