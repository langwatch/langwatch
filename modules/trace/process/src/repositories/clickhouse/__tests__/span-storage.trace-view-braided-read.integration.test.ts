/**
 * Every trace-view read of a braided trace, against production schema (ADR-183 §3, §5): each
 * returns the reader's spans and the owner's matching spans, naming the owner on its own. A read
 * that does not ask for `spans` stays the reader's own. Spec: braided-spans.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Authorization, CompiledWhere } from "@langwatch/authorization";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { braidedProof } from "../../../__tests__/support/authorization-proofs.fixture.ts";
import type { TraceViewRead } from "../../span-storage.repository.ts";
import { SpanStorageClickHouseRepository } from "../span-storage.repository.ts";
import { authorizedClickHouseFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const reader = `test-braid-view-reader-${nanoid()}`;
const owner = `test-braid-view-owner-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
const MATCHING = { orchestrator: "web", "langwatch.user_id": "user-1" };

let ch: ClickHouseClient;
let repo: SpanStorageClickHouseRepository;

function spanRow(input: {
  tenantId: string;
  spanId: string;
  offsetMs: number;
  updatedOffsetMs?: number;
  attributes: Record<string, string>;
}) {
  const start = new Date(base + input.offsetMs);
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: traceId,
    SpanId: input.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: start,
    EndTime: new Date(base + input.offsetMs + 50),
    DurationMs: 50,
    SpanName: input.spanId,
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: { "service.name": input.tenantId },
    SpanAttributes: input.attributes,
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [start],
    "Events.Name": ["checkpoint"],
    "Events.Attributes": [{ step: input.spanId }],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: start,
    UpdatedAt: new Date(base + (input.updatedOffsetMs ?? input.offsetMs)),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = SpanStorageClickHouseRepository.create({
    resolveClient: async () => {
      throw new Error("this test reads only");
    },
    clickhouse: authorizedClickHouseFor(ch),
  });
  for (const row of [
    spanRow({ tenantId: reader, spanId: "reader-root", offsetMs: 0, attributes: MATCHING }),
    spanRow({ tenantId: reader, spanId: "shared", offsetMs: 5, attributes: MATCHING }),
    spanRow({ tenantId: owner, spanId: "owner-web", offsetMs: 10, attributes: MATCHING }),
    spanRow({ tenantId: owner, spanId: "shared", offsetMs: 15, attributes: MATCHING }),
    spanRow({
      tenantId: owner,
      spanId: "owner-app",
      offsetMs: 20,
      attributes: { orchestrator: "app", "langwatch.user_id": "user-1" },
    }),
    spanRow({ tenantId: owner, spanId: "owner-changed", offsetMs: 30, attributes: MATCHING }),
    spanRow({
      tenantId: owner,
      spanId: "owner-changed",
      offsetMs: 30,
      updatedOffsetMs: 40,
      attributes: { "langwatch.user_id": "user-1" },
    }),
  ]) {
    await ch.insert({
      table: "stored_spans",
      values: [row],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  }
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const tenantId of [reader, owner]) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

type Read = (input: {
  authorization: Authorization;
  reads?: TraceViewRead["reads"];
}) => Promise<(string | null)[][]>;

const at = { traceId, occurredAtMs: base };
const named = (rows: { spanId: string; ownerProjectId?: string }[]) =>
  rows.map((row) => [row.spanId, row.ownerProjectId ?? null]);
const namedSpans = (spans: { span_id: string; ownerProjectId?: string }[]) =>
  spans.map((span) => [span.span_id, span.ownerProjectId ?? null]);

const reads: Record<string, Read> = {
  spansPaginated: async (input) =>
    namedSpans((await repo.listSpansPaginated({ ...input, ...at, limit: 100, offset: 0 })).spans),
  spansDelta: async (input) =>
    namedSpans(await repo.findSpansSince({ ...input, ...at, sinceStartTimeMs: base - 60_000 })),
  spansFull: async (input) => namedSpans(await repo.findSpansByTraceId({ ...input, ...at })),
  spansFullResolved: async (input) =>
    (await repo.findNormalizedSpansByTraceId({ ...input, ...at })).map((span) => [
      span.spanId,
      span.tenantId === reader ? null : span.tenantId,
    ]),
  spanTree: async (input) => named(await repo.findSpanSummaryByTraceId({ ...input, ...at })),
  spanLangwatchSignals: async (input) =>
    named(await repo.findLangwatchSignalsByTraceId({ ...input, ...at })),
  resourceInfo: async (input) => named(await repo.findSpanResourcesByTraceId({ ...input, ...at })),
  traceEvents: async (input) => named(await repo.findTraceEventsByTraceId({ ...input, ...at })),
};

const sorted = (rows: (string | null)[][]) => rows.map((row) => row.join("@")).toSorted();

describe.skipIf(!clickHouseConfigured)(
  "SpanStorageClickHouseRepository's trace-view reads under a braid",
  () => {
    const authorization = () =>
      braidedProof({ projectId: reader, braids: [{ owner, compiledWhere: WEB }] });

    describe.each(Object.entries(reads))("given the %s read", (_name, read) => {
      describe("when the trace view reads spans", () => {
        /** @scenario "Every view of the trace shows the same braided spans" */
        it("returns the reader's spans and the owner's matching ones, naming the owner", async () => {
          expect(sorted(await read({ authorization: authorization(), reads: "spans" }))).toEqual(
            sorted([
              ["reader-root", null],
              ["shared", null],
              ["owner-web", owner],
              ["shared", owner],
            ]),
          );
        });
      });

      describe("when another read holds the same proof", () => {
        it("returns only the reader's own spans", async () => {
          expect(sorted(await read({ authorization: authorization() }))).toEqual(
            sorted([
              ["reader-root", null],
              ["shared", null],
            ]),
          );
        });
      });
    });

    describe("when the trace view pages the spans", () => {
      it("counts each project's span once, and no owner span the condition dropped", async () => {
        const page = await repo.listSpansPaginated({
          authorization: authorization(),
          reads: "spans",
          ...at,
          limit: 1,
          offset: 0,
        });

        expect(page.total).toBe(4);
      });
    });
  },
);
