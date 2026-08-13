/**
 * Branch 2 of langwatch-saas#1040: is "N empty traces" counted through
 * `POST /api/trace/search` a MEASUREMENT ARTIFACT rather than missing content?
 *
 * The route (`src/server/routes/traces-legacy.ts`, `POST /trace/search`) calls
 * `getAllTracesForProject` with `{ downloadMode: true, scrollId }` and never
 * sets `includeSpans`. `ClickHouseTraceService.getAllTracesForProject` gates the
 * span read on `options.includeSpans === true`, so the search page is served
 * from `trace_summaries` alone and carries no span tree — however much content
 * the spans actually hold.
 *
 * The control is the point: the SAME seeded trace, read with `includeSpans:
 * true`, must come back with its spans. Without it, "spans are empty" is
 * equally well explained by a seed that never landed, and the test proves
 * nothing.
 *
 * Trace-level `input`/`output` are asserted present on the search path too:
 * they come from `trace_summaries.Computed*`, so a trace that reads empty in
 * THOSE fields is empty for a different and real reason. That distinction is
 * what decides branch 2 against branch 1.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { getClickHouseClientForProject } from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import {
  startTestContainers,
  stopTestContainers,
} from "../../event-sourcing/__tests__/integration/testContainers";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import { openProtections } from "./open-protections";

const tenantId = `test-1040-${nanoid()}`;
const traceId = `trace-1040-${nanoid()}`;
const now = Date.now();

/**
 * Content deliberately shaped like an AWS Bedrock Converse span: typeless
 * `{"text": ...}` content blocks, which is the shape the repo models nowhere.
 */
const BEDROCK_INPUT = JSON.stringify({
  type: "text",
  value: 'Bedrock Converse input: [{"text":"summarise this shipping manifest"}]',
});
const BEDROCK_OUTPUT = JSON.stringify({
  type: "text",
  value: 'Bedrock Converse output: [{"text":"The shipment contains ..."}]',
});

function makeTraceSummaryRow(overrides: Record<string, unknown> = {}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(now),
    CreatedAt: new Date(now),
    UpdatedAt: new Date(now),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: BEDROCK_INPUT,
    ComputedOutput: BEDROCK_OUTPUT,
    TimeToFirstTokenMs: null,
    TimeToLastTokenMs: null,
    TotalDurationMs: 100,
    TokensPerSecond: null,
    SpanCount: 2,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    ErrorMessage: null,
    Models: ["anthropic.claude-3-5-sonnet"],
    TotalCost: 0.0031,
    TokensEstimated: false,
    TotalPromptTokenCount: 120,
    TotalCompletionTokenCount: 80,
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

function makeSpanRow({
  spanName,
  spanAttributes,
}: {
  spanName: string;
  spanAttributes: Record<string, string>;
}) {
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
    EndTime: new Date(now + 5),
    DurationMs: 5,
    SpanName: spanName,
    SpanKind: 1,
    ServiceName: "healify-repro",
    ResourceAttributes: {},
    SpanAttributes: spanAttributes,
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
  };
}

let ch: ClickHouseClient;
let service: ClickHouseTraceService;

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: vi.fn(),
}));

vi.mock("~/server/db", () => ({
  prisma: {
    project: { findUnique: vi.fn().mockResolvedValue({}) },
    annotation: { findMany: vi.fn().mockResolvedValue([]) },
    annotationScore: { findMany: vi.fn().mockResolvedValue([]) },
  },
}));

/** The exact options `POST /api/trace/search` passes for a default JSON read. */
const SEARCH_ROUTE_OPTIONS = { downloadMode: true, scrollId: undefined };

async function readPage(options: Record<string, unknown>) {
  const results = await service.getAllTracesForProject(
    {
      projectId: tenantId,
      startDate: now - 60_000,
      endDate: now + 60_000,
      filters: {},
      pageSize: 100,
    },
    openProtections,
    options,
  );
  if (results === null) {
    throw new Error("getAllTracesForProject returned null for a page read");
  }
  return results.groups.flat();
}

beforeAll(async () => {
  const containers = await startTestContainers();
  ch = containers.clickHouseClient;
  vi.mocked(getClickHouseClientForProject).mockResolvedValue(ch);
  service = new ClickHouseTraceService(
    prisma as ConstructorParameters<typeof ClickHouseTraceService>[0],
  );

  await ch.insert({
    table: "trace_summaries",
    values: [makeTraceSummaryRow()],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      makeSpanRow({
        spanName: "bedrock.converse",
        spanAttributes: {
          "gen_ai.system": "aws.bedrock",
          "gen_ai.request.model": "anthropic.claude-3-5-sonnet",
          "langwatch.input": BEDROCK_INPUT,
          "langwatch.output": BEDROCK_OUTPUT,
        },
      }),
      makeSpanRow({
        spanName: "healify.pipeline",
        spanAttributes: { "langwatch.span.type": "chain" },
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  await stopTestContainers();
});

describe("given a trace whose spans carry real Bedrock content", () => {
  describe("when it is read the way POST /api/trace/search reads it", () => {
    it("returns no span tree even though the spans exist", async () => {
      const [trace] = await readPage(SEARCH_ROUTE_OPTIONS);

      expect(trace).toBeDefined();
      expect(trace!.trace_id).toBe(traceId);
      // Pinned deliberately: the route serialises whatever the service returns,
      // so whether the caller sees `"spans": []` or no `spans` key at all is
      // the difference between "the count saw an empty array" and "the count
      // saw undefined". Both read as empty; a reader must know which.
      expect(trace!.spans).toEqual([]);
    });

    it("still returns the trace-level input and output", async () => {
      const [trace] = await readPage(SEARCH_ROUTE_OPTIONS);

      // Emptiness measured on THESE fields would be real. Emptiness measured on
      // `spans` would not — that is the whole distinction branch 2 turns on.
      expect(trace!.input?.value).toContain("summarise this shipping manifest");
      expect(trace!.output?.value).toContain("The shipment contains");
    });
  });

  describe("when the same trace is read with includeSpans", () => {
    it("returns the spans, proving the seed landed and the emptiness is the read option", async () => {
      const [trace] = await readPage({
        ...SEARCH_ROUTE_OPTIONS,
        includeSpans: true,
      });

      expect(trace!.spans).toHaveLength(2);
      expect(trace!.spans!.map((s) => s.name).sort()).toEqual([
        "bedrock.converse",
        "healify.pipeline",
      ]);
    });
  });
});
