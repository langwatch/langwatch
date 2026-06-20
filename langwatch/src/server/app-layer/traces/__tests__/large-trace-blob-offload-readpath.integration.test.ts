/**
 * Read-path integration test for the large-trace blob offload pipeline
 * (#4215 / ADR-022) against a REAL ClickHouse `event_log` table.
 *
 * Environment choice: testcontainer ClickHouse (NOT an in-memory fake).
 *
 * Why this file exists alongside large-trace-blob-offload.integration.test.ts:
 * that sibling proves pipeline WIRING with a FAKE in-memory BlobStore — it never
 * exercises the real `event_log` SELECT/JOIN in `BlobStore.getFromEventLog`. A
 * reviewer caught a real round-1 bug where the v2 read path returned the 64 KB
 * preview instead of the full payload. This test closes that gap: it writes the
 * FULL event into a real `event_log` row (the same shape the production write
 * path stores — `EventPayload` IS `event.data`, span/body at the top level),
 * produces the LEANED projection of that same event via `leanForProjection`, and
 * drives the REAL read path so the resolved value is read back FROM ClickHouse —
 * proving the > 64 KB original is returned in FULL, not the truncated preview.
 *
 * Two cases, both exercising the real CH JOIN
 * (TenantId/AggregateType/AggregateId/EventId) in `getFromEventLog`:
 *   1. Span IO attribute (`langwatch.input`) round-trip — driven through the
 *      highest-level v2 read entry, `SpanStorageService.getSpansByTraceId`,
 *      wired with the REAL `BlobStore`. The leaned `NormalizedSpan` is staged
 *      via a thin repository whose ONLY non-Null override is
 *      `getNormalizedSpansByTraceId` (the method the v2 read path calls); the
 *      full bytes come back out of real ClickHouse.
 *   2. Log-record `body` round-trip (the round-2 fix, GtVrA) — driven through
 *      `resolveOffloadedTraces` with the REAL `BlobStore`, because `body` is not
 *      a Span-mapped IO field (`SpanStorageService` + the span mapper would drop
 *      it), so `resolveOffloadedTraces` is the faithful highest-level entry. It
 *      exercises the `field === "body"` branch (blob-store.service.ts:211-217)
 *      against the real top-level `body` column of a LogRecord `event_log` row.
 *
 * The write into `event_log` follows the canonical in-repo idiom from
 * eventLogDurability.integration.test.ts — `client.insert({ table: "event_log",
 * values: [...], format: "JSONEachRow" })` with `EventPayload: JSON.stringify(
 * event.data)`. The CH JSONEachRow inserter stores that into the `EventPayload
 * String` column byte-identically to the production repository write
 * (eventRepositoryClickHouse.ts:296), so the read path sees the exact same row.
 *
 * Deterministic payloads: a 200 KB marker string whose FINAL bytes only exist
 * past the 64 KB preview boundary (UNIQUE_TAIL). A preview-only result fails the
 * tail assertion, so the test cannot pass on a truncated read.
 *
 * BDD structure: `describe("given …")` → `describe("when …")` → `it("…")`.
 * No "should" in it() names (project convention).
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import {
  EVENTREF_ATTR_PREFIX,
  IO_PREVIEW_BYTES,
  leanForProjection,
} from "~/server/app-layer/traces/lean-for-projection";
import { NullSpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { Event } from "~/server/event-sourcing";
import {
  getTestClickHouseClient,
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { generateTestTenantId } from "~/server/event-sourcing/__tests__/integration/testHelpers";
import {
  LOG_RECORD_RECEIVED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  resolveOffloadedTraces,
  type WarnLogger,
} from "~/server/traces/resolve-offloaded-traces";

// Gate identically to the canonical event_log integration test: skip when no
// real ClickHouse is reachable, run against the testcontainer otherwise.
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

const AGGREGATE_TYPE = "trace";

/**
 * A 200 KB deterministic payload whose final bytes only exist past the 64 KB
 * preview boundary. The preview is `value.slice(0, 64KB) + "…"`, so it can NEVER
 * contain UNIQUE_TAIL — a preview-only read fails the tail assertion.
 */
const UNIQUE_TAIL = "__OFFLOAD_FULL_VALUE_TAIL_MARKER__";
const LARGE_VALUE = "x".repeat(200_000) + UNIQUE_TAIL;

/** Sanity: the payload genuinely exceeds the offload threshold. */
function assertOverThreshold(value: string): void {
  expect(Buffer.byteLength(value, "utf-8")).toBeGreaterThan(IO_PREVIEW_BYTES);
}

/**
 * Inserts ONE full event_log row, exactly as the production write path stores
 * it (`EventPayload` IS `event.data`). Mirrors the
 * eventLogDurability.integration.test.ts idiom — JSONEachRow with a stringified
 * payload — and stamps `_retention_days: 0` (never-expire sentinel, test-only)
 * so a merge-cycle TTL can never evict the fixture mid-run.
 */
async function insertEventLogRow({
  client,
  tenantId,
  aggregateId,
  eventId,
  eventType,
  eventVersion,
  eventData,
}: {
  client: ClickHouseClient;
  tenantId: string;
  aggregateId: string;
  eventId: string;
  eventType: string;
  eventVersion: string;
  eventData: unknown;
}): Promise<void> {
  const ts = Date.now();
  await client.insert({
    table: "event_log",
    values: [
      {
        TenantId: tenantId,
        AggregateType: AGGREGATE_TYPE,
        AggregateId: aggregateId,
        EventId: eventId,
        EventType: eventType,
        EventVersion: eventVersion,
        EventTimestamp: ts,
        EventOccurredAt: ts,
        // Production stores event.data as the EventPayload; the CH client
        // serializes it to the `EventPayload String` column. We stringify here
        // to match the canonical event_log test idiom byte-for-byte.
        EventPayload: JSON.stringify(eventData),
        IdempotencyKey: eventId,
        _retention_days: 0,
      },
    ],
    format: "JSONEachRow",
    // Sync insert so the read-back in the same test sees the row immediately.
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Builds a SpanReceived domain Event whose `langwatch.input` carries `value`.
 * `event.id` is the EventId that `leanForProjection` embeds in the eventref and
 * that the read path JOINs on, so the SAME `eventId` must be used for the row.
 */
function makeSpanReceivedEvent({
  tenantId,
  traceId,
  spanId,
  eventId,
  inputValue,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  eventId: string;
  inputValue: string;
}): Event {
  const now = Date.now();
  return {
    id: eventId,
    aggregateId: traceId,
    aggregateType: AGGREGATE_TYPE,
    tenantId,
    createdAt: now,
    occurredAt: now,
    type: SPAN_RECEIVED_EVENT_TYPE,
    version: SPAN_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      span: {
        traceId,
        spanId,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: String(now * 1_000_000),
        endTimeUnixNano: String((now + 1000) * 1_000_000),
        attributes: [
          // langwatch.input MUST stay first: the offloaded IO field.
          { key: "langwatch.input", value: { stringValue: inputValue } },
          // Mixed-type siblings (#4888): real OTLP spans carry non-string
          // AnyValue attributes. These must NOT be IO keys and carry NO
          // eventref — they exist to prove the real CH round-trip would catch a
          // regression where a non-string sibling fails the whole-array parse.
          { key: "gen_ai.usage.input_tokens", value: { intValue: "100" } },
          { key: "gen_ai.request.temperature", value: { doubleValue: 0.7 } },
          { key: "langwatch.streaming", value: { boolValue: true } },
        ] as never,
        events: [],
        links: [],
        status: { code: 1, message: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: { attributes: [] },
      instrumentationScope: { name: "test" },
    },
  } as unknown as Event;
}

/**
 * Builds a LogRecordReceived domain Event whose top-level `body` carries
 * `value`. `leanForProjection` leans the body and tags an eventref with
 * `field: "body"`, resolved by the `field === "body"` branch in getFromEventLog.
 */
function makeLogRecordReceivedEvent({
  tenantId,
  traceId,
  eventId,
  bodyValue,
}: {
  tenantId: string;
  traceId: string;
  eventId: string;
  bodyValue: string;
}): Event {
  const now = Date.now();
  return {
    id: eventId,
    aggregateId: traceId,
    aggregateType: AGGREGATE_TYPE,
    tenantId,
    createdAt: now,
    occurredAt: now,
    type: LOG_RECORD_RECEIVED_EVENT_TYPE,
    version: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
    data: {
      body: bodyValue,
      attributes: {},
    },
  } as unknown as Event;
}

/** Reads span attributes out of a leaned SpanReceived event into a string map. */
function extractSpanAttrs(event: Event): Record<string, string> {
  const data = event.data as {
    span?: {
      attributes?: Array<{ key: string; value: { stringValue?: string } }>;
    };
  };
  const attrs: Record<string, string> = {};
  for (const attr of data?.span?.attributes ?? []) {
    if (typeof attr.value.stringValue === "string") {
      attrs[attr.key] = attr.value.stringValue;
    }
  }
  return attrs;
}

/** Builds a NormalizedSpan carrying the supplied (leaned) attribute map. */
function makeNormalizedSpan({
  tenantId,
  traceId,
  spanId,
  spanAttributes,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  spanAttributes: Record<string, string>;
}): NormalizedSpan {
  return {
    id: spanId,
    traceId,
    spanId,
    tenantId,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes,
    events: [],
    links: [],
    statusMessage: null,
    statusCode: NormalizedStatusCode.OK,
    instrumentationScope: { name: "test", version: null },
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
  };
}

/**
 * Thin SpanStorageRepository that returns the staged (leaned) NormalizedSpan
 * for `getNormalizedSpansByTraceId` — the single method `SpanStorageService`'s
 * v2 read path calls before resolving eventrefs. Every other method inherits
 * the Null repository, so the only stubbed behaviour is the staging the test
 * controls; resolution still goes through the REAL BlobStore against real CH.
 */
class StagedSpanRepository extends NullSpanStorageRepository {
  constructor(private readonly staged: NormalizedSpan[]) {
    super();
  }
  override async getNormalizedSpansByTraceId(): Promise<NormalizedSpan[]> {
    return this.staged;
  }
}

/**
 * Builds the REAL BlobStore wired to the testcontainer ClickHouse client. The
 * S3 resolver is never invoked on the read path (only getFromEventLog is), so a
 * never-called stub satisfies the constructor; the ClickHouse resolver returns
 * the real testcontainer client for any tenant.
 */
function makeRealBlobStore(client: ClickHouseClient): BlobStore {
  const s3Resolver = async () => {
    throw new Error(
      "S3 resolver must not be called on the event_log read path in this test",
    );
  };
  return new BlobStore(
    s3Resolver as unknown as ConstructorParameters<typeof BlobStore>[0],
    async (_tenantId: string) => client,
  );
}

describe.skipIf(!hasTestcontainers)(
  "large-trace blob offload READ path (ADR-022) against real ClickHouse event_log",
  () => {
    let client: ClickHouseClient;
    const ownedTenantIds: string[] = [];

    beforeAll(async () => {
      await startTestContainers();
      client = getTestClickHouseClient()!;
      if (!client) {
        throw new Error(
          "ClickHouse client not available; testcontainers required.",
        );
      }
    });

    afterAll(async () => {
      if (client && ownedTenantIds.length > 0) {
        await client.exec({
          query: `ALTER TABLE event_log DELETE WHERE TenantId IN ({ids:Array(String)})`,
          query_params: { ids: ownedTenantIds },
        });
      }
      await stopTestContainers();
    });

    // -----------------------------------------------------------------------
    // Case 1 — span IO attribute (langwatch.input) round-trip through the v2
    // read entry point (SpanStorageService.getSpansByTraceId) + real BlobStore.
    // -----------------------------------------------------------------------
    describe("given a SpanReceived event whose langwatch.input exceeds 64 KB is stored full in event_log and leaned for projection", () => {
      it("the v2 read path (SpanStorageService.getSpansByTraceId, real BlobStore) returns the FULL input from event_log, not the 64 KB preview", async () => {
        assertOverThreshold(LARGE_VALUE);

        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-io`;
        const spanId = `span-${tenantId}-io`;
        const eventId = `${tenantId}-evt-io`;

        // 1) The FULL event — what the command worker writes to event_log.
        const fullEvent = makeSpanReceivedEvent({
          tenantId,
          traceId,
          spanId,
          eventId,
          inputValue: LARGE_VALUE,
        });
        await insertEventLogRow({
          client,
          tenantId,
          aggregateId: traceId,
          eventId,
          eventType: SPAN_RECEIVED_EVENT_TYPE,
          eventVersion: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          eventData: fullEvent.data,
        });

        // 2) The LEANED projection of that SAME event (preview + eventref) — what
        // the read path sees as the staged span.
        const leanEvent = leanForProjection(fullEvent);
        const leanAttrs = extractSpanAttrs(leanEvent);

        // Guard the staging: preview is truncated and the eventref is present.
        expect(leanAttrs["langwatch.input"]).not.toContain(UNIQUE_TAIL);
        expect(
          leanAttrs[`${EVENTREF_ATTR_PREFIX}langwatch.input`],
        ).toBeDefined();

        const leanedSpan = makeNormalizedSpan({
          tenantId,
          traceId,
          spanId,
          spanAttributes: leanAttrs,
        });

        // 3) Drive the REAL v2 read entry point with the REAL BlobStore.
        const service = new SpanStorageService(
          new StagedSpanRepository([leanedSpan]),
          {
            blobStore: makeRealBlobStore(client),
            ioExtractionService: new TraceIOExtractionService(),
          },
        );

        const spans = await service.getSpansByTraceId({ tenantId, traceId });

        // The mapper keeps a non-JSON langwatch.input string as { type: "text" }.
        expect(spans).toHaveLength(1);
        const input = spans[0]!.input as { type: string; value: string };
        expect(input.value).toBe(LARGE_VALUE);
        expect(input.value).toContain(UNIQUE_TAIL);
        expect(input.value.length).toBe(LARGE_VALUE.length);
      });

      it("resolveOffloadedTraces (real BlobStore) restores the full value into spanAttributes and strips the reserved eventref key", async () => {
        assertOverThreshold(LARGE_VALUE);

        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-io2`;
        const spanId = `span-${tenantId}-io2`;
        const eventId = `${tenantId}-evt-io2`;

        const fullEvent = makeSpanReceivedEvent({
          tenantId,
          traceId,
          spanId,
          eventId,
          inputValue: LARGE_VALUE,
        });
        await insertEventLogRow({
          client,
          tenantId,
          aggregateId: traceId,
          eventId,
          eventType: SPAN_RECEIVED_EVENT_TYPE,
          eventVersion: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          eventData: fullEvent.data,
        });

        const leanAttrs = extractSpanAttrs(leanForProjection(fullEvent));
        const leanedSpan = makeNormalizedSpan({
          tenantId,
          traceId,
          spanId,
          spanAttributes: leanAttrs,
        });

        const logger: WarnLogger = {
          warn: () => undefined,
          error: () => undefined,
        };
        const result = await resolveOffloadedTraces({
          projectId: tenantId,
          normalizedSpans: [leanedSpan],
          blobStore: makeRealBlobStore(client),
          ioExtractionService: new TraceIOExtractionService(),
          logger,
        });

        // Full value restored byte-identically from real CH.
        const resolvedAttrs = result.resolvedSpans[0]!.spanAttributes as Record<
          string,
          string
        >;
        expect(resolvedAttrs["langwatch.input"]).toBe(LARGE_VALUE);
        expect(resolvedAttrs["langwatch.input"]).toContain(UNIQUE_TAIL);

        // Reserved eventref namespace never leaks to the UI.
        const hasRef = Object.keys(resolvedAttrs).some((k) =>
          k.startsWith(EVENTREF_ATTR_PREFIX),
        );
        expect(hasRef).toBe(false);
        expect(result.anyResolved).toBe(true);
      });
    });

    // -----------------------------------------------------------------------
    // Case 2 — log-record `body` round-trip (round-2 fix, GtVrA): exercises the
    // `field === "body"` branch in getFromEventLog against real CH.
    // -----------------------------------------------------------------------
    describe("given a LogRecordReceived event whose body exceeds 64 KB is stored full in event_log and leaned for projection", () => {
      it("resolveOffloadedTraces (real BlobStore) restores the FULL body via the field=='body' branch, not the preview", async () => {
        assertOverThreshold(LARGE_VALUE);

        const tenantId = generateTestTenantId();
        ownedTenantIds.push(tenantId);
        const traceId = `trace-${tenantId}-body`;
        const spanId = `span-${tenantId}-body`;
        const eventId = `${tenantId}-evt-body`;

        // 1) FULL log-record event — body lives at the TOP LEVEL of EventPayload.
        const fullEvent = makeLogRecordReceivedEvent({
          tenantId,
          traceId,
          eventId,
          bodyValue: LARGE_VALUE,
        });
        await insertEventLogRow({
          client,
          tenantId,
          aggregateId: traceId,
          eventId,
          eventType: LOG_RECORD_RECEIVED_EVENT_TYPE,
          eventVersion: LOG_RECORD_RECEIVED_EVENT_VERSION_LATEST,
          eventData: fullEvent.data,
        });

        // 2) Lean it: body → preview, attributes gain eventref.body = {field:"body", eventId}.
        const leanEvent = leanForProjection(fullEvent);
        const leanData = leanEvent.data as {
          body: string;
          attributes: Record<string, string>;
        };
        const bodyEventrefKey = `${EVENTREF_ATTR_PREFIX}body`;

        // Guard the staging: preview truncated, body eventref present and well-formed.
        expect(leanData.body).not.toContain(UNIQUE_TAIL);
        const bodyRefRaw = leanData.attributes[bodyEventrefKey];
        expect(bodyRefRaw).toBeDefined();
        const bodyRef = JSON.parse(bodyRefRaw!) as {
          field: string;
          eventId: string;
        };
        expect(bodyRef.field).toBe("body");
        expect(bodyRef.eventId).toBe(eventId);

        // 3) The read orchestrator is span-based, so carry the body eventref on a
        // span's spanAttributes (this is the shape resolveOffloadedTraces acts on).
        const spanWithBodyRef = makeNormalizedSpan({
          tenantId,
          traceId,
          spanId,
          spanAttributes: { [bodyEventrefKey]: bodyRefRaw! },
        });

        const logger: WarnLogger = {
          warn: () => undefined,
          error: () => undefined,
        };
        const result = await resolveOffloadedTraces({
          projectId: tenantId,
          normalizedSpans: [spanWithBodyRef],
          blobStore: makeRealBlobStore(client),
          ioExtractionService: new TraceIOExtractionService(),
          logger,
        });

        // The full body comes back from CH via the field==="body" branch, keyed
        // under the resolved attribute name "body".
        const resolvedAttrs = result.resolvedSpans[0]!.spanAttributes as Record<
          string,
          string
        >;
        expect(resolvedAttrs.body).toBe(LARGE_VALUE);
        expect(resolvedAttrs.body).toContain(UNIQUE_TAIL);
        expect(resolvedAttrs.body!.length).toBe(LARGE_VALUE.length);

        // eventref stripped; resolution succeeded.
        const hasRef = Object.keys(resolvedAttrs).some((k) =>
          k.startsWith(EVENTREF_ATTR_PREFIX),
        );
        expect(hasRef).toBe(false);
        expect(result.anyResolved).toBe(true);
      });
    });
  },
);
