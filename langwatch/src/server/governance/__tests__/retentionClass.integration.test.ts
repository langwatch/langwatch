/**
 * Per-origin retention class — integration tests verifying the
 * write-side population (3c-ii) lands the RetentionClass column on
 * stored_spans + stored_log_records, AND that the per-class DELETE
 * TTL clauses from migration 00022 are present in the table metadata.
 *
 * What we CAN test in CI:
 *   - RetentionClass column populated from
 *     `langwatch.governance.retention_class` attribute at write time
 *   - Empty-string default for non-governance traffic
 *   - Per-class TTL clauses are present in system.tables engine_full
 *     metadata (so we know the TTL contract is in force; we cannot
 *     wait 30 days in a test to actually observe expiration)
 *
 * What we CANNOT test in CI:
 *   - The DELETE itself firing after the TTL interval — that requires
 *     waiting 30+ days OR mocking ClickHouse's clock. The DELETE
 *     mechanics are owned + tested by ClickHouse upstream.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/retention.feature
 *
 * Pairs with:
 *   - 3c-i migration (00022_add_retention_class.sql)
 *   - 3c-ii write-side population
 *     (span-storage.clickhouse.repository.ts +
 *      log-record-storage.clickhouse.repository.ts)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { SpanStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/span-storage.clickhouse.repository";
import { LogRecordStorageClickHouseRepository } from "~/server/app-layer/traces/repositories/log-record-storage.clickhouse.repository";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";

const TENANT_ID = `gov-retention-${nanoid(8)}`;

async function readRetentionClass(
  ch: ClickHouseClient,
  table: string,
  spanIdOrTraceId: { kind: "span" | "trace"; value: string },
): Promise<string | null> {
  const where =
    spanIdOrTraceId.kind === "span"
      ? "SpanId = {id:String}"
      : "TraceId = {id:String}";
  const result = await ch.query({
    query: `
      SELECT RetentionClass
      FROM ${table}
      WHERE TenantId = {tenantId:String}
        AND ${where}
      LIMIT 1
    `,
    query_params: { tenantId: TENANT_ID, id: spanIdOrTraceId.value },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ RetentionClass: string }>;
  return rows[0]?.RetentionClass ?? null;
}

async function readTableTTL(
  ch: ClickHouseClient,
  table: string,
): Promise<string> {
  const result = await ch.query({
    query: `
      SELECT engine_full
      FROM system.tables
      WHERE database = currentDatabase() AND name = {table:String}
    `,
    query_params: { table },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ engine_full: string }>;
  return rows[0]?.engine_full ?? "";
}

describe("Per-origin retention class — write-side population + TTL clauses", () => {
  let ch: ClickHouseClient;
  let spanRepo: SpanStorageClickHouseRepository;
  let logRepo: LogRecordStorageClickHouseRepository;

  beforeAll(async () => {
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) {
      throw new Error("ClickHouse test container not available");
    }
    ch = maybeCh;
    spanRepo = new SpanStorageClickHouseRepository(async () => ch);
    logRepo = new LogRecordStorageClickHouseRepository(async () => ch);
  });

  afterAll(async () => {
    await cleanupTestData(TENANT_ID);
  });

  describe("when a governance-origin span lands with retention_class attribute", () => {
    it("populates RetentionClass column from spanAttributes.langwatch.governance.retention_class", async () => {
      const spanId = `span-thirty-${nanoid()}`;
      const traceId = `trace-thirty-${nanoid()}`;
      await spanRepo.insertSpan({
        id: `proj-${nanoid()}`,
        tenantId: TENANT_ID,
        traceId,
        spanId,
        parentSpanId: null,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: Date.now(),
        endTimeUnixMs: Date.now() + 100,
        durationMs: 100,
        name: "test-span",
        kind: 1,
        resourceAttributes: {},
        spanAttributes: {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.governance.retention_class": "thirty_days",
        },
        statusCode: 1,
        statusMessage: null,
        instrumentationScope: { name: "test", version: undefined },
        events: [],
        links: [],
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      });
      const value = await readRetentionClass(ch, "stored_spans", {
        kind: "span",
        value: spanId,
      });
      expect(value).toBe("thirty_days");
    });

    it("populates RetentionClass = 'one_year' for compliance-baseline source", async () => {
      const spanId = `span-one-year-${nanoid()}`;
      await spanRepo.insertSpan({
        id: `proj-${nanoid()}`,
        tenantId: TENANT_ID,
        traceId: `trace-${nanoid()}`,
        spanId,
        parentSpanId: null,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: Date.now(),
        endTimeUnixMs: Date.now() + 100,
        durationMs: 100,
        name: "test-span",
        kind: 1,
        resourceAttributes: {},
        spanAttributes: {
          "langwatch.governance.retention_class": "one_year",
        },
        statusCode: 1,
        statusMessage: null,
        instrumentationScope: { name: "test", version: undefined },
        events: [],
        links: [],
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      });
      const value = await readRetentionClass(ch, "stored_spans", {
        kind: "span",
        value: spanId,
      });
      expect(value).toBe("one_year");
    });

    it("populates RetentionClass = 'seven_years' for regulated-industry source", async () => {
      const spanId = `span-seven-${nanoid()}`;
      await spanRepo.insertSpan({
        id: `proj-${nanoid()}`,
        tenantId: TENANT_ID,
        traceId: `trace-${nanoid()}`,
        spanId,
        parentSpanId: null,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: Date.now(),
        endTimeUnixMs: Date.now() + 100,
        durationMs: 100,
        name: "test-span",
        kind: 1,
        resourceAttributes: {},
        spanAttributes: {
          "langwatch.governance.retention_class": "seven_years",
        },
        statusCode: 1,
        statusMessage: null,
        instrumentationScope: { name: "test", version: undefined },
        events: [],
        links: [],
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      });
      const value = await readRetentionClass(ch, "stored_spans", {
        kind: "span",
        value: spanId,
      });
      expect(value).toBe("seven_years");
    });
  });

  describe("when an application-origin span lands with no retention_class attribute", () => {
    it("defaults RetentionClass to '' so no TTL clause matches", async () => {
      const spanId = `span-app-${nanoid()}`;
      await spanRepo.insertSpan({
        id: `proj-${nanoid()}`,
        tenantId: TENANT_ID,
        traceId: `trace-${nanoid()}`,
        spanId,
        parentSpanId: null,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: Date.now(),
        endTimeUnixMs: Date.now() + 100,
        durationMs: 100,
        name: "test-app-span",
        kind: 1,
        resourceAttributes: {},
        spanAttributes: { "service.name": "my-app" },
        statusCode: 1,
        statusMessage: null,
        instrumentationScope: { name: "test", version: undefined },
        events: [],
        links: [],
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      });
      const value = await readRetentionClass(ch, "stored_spans", {
        kind: "span",
        value: spanId,
      });
      expect(value).toBe("");
    });
  });

  describe("when a governance-origin log record lands with retention_class attribute", () => {
    it("populates RetentionClass column on stored_log_records", async () => {
      const traceId = `trace-log-${nanoid()}`;
      await logRepo.insertLogRecord({
        id: `proj-${nanoid()}`,
        tenantId: TENANT_ID,
        traceId,
        spanId: `span-${nanoid()}`,
        timeUnixMs: Date.now(),
        severityNumber: 9,
        severityText: "INFO",
        body: "{}",
        attributes: {
          "langwatch.origin.kind": "ingestion_source",
          "langwatch.governance.retention_class": "seven_years",
        },
        resourceAttributes: {},
        scopeName: "test",
        scopeVersion: null,
      });
      const value = await readRetentionClass(ch, "stored_log_records", {
        kind: "trace",
        value: traceId,
      });
      expect(value).toBe("seven_years");
    });

    it("defaults to '' for non-governance log records", async () => {
      const traceId = `trace-app-log-${nanoid()}`;
      await logRepo.insertLogRecord({
        id: `proj-${nanoid()}`,
        tenantId: TENANT_ID,
        traceId,
        spanId: `span-${nanoid()}`,
        timeUnixMs: Date.now(),
        severityNumber: 9,
        severityText: "INFO",
        body: "{}",
        attributes: {},
        resourceAttributes: {},
        scopeName: "test",
        scopeVersion: null,
      });
      const value = await readRetentionClass(ch, "stored_log_records", {
        kind: "trace",
        value: traceId,
      });
      expect(value).toBe("");
    });
  });

  describe("table metadata invariants — TTL clauses are in force", () => {
    it("stored_spans engine_full contains all 3 per-class DELETE TTL clauses", async () => {
      const engineFull = await readTableTTL(ch, "stored_spans");
      // Compact whitespace + lowercase for resilient matching.
      const norm = engineFull.replace(/\s+/g, " ").toLowerCase();
      expect(norm).toMatch(/retentionclass\s*=\s*'thirty_days'/);
      expect(norm).toMatch(/retentionclass\s*=\s*'one_year'/);
      expect(norm).toMatch(/retentionclass\s*=\s*'seven_years'/);
      expect(norm).toMatch(/interval\s+30\s+day/);
      expect(norm).toMatch(/interval\s+1\s+year/);
      expect(norm).toMatch(/interval\s+7\s+year/);
    });

    it("stored_log_records engine_full contains all 3 per-class DELETE TTL clauses", async () => {
      const engineFull = await readTableTTL(ch, "stored_log_records");
      const norm = engineFull.replace(/\s+/g, " ").toLowerCase();
      expect(norm).toMatch(/retentionclass\s*=\s*'thirty_days'/);
      expect(norm).toMatch(/retentionclass\s*=\s*'one_year'/);
      expect(norm).toMatch(/retentionclass\s*=\s*'seven_years'/);
    });
  });
});
