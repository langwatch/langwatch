/**
 * The span tree's evaluation, ingest-lag and occurrence reads on the migrated schema, through the
 * proof-checked reader. Spec: modules/trace/specs/trace-read-service.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { ClickHouseQueryClient } from "@langwatch/clickhouse-client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ownProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import { ClickHouseTraceSpanRepository } from "../trace-span.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const project = `test-span-reads-${nanoid()}`;
const other = `test-span-reads-other-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;
const at = (offsetMs: number) => new Date(base + offsetMs);

type ReadRequest = Parameters<ClickHouseQueryClient["read"]>[0];

let ch: ClickHouseClient;
let repo: ClickHouseTraceSpanRepository;
const sent: ReadRequest[] = [];

function spanRow(input: {
  tenantId: string;
  updatedOffsetMs: number;
  attributes: Record<string, string>;
  events: { name: string; offsetMs: number; attributes: Record<string, string> }[];
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: traceId,
    SpanId: "span-1",
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: at(0),
    EndTime: at(50),
    DurationMs: 50,
    SpanName: "rag",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: input.attributes,
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": input.events.map((event) => at(event.offsetMs)),
    "Events.Name": input.events.map((event) => event.name),
    "Events.Attributes": input.events.map((event) => event.attributes),
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: at(1_050),
    UpdatedAt: at(input.updatedOffsetMs),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  const reader = traceQueryClientFor(ch);
  repo = ClickHouseTraceSpanRepository.create({
    clickhouse: {
      read: (request) => {
        sent.push(request);
        return reader.read(request);
      },
    },
  });
  const contexts = JSON.stringify([{ content: "context one" }]);
  for (const row of [
    spanRow({
      tenantId: project,
      updatedOffsetMs: 0,
      attributes: { "langwatch.span.type": "rag", "gen_ai.request.model": "request-model" },
      events: [{ name: "stale", offsetMs: 1, attributes: {} }],
    }),
    spanRow({
      tenantId: project,
      updatedOffsetMs: 10,
      attributes: {
        "langwatch.span.type": "rag",
        "gen_ai.request.model": "request-model",
        "gen_ai.response.model": "response-model",
        "langwatch.rag.contexts": contexts,
      },
      events: [
        { name: "thumbs_up_down", offsetMs: 5, attributes: { vote: "1" } },
        { name: "exception", offsetMs: 6, attributes: {} },
        { name: "note", offsetMs: 7, attributes: { text: "useful" } },
      ],
    }),
    spanRow({
      tenantId: other,
      updatedOffsetMs: 20,
      attributes: { "langwatch.span.type": "llm" },
      events: [{ name: "foreign", offsetMs: 8, attributes: {} }],
    }),
  ]) {
    await ch.insert({
      table: "stored_spans",
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
  await ch.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: project,
        TraceId: traceId,
        Version: "v1",
        OccurredAt: at(0),
        CreatedAt: at(0),
        UpdatedAt: at(0),
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["stored_spans", "trace_summaries"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({tenantIds:Array(String)})`,
      query_params: { tenantIds: [project, other] },
    });
  }
});

describe.skipIf(!clickHouseConfigured)("ClickHouseTraceSpanRepository evaluation reads", () => {
  const authorization = ownProof({ projectId: project });

  describe("given a span stored twice and another project's span on the same trace id", () => {
    /** @scenario "A trace's evaluation spans, events, ingest lag and occurrence are read from its latest versions" */
    it("reads the latest version's type, model and contexts, once", async () => {
      const spans = await repo.findEvaluationSpans({ authorization, traceId });

      expect(spans).toEqual([
        { type: "rag", model: "response-model", ragContextTexts: ["context one"] },
      ]);
    });

    /** @scenario "A trace's evaluation spans, events, ingest lag and occurrence are read from its latest versions" */
    it("reads the latest version's events, newest first, without exceptions", async () => {
      const events = await repo.findEvaluationEvents({ authorization, traceId });

      expect(events).toEqual([
        { eventType: "note", metrics: [], details: [{ key: "text", value: "useful" }] },
        { eventType: "thumbs_up_down", metrics: [{ key: "vote", value: 1 }], details: [] },
      ]);
    });

    /** @scenario "A trace's evaluation spans, events, ingest lag and occurrence are read from its latest versions" */
    it("measures the project's ingest lag from its own spans", async () => {
      const lag = await repo.findIngestLag({ authorization });

      expect(lag).toEqual({ p95LagMs: 1_000, sampleCount: 1 });
    });

    /** @scenario "A trace's evaluation spans, events, ingest lag and occurrence are read from its latest versions" */
    it("resolves a first page's unknown occurrence from the trace summary", async () => {
      sent.length = 0;
      await repo.listSummaryPage({ authorization, traceId, limit: 10 });
      const resolve = sent[0]?.idBound?.resolveHint;

      await expect(resolve?.()).resolves.toBe(base);
    });
  });
});
