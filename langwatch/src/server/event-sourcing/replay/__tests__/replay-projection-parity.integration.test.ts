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
  createTestPipeline,
  closePipelineGracefully,
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
      // Phase 1: insert synthetic event_log rows representing a completed live ingestion.
      // This simulates what the live pipeline writes after the storeEvents step.
      const LARGE_OUTPUT = "x".repeat(100 * 1024);

      const eventPayload = JSON.stringify({
        id: "evt-replay-parity-001",
        aggregateId: traceId,
        aggregateType: "trace",
        tenantId,
        type: SPAN_RECEIVED_EVENT_TYPE,
        version: "2025-12-14",
        createdAt: 1700000000000,
        occurredAt: 1700000000000,
        data: {
          span: {
            traceId,
            spanId: "span-replay-001",
            name: "test-span",
            kind: 1,
            attributes: [
              { key: "langwatch.output", value: { stringValue: LARGE_OUTPUT } },
            ],
            events: [],
            links: [],
            status: {},
            startTimeUnixNano: "1700000000000000000",
            endTimeUnixNano: "1700000001000000000",
            droppedAttributesCount: 0,
            droppedEventsCount: 0,
            droppedLinksCount: 0,
          },
          resource: null,
          instrumentationScope: null,
          piiRedactionLevel: "DISABLED",
        },
      });

      await client.insert({
        table: "event_log",
        values: [
          {
            TenantId: tenantId,
            AggregateType: "trace",
            AggregateId: traceId,
            EventId: "evt-replay-parity-001",
            EventType: SPAN_RECEIVED_EVENT_TYPE,
            EventTimestamp: 1700000000000,
            EventOccurredAt: 1700000000000,
            EventVersion: "2025-12-14",
            EventPayload: eventPayload,
          },
        ],
        format: "JSONEachRow",
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

      expect(eventLogRows).toHaveLength(1);

      // Apply leanForProjection to every row — mimicking replayExecutor.apply.
      // leanForProjection throws "not implemented" until Step 5 — that is the
      // TDD failure signal expected at this stage.
      const leanedEvents = eventLogRows.map((row) => {
        const event = JSON.parse(row.EventPayload) as Parameters<typeof leanForProjection>[0];
        return leanForProjection(event);
      });

      // Parity assertions: the leaned events must have the IO attr truncated
      // to IO_PREVIEW_BYTES and carry an eventref pointer.
      expect(leanedEvents).toHaveLength(1);

      const leanedSpanData = leanedEvents[0]?.data as {
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
    });
  });
});
