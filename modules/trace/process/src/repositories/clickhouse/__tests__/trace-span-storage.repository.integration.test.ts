/** The single-span derivation read against production schema: of several
 * unmerged versions of one span, the latest by UpdatedAt is the one read back.
 * @see modules/trace/specs/span-storage-read.feature */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceSpanStorageClickHouseRepository } from "../trace-span-storage.repository.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tenantId = `test-span-derivation-${nanoid()}`;
const traceId = `trace-${nanoid()}`;
const spanId = `span-${nanoid()}`;
const base = Date.now() - 60 * 60 * 1000;

let ch: ClickHouseClient;
let repo: TraceSpanStorageClickHouseRepository;

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
  repo = TraceSpanStorageClickHouseRepository.create({
    resolveClient: async () => ch,
    defaultRetentionDays: 49,
  });

  // Separate inserts leave three unmerged parts; the newest is inserted first
  // so insertion order cannot be what picks the winner.
  for (const row of [
    versionRow({ offsetMs: 2_000, version: "latest" }),
    versionRow({ offsetMs: 0, version: "first" }),
    versionRow({ offsetMs: 1_000, version: "second" }),
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
  "TraceSpanStorageClickHouseRepository.findNormalizedSpanById",
  () => {
    describe("given a span stored as several unmerged versions", () => {
      /** @scenario "The latest of several unmerged versions is the one read back" */
      it("reads back the version with the latest UpdatedAt", async () => {
        const span = await repo.findNormalizedSpanById({
          tenantId,
          traceId,
          spanId,
          occurredAtMs: base,
        });

        expect(span).toMatchObject({
          tenantId,
          traceId,
          spanId,
          spanAttributes: { version: "latest" },
        });
      });
    });

    describe("given another tenant asks for the same span", () => {
      /** @scenario "The latest of several unmerged versions is the one read back" */
      it("answers absent rather than reading across tenants", async () => {
        const span = await repo.findNormalizedSpanById({
          tenantId: `${tenantId}-other`,
          traceId,
          spanId,
          occurredAtMs: base,
        });

        expect(span).toBeNull();
      });
    });
  },
);
