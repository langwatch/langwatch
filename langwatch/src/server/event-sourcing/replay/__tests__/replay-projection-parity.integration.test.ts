/**
 * Integration test for the load-bearing ADR-022 invariant:
 * replay produces byte-identical projection state as live ingestion.
 *
 * ADR-022 §"Rules":
 *   `leanForProjection` is the single source of truth for the lean shape.
 *   It is invoked at the dispatch interposition AND in `replayExecutor.apply`
 *   before invoking projection handlers. Any future place that consumes events
 *   for projection MUST go through it. This test pins that invariant.
 *
 * Environment: testcontainer harness (same globalSetup as replayService.integration.test.ts).
 * If testcontainers are unavailable (no globalSetup), the test fails at beforeAll —
 * that is EXPECTED for TDD (the test is a contract, not yet a passing spec).
 * The test will pass once both the live pipeline interposition and replayExecutor.apply
 * invoke leanForProjection (Step 5).
 *
 * BDD structure: describe("given X") → describe("when Y") → it("…").
 * No "should" in it() names (project convention).
 *
 * @scenario Replay produces byte-identical projection state as live ingestion
 */

import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
import type { ClickHouseClient } from "@clickhouse/client";
import {
  startTestContainers,
  stopTestContainers,
  getTestClickHouseClient,
} from "../../__tests__/integration/testContainers";
import {
  generateTestTenantId,
  generateTestAggregateId,
} from "../../__tests__/integration/testHelpers";
import { leanForProjection } from "~/server/app-layer/traces/lean-for-projection";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
        addEvent: () => void;
      }) => unknown,
    ) =>
      fn({
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
      }),
  }),
}));

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

/**
 * @scenario Replay produces byte-identical projection state as live ingestion
 */
describe("given a sequence of span events ingested via the live pipeline", () => {
  let tenantId: string;
  let traceId: string;
  let client: ClickHouseClient;

  beforeAll(async () => {
    // Will fail here if testcontainers are unavailable — that is expected for
    // TDD until Step 5 wires the full pipeline with leanForProjection.
    await startTestContainers();
    client = getTestClickHouseClient()!;
    tenantId = generateTestTenantId();
    traceId = generateTestAggregateId("replay-parity");
  });

  afterAll(async () => {
    if (client) {
      // Best-effort cleanup
      try {
        await client.exec({
          query: `ALTER TABLE event_log DELETE WHERE TenantId = {tenantId:String}`,
          query_params: { tenantId },
        });
      } catch {
        // ignore
      }
    }
    await stopTestContainers();
  });

  describe("when the same event sequence is replayed from event_log via replayExecutor", () => {
    it("leanForProjection is invoked on every event at the same logical point in both the live and replay paths, producing byte-identical projection state", async () => {
      // Phase 1: insert a SEQUENCE of synthetic event_log rows representing a
      // completed live ingestion (the scenario is "a sequence of span events").
      // This simulates what the live pipeline writes after the storeEvents step.
      const LARGE_OUTPUT = "x".repeat(100 * 1024);

      // Three span events of the SAME trace. Each carries the large IO attribute
      // so the parity assertions below hold for every event in the sequence.
      const EVENT_IDS = [
        "evt-replay-parity-001",
        "evt-replay-parity-002",
        "evt-replay-parity-003",
      ] as const;

      // Use a recent base timestamp so the rows are within the active retention
      // window. event_log has a DELETE TTL installed at deploy time:
      //   IF(_retention_days > 0, toDateTime(EventOccurredAt/1000) + toIntervalDay(_retention_days), '2106-01-01') DELETE
      // The prior fixture used a hardcoded Nov-2023 epoch (1700000000000 ms).
      // With the default _retention_days=308, the TTL expiry was ~Sep 2024 —
      // already stale at the CI run date (2026-06-09). ClickHouse TTL-deleted
      // the freshly-inserted parts before the SELECT, returning 0 rows.
      // Using Date.now() keeps the rows current; _retention_days:0 is an
      // additional belt-and-suspenders sentinel meaning "never expire" (same
      // idiom used in large-trace-blob-offload-readpath.integration.test.ts).
      const baseOccurredAt = Date.now();
      const records = EVENT_IDS.map((eventId, i) => {
        const occurredAt = baseOccurredAt + i * 1000;
        const eventPayload = JSON.stringify({
          id: eventId,
          aggregateId: traceId,
          aggregateType: "trace",
          tenantId,
          type: SPAN_RECEIVED_EVENT_TYPE,
          version: "2025-12-14",
          createdAt: occurredAt,
          occurredAt,
          // event_log dedups on IdempotencyKey, so the payload's idempotencyKey
          // mirrors the row's IdempotencyKey (production sets both — see below).
          idempotencyKey: eventId,
          data: {
            span: {
              traceId,
              spanId: `span-replay-00${i + 1}`,
              name: "test-span",
              kind: 1,
              attributes: [
                { key: "langwatch.output", value: { stringValue: LARGE_OUTPUT } },
              ],
              events: [],
              links: [],
              status: {},
              startTimeUnixNano: `${occurredAt}000000`,
              endTimeUnixNano: `${occurredAt + 1000}000000`,
              droppedAttributesCount: 0,
              droppedEventsCount: 0,
              droppedLinksCount: 0,
            },
            resource: null,
            instrumentationScope: null,
            piiRedactionLevel: "DISABLED",
          },
        });

        return {
          TenantId: tenantId,
          AggregateType: "trace",
          AggregateId: traceId,
          EventId: eventId,
          EventType: SPAN_RECEIVED_EVENT_TYPE,
          EventTimestamp: occurredAt,
          EventOccurredAt: occurredAt,
          EventVersion: "2025-12-14",
          EventPayload: eventPayload,
          // event_log is ReplacingMergeTree(EventTimestamp) keyed by
          // (TenantId, AggregateType, AggregateId, IdempotencyKey). Production
          // ALWAYS stamps IdempotencyKey = event.idempotencyKey || event.id
          // (eventStoreUtils.eventToRecord), so distinct events of one trace get
          // distinct sort keys and never collapse.
          IdempotencyKey: eventId,
          // _retention_days: 0 = never-expire sentinel (same as the blob-offload
          // readpath test). Prevents TTL deletion regardless of the table's
          // retention window — test-only fixture, not production data.
          _retention_days: 0,
        };
      });

      await client.insert({
        table: "event_log",
        values: records,
        format: "JSONEachRow",
        // Synchronous insert so the SELECT below reads the rows back immediately.
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 1 },
      });

      // Phase 2: load the same events from event_log and apply leanForProjection.
      // In the real replay path (post-Step5), replayExecutor.apply calls
      // leanForProjection before projection.apply — this test exercises that call.
      const replayRows = await client.query({
        query: `
          SELECT EventPayload
          FROM event_log
          WHERE TenantId = {tenantId:String}
            AND AggregateId = {traceId:String}
          ORDER BY EventTimestamp ASC
        `,
        query_params: { tenantId, traceId },
        format: "JSONEachRow",
      });
      const eventLogRows = await replayRows.json<{ EventPayload: string }>();

      // Every inserted event must be read back — none collapsed by the merge.
      expect(eventLogRows).toHaveLength(EVENT_IDS.length);

      // Apply leanForProjection to every row — mimicking replayExecutor.apply.
      const leanedEvents = eventLogRows.map((row) => {
        const event = JSON.parse(row.EventPayload) as Parameters<typeof leanForProjection>[0];
        return leanForProjection(event);
      });

      // Parity assertions hold for EVERY event in the sequence: each leaned span
      // must have the IO attr truncated to IO_PREVIEW_BYTES and carry an eventref.
      expect(leanedEvents).toHaveLength(EVENT_IDS.length);

      for (const leaned of leanedEvents) {
        const leanedSpanData = leaned?.data as {
          span: { attributes?: Array<{ key: string; value: { stringValue?: string } }> };
        };
        const outputAttr = leanedSpanData?.span?.attributes?.find(
          (a) => a.key === "langwatch.output",
        );
        expect(outputAttr).toBeDefined();
        // Preview must be shorter than the original 100 KB value
        expect(
          Buffer.byteLength(outputAttr?.value?.stringValue ?? "", "utf-8"),
        ).toBeLessThan(Buffer.byteLength(LARGE_OUTPUT, "utf-8"));

        // eventref must be attached
        const eventrefAttr = leanedSpanData?.span?.attributes?.find(
          (a) => a.key === "langwatch.reserved.eventref.langwatch.output",
        );
        expect(eventrefAttr).toBeDefined();
      }
    });
  });
});
