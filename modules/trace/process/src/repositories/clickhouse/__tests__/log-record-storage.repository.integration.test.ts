// Trace's two log reads, built (ADR-202), against the migrated schema on a real ClickHouse.
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { beforeAll, describe, expect, it } from "vitest";

import { LogRecordStorageClickHouseRepository } from "../log-record-storage.repository.ts";
import { traceQueryClientFor } from "./support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "./support/clickhouse-endpoint.support.ts";

const clickHouseConfigured = testClickHouseConfigured();

const tag = nanoid();
const tenantId = `${tag}-project`;
const otherTenantId = `${tag}-other`;
const traceId = `${tag}-trace`;
const baseMs = Date.now() - 60_000;
const DAY_MS = 24 * 60 * 60 * 1000;

let ch: ClickHouseClient;
let repository: LogRecordStorageClickHouseRepository;

const iso = (ms: number) => new Date(ms).toISOString();

function storedLog({
  tenant = tenantId,
  spanId,
  timeMs,
  body,
  updatedAtMs,
}: {
  tenant?: string;
  spanId: string;
  timeMs: number;
  body: string;
  updatedAtMs: number;
}) {
  return {
    ProjectionId: `${spanId}-projection`,
    TenantId: tenant,
    TraceId: traceId,
    SpanId: spanId,
    TimeUnixMs: iso(timeMs),
    SeverityNumber: 9,
    SeverityText: "INFO",
    Body: body,
    Attributes: { key: body },
    ResourceAttributes: {},
    ScopeName: "scope",
    ScopeVersion: null,
    CreatedAt: iso(updatedAtMs),
    UpdatedAt: iso(updatedAtMs),
  };
}

function canonicalLog({
  tenant = tenantId,
  recordId,
  timeMs,
  body,
  version,
}: {
  tenant?: string;
  recordId: string;
  timeMs: number;
  body: string;
  version: number;
}) {
  return {
    TenantId: tenant,
    RecordId: recordId.padEnd(64, "0").slice(0, 64),
    ResourceAttributesFlatJson: "{}",
    ScopeName: "codex",
    ScopeVersion: "1",
    CorrelationTraceId: traceId,
    CorrelationSpanId: "span-1",
    TimeUnixNano: String(BigInt(timeMs) * 1_000_000n),
    TimeUnixMs: iso(timeMs),
    BodyText: body,
    AttributesFlatJson: JSON.stringify({ body }),
    EventName: "codex.tool_result",
    OccurredAt: iso(timeMs),
    AcceptedAt: iso(timeMs),
    DedupVersion: version,
  };
}

describe.skipIf(!clickHouseConfigured)("given logs stored for a trace in both log tables", () => {
  beforeAll(async () => {
    ch = await startMigratedTraceClickHouse();
    repository = LogRecordStorageClickHouseRepository.create({ reader: traceQueryClientFor(ch) });

    await ch.insert({
      table: "stored_log_records",
      format: "JSONEachRow",
      values: [
        storedLog({ spanId: "span-a", timeMs: baseMs, body: "a-old", updatedAtMs: baseMs }),
        storedLog({ spanId: "span-a", timeMs: baseMs, body: "a-new", updatedAtMs: baseMs + 1 }),
        storedLog({ spanId: "span-b", timeMs: baseMs - 1_000, body: "b", updatedAtMs: baseMs }),
        storedLog({
          spanId: "span-far",
          timeMs: baseMs - 10 * DAY_MS,
          body: "far",
          updatedAtMs: baseMs,
        }),
        storedLog({
          tenant: otherTenantId,
          spanId: "span-a",
          timeMs: baseMs,
          body: "other",
          updatedAtMs: baseMs + 5,
        }),
      ],
    });
    await ch.insert({
      table: "log_records",
      format: "JSONEachRow",
      values: [
        canonicalLog({ recordId: `${tag}a`, timeMs: baseMs, body: "first-old", version: 1 }),
        canonicalLog({ recordId: `${tag}a`, timeMs: baseMs, body: "first-new", version: 2 }),
        canonicalLog({ recordId: `${tag}b`, timeMs: baseMs + 1_000, body: "second", version: 1 }),
        canonicalLog({
          recordId: `${tag}c`,
          timeMs: baseMs - 20 * DAY_MS,
          body: "outside",
          version: 1,
        }),
        canonicalLog({
          tenant: otherTenantId,
          recordId: `${tag}a`,
          timeMs: baseMs,
          body: "other",
          version: 9,
        }),
      ],
    });
  });

  describe("when trace reads the legacy stored logs with a turn-time hint", () => {
    it("returns each record's latest version inside the window, oldest first, for the tenant only", async () => {
      const logs = await repository.findLogsByTraceId({ tenantId, traceId, occurredAtMs: baseMs });

      expect(logs.map((log) => log.body)).toEqual(["b", "a-new"]);
      expect(logs[1]).toMatchObject({
        traceId,
        spanId: "span-a",
        timeUnixMs: baseMs,
        attributes: { key: "a-new" },
        scopeName: "scope",
        scopeVersion: null,
      });
    });
  });

  describe("when trace reads the legacy stored logs without a hint", () => {
    it("reads the 90-day lookback, the far record included", async () => {
      const logs = await repository.findLogsByTraceId({ tenantId, traceId });

      expect(logs.map((log) => log.body)).toEqual(["far", "b", "a-new"]);
    });
  });

  describe("when trace reads log's records correlated to the trace", () => {
    it("returns each merged record once inside the window, in time order, for the tenant only", async () => {
      const logs = await repository.findLogRecordsByTraceId({
        tenantId,
        traceId,
        occurredAtMs: baseMs,
      });

      expect(logs.map((log) => log.body)).toEqual(["first-new", "second"]);
      expect(logs[0]).toMatchObject({
        traceId,
        spanId: "span-1",
        timeUnixMs: baseMs,
        attributes: { body: "first-new", "event.name": "codex.tool_result" },
        scopeName: "codex",
        scopeVersion: "1",
      });
    });
  });
});
