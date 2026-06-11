/**
 * Integration tests for RAG contexts surviving the stored_spans read path.
 *
 * ClickHouse stores SpanAttributes as Map(String, String), so the canonical
 * `langwatch.rag.contexts` array is a JSON string on disk. The trace-details
 * read path (`getTracesWithSpans`, used by GET /api/trace/{id}) and the
 * trace-scoped span listing (`SpanStorageClickHouseRepository`) used to cast
 * the raw map straight into NormalizedSpan, so `extractContexts` saw a string,
 * failed its Array.isArray check, and every RAG span came back with
 * `contexts: []`. See specs/traces/rag-contexts-read-deserialization.feature.
 *
 * Uses testcontainers ClickHouse to exercise real SQL against the production
 * schema — rows are inserted exactly as serializeAttributes writes them.
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import { SpanStorageClickHouseRepository } from "../repositories/span-storage.clickhouse.repository";
import type { Protections } from "../../elasticsearch/protections";
import type { RAGSpan } from "~/server/tracer/types";

const tenantId = `test-rag-contexts-${nanoid()}`;
const now = Date.now();

const ragChunks = [
  { document_id: "kb-billing.md", chunk_id: null, content: "Billing article body" },
  { document_id: "kb-coverage.md", chunk_id: "c-2", content: "Coverage article body" },
];

function makeTraceSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: `trace-${nanoid()}`,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: null,
    ComputedOutput: null,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 1,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: [],
    TotalCost: null,
    TokensEstimated: false,
    TotalPromptTokenCount: null,
    TotalCompletionTokenCount: null,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    SatisfactionScore: null,
    TopicId: null,
    SubTopicId: null,
    HasAnnotation: null,
    ...overrides,
  };
}

/**
 * stored_spans row shaped exactly like the write path produces it:
 * every SpanAttributes value is a string (Map(String, String)), with
 * objects/arrays JSON-stringified by serializeAttributes.
 */
function makeRagSpanRow(traceId: string, overrides: Record<string, unknown> = {}) {
  return {
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
    SpanName: "retrieve_kb",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: {
      "langwatch.span.type": "rag",
      "langwatch.rag.contexts": JSON.stringify(ragChunks),
      "langwatch.timestamps": JSON.stringify({ started_at: now }),
      "langwatch.input": JSON.stringify({ type: "text", value: "user question" }),
    },
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [],
    "Events.Name": [],
    "Events.Attributes": [],
    "Links.TraceId": [],
    "Links.SpanId": [],
    "Links.Attributes": [],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ...overrides,
  };
}

const openProtections: Protections = {
  canSeeCosts: true,
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
};

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: {
      findUnique: vi.fn().mockResolvedValue({}),
    },
  },
}));

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;

  const chModule = await import("~/server/clickhouse/clickhouseClient");
  vi.mocked(chModule.getClickHouseClientForProject).mockResolvedValue(ch);

  const { prisma } = await import("~/server/db");
  service = new ClickHouseTraceService(
    prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
  );
}, 60_000);

afterAll(async () => {
  if (ch) {
    await ch.exec({
      query: `ALTER TABLE trace_summaries DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
    await ch.exec({
      query: `ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}`,
      query_params: { tenantId },
    });
  }
  await stopTestContainers();
});

describe("RAG contexts read path (integration)", () => {
  describe("getTracesWithSpans()", () => {
    const traceId = `trace-rag-${nanoid()}`;

    it("returns the stored contexts on the RAG span", async () => {
      await ch.insert({
        table: "trace_summaries",
        values: [makeTraceSummaryRow({ TraceId: traceId })],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });
      await ch.insert({
        table: "stored_spans",
        values: [makeRagSpanRow(traceId)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });

      const traces = await service.getTracesWithSpans(
        tenantId,
        [traceId],
        openProtections,
      );

      expect(traces).not.toBeNull();
      const ragSpan = traces![0]!.spans!.find((s) => s.type === "rag") as
        | RAGSpan
        | undefined;
      expect(ragSpan).toBeDefined();
      expect(ragSpan!.contexts).toEqual(ragChunks);
    });

    it("returns JSON-typed attributes as structured params, not strings", async () => {
      const traces = await service.getTracesWithSpans(
        tenantId,
        [traceId],
        openProtections,
      );

      const ragSpan = traces![0]!.spans!.find((s) => s.type === "rag")!;
      const params = ragSpan.params as Record<string, any>;
      // Was previously the raw string '{"started_at":...}'
      expect(params.langwatch.timestamps).toEqual({ started_at: now });
    });
  });

  describe("SpanStorageClickHouseRepository.getSpansByTraceId()", () => {
    const traceId = `trace-rag-repo-${nanoid()}`;

    it("returns the stored contexts on the RAG span", async () => {
      await ch.insert({
        table: "stored_spans",
        values: [makeRagSpanRow(traceId)],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });

      const repo = new SpanStorageClickHouseRepository(ch);
      const spans = await repo.getSpansByTraceId(tenantId, traceId);

      const ragSpan = spans.find((s) => s.type === "rag") as
        | RAGSpan
        | undefined;
      expect(ragSpan).toBeDefined();
      expect(ragSpan!.contexts).toEqual(ragChunks);
    });
  });
});
