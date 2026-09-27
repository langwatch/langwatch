/** The whole-trace derivation read against production schema: its per-span argMax
 * aliases must not shadow the tenant, trace and time columns its WHERE filters on.
 * @see modules/trace/specs/span-storage-read.feature */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceDerivationSpanClickHouseRepository } from "../trace-derivation-span.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-trace-derivation-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const spanId = `span-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
let repo: TraceDerivationSpanClickHouseRepository;

function versionRow({ offsetMs, version }: { offsetMs: number; version: string }) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    SpanId: spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base + offsetMs),
    EndTime: new Date(base + offsetMs + 50),
    DurationMs: 50,
    SpanName: "derivation-span",
    SpanKind: 1,
    ServiceName: "test-service",
    ResourceAttributes: {},
    SpanAttributes: { version },
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    "Events.Timestamp": [] as Date[],
    "Events.Name": [] as string[],
    "Events.Attributes": [] as Record<string, string>[],
    "Links.TraceId": [] as string[],
    "Links.SpanId": [] as string[],
    "Links.Attributes": [] as Record<string, string>[],
    DroppedAttributesCount: 0,
    DroppedEventsCount: 0,
    DroppedLinksCount: 0,
    CreatedAt: new Date(base + offsetMs),
    UpdatedAt: new Date(base + offsetMs),
  };
}

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  repo = TraceDerivationSpanClickHouseRepository.create({ resolveClient: async () => ch });

  // Separate inserts leave unmerged parts; the newest goes first so insertion
  // order cannot pick the winner, and it starts latest so a merge keeps it too.
  for (const row of [
    versionRow({ offsetMs: 2_000, version: "latest" }),
    versionRow({ offsetMs: 0, version: "first" }),
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
  if (ch) {
    await ch.exec({
      query: "ALTER TABLE stored_spans DELETE WHERE TenantId = {tenantId:String}",
      query_params: { tenantId },
    });
  }
});

describe.skipIf(!clickHouseConfigured)(
  "TraceDerivationSpanClickHouseRepository.findNormalizedSpansByTraceId",
  () => {
    describe("given a trace whose span is stored as several unmerged versions", () => {
      /** @scenario "A trace's spans are read back for derivation, one latest version each" */
      it("reads that span once, as the version with the latest UpdatedAt", async () => {
        const spans = await repo.findNormalizedSpansByTraceId({
          tenantId,
          traceId,
          occurredAtMs: base,
        });

        expect(spans).toHaveLength(1);
        expect(spans[0]).toMatchObject({
          tenantId,
          traceId,
          spanId,
          spanAttributes: { version: "latest" },
        });
      });

      /** @scenario "A trace's spans are read back for derivation, one latest version each" */
      it("reads the same span when no occurrence hint bounds the read", async () => {
        const spans = await repo.findNormalizedSpansByTraceId({ tenantId, traceId });

        expect(spans.map((span) => span.spanAttributes.version)).toEqual(["latest"]);
      });
    });

    describe("given another tenant asks for the same trace", () => {
      /** @scenario "A trace's spans are read back for derivation, one latest version each" */
      it("answers no spans rather than reading across tenants", async () => {
        const spans = await repo.findNormalizedSpansByTraceId({
          tenantId: `${tenantId}-other`,
          traceId,
          occurredAtMs: base,
        });

        expect(spans).toEqual([]);
      });
    });
  },
);
