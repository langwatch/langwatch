/**
 * ENDPOINT-LEVEL read-path integration test for the large-trace blob offload
 * pipeline (#4888 / ADR-022) against a REAL ClickHouse testcontainer.
 *
 * Why this file exists alongside large-trace-blob-offload-readpath.integration.test.ts:
 * the sibling drives the resolver/service layer with a FAKE repository — it cannot
 * catch the #4888 ENDPOINT-CONSTRUCTION gap where TraceService is built WITHOUT
 * buildTraceBlobResolutionDeps() (resolver never wired) or getById is called
 * without { full: true } (resolve gate stays closed). This test closes that gap by
 * seeding real ClickHouse rows and driving the EXACT construction the endpoints use.
 *
 * Two construction paths under test:
 *   - no-deps:    TraceService.create(prisma)                   => preview only (bug)
 *   - with-deps:  TraceService.create(prisma, buildTraceBlobResolutionDeps())
 *                 + getById(..., { full: true })                 => full value (fix)
 *
 * Deterministic payload: 200 KB whose UNIQUE_TAIL only exists past the 64 KB
 * preview boundary — a preview-only read can NEVER contain it.
 *
 * BDD structure: describe("given …") > describe("when …") > it("…"). No "should".
 */

import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import {
  AGGREGATE_TYPE,
  assertOverThreshold,
  extractSpanAttrs,
  insertEventLogRow,
  LARGE_VALUE,
  UNIQUE_TAIL,
} from "~/server/app-layer/traces/__tests__/blob-offload-test-helpers";
import {
  EVENTREF_ATTR_PREFIX,
  IO_PREVIEW_BYTES,
  leanForProjection,
} from "~/server/app-layer/traces/lean-for-projection";
import * as clickhouseClientModule from "~/server/clickhouse/clickhouseClient";
import { prisma } from "~/server/db";
import type { Event } from "~/server/event-sourcing";
import {
  startTestContainers,
  stopTestContainers,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { generateTestTenantId } from "~/server/event-sourcing/__tests__/integration/testHelpers";
import {
  SPAN_RECEIVED_EVENT_TYPE,
  SPAN_RECEIVED_EVENT_VERSION_LATEST,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import type { Span, Trace } from "~/server/tracer/types";
import { openProtections } from "~/server/traces/__tests__/open-protections";
import { TraceService } from "~/server/traces/trace.service";
import { buildTraceBlobResolutionDeps } from "~/server/traces/trace-blob-resolution.deps";

// Gate identically to the canonical event_log integration tests: skip unless a
// real ClickHouse is reachable, run against the testcontainer otherwise.
const hasTestcontainers = !!(
  process.env.TEST_CLICKHOUSE_URL || process.env.CI_CLICKHOUSE_URL
);

// Mock the ClickHouse routing module so BOTH the read path
// (ClickHouseTraceService.resolveClient -> getClickHouseClientForProject) AND the
// blob resolver (buildTraceBlobResolutionDeps -> defaultResolveClickHouseClient ->
// getClickHouseClientForProject, wired only when isClickHouseEnabled()) resolve to
// the testcontainer client. importOriginal keeps every other export intact.
vi.mock("~/server/clickhouse/clickhouseClient", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("~/server/clickhouse/clickhouseClient")
  >()),
  getClickHouseClientForProject: vi.fn(),
  // Must be true so buildTraceBlobResolutionDeps wires the CH resolver onto the
  // BlobStore — otherwise getFromEventLog throws and every read degrades to the
  // preview, which would mask the very fix this test proves.
  isClickHouseEnabled: () => true,
}));

/** The IO fields the matrix covers; each is leaned + offloaded independently. */
const IO_FIELDS = ["langwatch.input", "langwatch.output"] as const;
type IoField = (typeof IO_FIELDS)[number];

/**
 * Builds a SpanReceived domain Event whose IO field (`langwatch.input` or
 * `langwatch.output`) carries `value`. `event.id` is the EventId that
 * `leanForProjection` embeds in the eventref and that the read path JOINs on, so
 * the SAME `eventId` must be used for the event_log row.
 *
 * Mixed-type sibling attributes (intValue / doubleValue / boolValue) are included
 * deliberately: real OTLP spans carry non-string AnyValue attributes, and a
 * regression where a single non-string sibling fails the whole-array parse would
 * degrade the > 64 KB read to the preview (#4888) — the real CH round-trip here
 * would catch that.
 */
function makeSpanReceivedEvent({
  tenantId,
  traceId,
  spanId,
  eventId,
  ioField,
  ioValue,
}: {
  tenantId: string;
  traceId: string;
  spanId: string;
  eventId: string;
  ioField: IoField;
  ioValue: string;
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
          // The offloaded IO field MUST stay first.
          { key: ioField, value: { stringValue: ioValue } },
          // Mixed-type siblings — NOT IO keys, carry NO eventref.
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
 * Inserts ONE stored_spans row carrying the supplied (leaned) attribute map. A
 * single version, StartTime ≈ OccurredAt, so the read path's span dedup
 * (TenantId,TraceId,SpanId,max(StartTime)) and the ±2-day StartTime partition
 * bound (clickhouse-trace.service.ts:2419-2476) both select it.
 */
async function insertStoredSpan({
  client,
  tenantId,
  traceId,
  spanId,
  startTimeMs,
  spanAttributes,
}: {
  client: ClickHouseClient;
  tenantId: string;
  traceId: string;
  spanId: string;
  startTimeMs: number;
  spanAttributes: Record<string, string>;
}): Promise<void> {
  await client.insert({
    table: "stored_spans",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        SpanId: spanId,
        ParentSpanId: null,
        ParentTraceId: null,
        ParentIsRemote: null,
        Sampled: 1,
        StartTime: new Date(startTimeMs),
        EndTime: new Date(startTimeMs + 100),
        DurationMs: 100,
        SpanName: "test-span",
        SpanKind: 1,
        ServiceName: "test-service",
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
        CreatedAt: new Date(startTimeMs),
        UpdatedAt: new Date(startTimeMs),
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Inserts ONE trace_summaries row whose ComputedInput/ComputedOutput carry the
 * preview JSON (`{type:"text", value:<preview>}`) — the value `trace.input` /
 * `trace.output` reads WITHOUT resolution. Single version, OccurredAt = now so
 * the summary dedup + the spans-scan window bound both select it.
 */
async function insertTraceSummary({
  client,
  tenantId,
  traceId,
  occurredAtMs,
  computedInput,
  computedOutput,
}: {
  client: ClickHouseClient;
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
  computedInput: string | null;
  computedOutput: string | null;
}): Promise<void> {
  await client.insert({
    table: "trace_summaries",
    values: [
      {
        ProjectionId: `proj-${nanoid()}`,
        TenantId: tenantId,
        TraceId: traceId,
        Version: "v1",
        Attributes: {},
        OccurredAt: new Date(occurredAtMs),
        CreatedAt: new Date(occurredAtMs),
        UpdatedAt: new Date(occurredAtMs),
        ComputedIOSchemaVersion: "v1",
        ComputedInput: computedInput,
        ComputedOutput: computedOutput,
        TimeToFirstTokenMs: null,
        TimeToLastTokenMs: null,
        TotalDurationMs: 100,
        TokensPerSecond: null,
        SpanCount: 1,
        ContainsErrorStatus: false,
        ContainsOKStatus: true,
        ErrorMessage: null,
        Models: [],
        TotalCost: null,
        TokensEstimated: false,
        TotalPromptTokenCount: null,
        TotalCompletionTokenCount: null,
        OutputFromRootSpan: false,
        OutputSpanEndTimeMs: 0,
        BlockedByGuardrail: false,
        SatisfactionScore: null,
        TopicId: null,
        SubTopicId: null,
        HasAnnotation: null,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * The legacy `Span` from `mapNormalizedSpanToSpan` exposes the offloaded IO value
 * at `span.input` (for langwatch.input) / `span.output` (for langwatch.output),
 * each as `{ type, value }` (a non-JSON preview string maps to
 * `{ type: "text", value }`). Returns the string value for whichever field the
 * matrix is exercising.
 */
function spanIoValue(span: Span, ioField: IoField): string {
  const io = (ioField === "langwatch.input" ? span.input : span.output) as
    | { type: string; value: unknown }
    | null
    | undefined;
  expect(io).toBeTruthy();
  if (!io)
    throw new Error(
      `span.${ioField === "langwatch.input" ? "input" : "output"} is null/undefined`,
    );
  expect(typeof io.value).toBe("string");
  return io.value as string;
}

/**
 * The reserved eventref namespace key contains dots
 * (`langwatch.reserved.eventref.langwatch.input`), so `unflattenDotNotation`
 * nests it under `params.langwatch.reserved.eventref.*` when it is NOT resolved.
 * After resolution the eventref keys are stripped, so this whole branch is gone.
 * Returns true when the reserved eventref namespace is still present on the
 * mapped Span (proving it was never resolved).
 */
function spanCarriesEventref(span: Span): boolean {
  const params = (span.params ?? {}) as Record<string, unknown>;
  const reserved = (params.langwatch as Record<string, unknown> | undefined)
    ?.reserved as Record<string, unknown> | undefined;
  const eventref = reserved?.eventref;
  return eventref !== undefined && eventref !== null;
}

/** Trace-level IO value (`{ value: string }`) for whichever field is exercised. */
function traceIoValue(trace: Trace, ioField: IoField): string | undefined {
  const io = ioField === "langwatch.input" ? trace.input : trace.output;
  return io?.value;
}

describe.skipIf(!hasTestcontainers)(
  "trace-detail blob recall through the endpoint-level TraceService construction (#4888 / ADR-022)",
  () => {
    let client: ClickHouseClient;
    const ownedTenantIds: string[] = [];

    beforeAll(async () => {
      const containers = await startTestContainers();
      client = containers.clickHouseClient;
      if (!client) {
        throw new Error(
          "ClickHouse client not available; testcontainers required.",
        );
      }

      // Wire the mocked routing module to the testcontainer client, so both the
      // read path and the blob resolver dial the real `ch`.
      vi.mocked(
        clickhouseClientModule.getClickHouseClientForProject,
      ).mockResolvedValue(client);
    }, 60_000);

    afterAll(async () => {
      if (client && ownedTenantIds.length > 0) {
        for (const table of ["event_log", "trace_summaries", "stored_spans"]) {
          await client.exec({
            query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({ids:Array(String)})`,
            query_params: { ids: ownedTenantIds },
          });
        }
      }
      await stopTestContainers();
    });

    /**
     * Seeds the full offload fixture for one IO field on a fresh tenant/trace:
     *   - the FULL event in event_log (the command-worker write),
     *   - the LEANED projection (preview + eventref) in stored_spans,
     *   - the preview-based ComputedInput/ComputedOutput in trace_summaries.
     *
     * Returns the ids + the staged lean preview so callers can assert against it.
     * `shouldSeedEventLog: false` skips the event_log insert to model AC5 (resolution
     * failure: the ref points at a row that does not exist).
     */
    async function seedOffloadedTrace({
      ioField,
      shouldSeedEventLog = true,
    }: {
      ioField: IoField;
      shouldSeedEventLog?: boolean;
    }): Promise<{
      tenantId: string;
      traceId: string;
      spanId: string;
      eventId: string;
      preview: string;
      now: number;
    }> {
      assertOverThreshold(LARGE_VALUE);

      const tenantId = generateTestTenantId();
      ownedTenantIds.push(tenantId);
      const slug = ioField === "langwatch.input" ? "in" : "out";
      const traceId = `trace-${tenantId}-${slug}`;
      const spanId = `span-${tenantId}-${slug}`;
      const eventId = `${tenantId}-evt-${slug}`;
      const now = Date.now();

      // 1) The FULL event — what the command worker writes to event_log.
      const fullEvent = makeSpanReceivedEvent({
        tenantId,
        traceId,
        spanId,
        eventId,
        ioField,
        ioValue: LARGE_VALUE,
      });
      if (shouldSeedEventLog) {
        await insertEventLogRow({
          client,
          tenantId,
          aggregateId: traceId,
          eventId,
          eventType: SPAN_RECEIVED_EVENT_TYPE,
          eventVersion: SPAN_RECEIVED_EVENT_VERSION_LATEST,
          eventData: fullEvent.data,
        });
      }

      // 2) The LEANED projection of that SAME event (preview + eventref) — what
      // the projection fold wrote to stored_spans.
      const leanAttrs = extractSpanAttrs(leanForProjection(fullEvent));
      const preview = leanAttrs[ioField];

      // Staging guard: preview is truncated and the eventref key IS present.
      expect(preview).toBeDefined();
      if (!preview)
        throw new Error(
          `leanAttrs missing "${ioField}" after leanForProjection`,
        );
      expect(preview).not.toContain(UNIQUE_TAIL);
      expect(leanAttrs[`${EVENTREF_ATTR_PREFIX}${ioField}`]).toBeDefined();

      await insertStoredSpan({
        client,
        tenantId,
        traceId,
        spanId,
        startTimeMs: now,
        spanAttributes: leanAttrs,
      });

      // 3) The preview-based trace summary — what trace.input/output reads
      // WITHOUT resolution. Preview lands in the field being exercised.
      const previewWrapper = JSON.stringify({ type: "text", value: preview });
      await insertTraceSummary({
        client,
        tenantId,
        traceId,
        occurredAtMs: now,
        computedInput: ioField === "langwatch.input" ? previewWrapper : null,
        computedOutput: ioField === "langwatch.output" ? previewWrapper : null,
      });

      return { tenantId, traceId, spanId, eventId, preview, now };
    }

    describe("given an over-threshold offloaded IO field stored full in event_log and leaned into stored_spans", () => {
      describe("when read via TraceService constructed WITHOUT blob-resolution deps (the legacy/no-deps endpoint construction)", () => {
        for (const ioField of IO_FIELDS) {
          it(`returns the 64 KB preview for ${ioField}, not the full value (reproduces the #4888 read-path gap)`, async () => {
            const { tenantId, traceId, preview } = await seedOffloadedTrace({
              ioField,
            });

            // Real TraceService, NO blob-resolution deps (top-level imports, not mocked).
            const service = TraceService.create(prisma);

            // Even full:true cannot resolve without deps: the resolve gate needs
            // `this.resolveTraceSpans`, which is undefined for a no-deps service.
            const trace = await service.getById(
              tenantId,
              traceId,
              openProtections,
              { full: true },
            );

            expect(trace).toBeDefined();
            if (!trace) throw new Error("trace is null/undefined");
            expect(trace.spans).toHaveLength(1);
            const span = trace.spans[0];
            if (!span) throw new Error("trace.spans[0] is undefined");

            // BUG: the span IO value is the truncated preview, never the full value.
            const value = spanIoValue(span, ioField);
            expect(value).not.toContain(UNIQUE_TAIL);
            expect(value).toBe(preview);
            // Preview is ≤ 64 KB + the 1-codepoint ellipsis ("…" = 3 UTF-8 bytes).
            expect(Buffer.byteLength(value, "utf-8")).toBeLessThanOrEqual(
              IO_PREVIEW_BYTES + 4,
            );

            // BUG: the reserved eventref is STILL on the span — never resolved.
            expect(spanCarriesEventref(span)).toBe(true);

            // BUG (trace-level): trace.input/output is the preview, no full value.
            const traceValue = traceIoValue(trace, ioField);
            expect(traceValue).not.toContain(UNIQUE_TAIL);
          });
        }
      });

      describe("when read via TraceService constructed WITH buildTraceBlobResolutionDeps() and full:true (mirrors app.v1.ts:368 + tRPC getById)", () => {
        for (const ioField of IO_FIELDS) {
          it(`returns the FULL ${ioField} value byte-identically from event_log (AC1)`, async () => {
            const { tenantId, traceId } = await seedOffloadedTrace({ ioField });

            const service = TraceService.create(
              prisma,
              buildTraceBlobResolutionDeps(),
            );

            const trace = await service.getById(
              tenantId,
              traceId,
              openProtections,
              { full: true },
            );

            expect(trace).toBeDefined();
            if (!trace) throw new Error("trace is null/undefined");
            expect(trace.spans).toHaveLength(1);
            const span = trace.spans[0];
            if (!span) throw new Error("trace.spans[0] is undefined");

            // FIX: the full value comes back from event_log, byte-identical.
            const value = spanIoValue(span, ioField);
            expect(value).toBe(LARGE_VALUE);
            expect(value).toContain(UNIQUE_TAIL);
            expect(value.length).toBe(LARGE_VALUE.length);
            expect(Buffer.byteLength(value, "utf-8")).toBe(
              Buffer.byteLength(LARGE_VALUE, "utf-8"),
            );
          });

          it(`strips the reserved eventref namespace from the returned ${ioField} span attributes (AC3)`, async () => {
            const { tenantId, traceId } = await seedOffloadedTrace({ ioField });

            const service = TraceService.create(
              prisma,
              buildTraceBlobResolutionDeps(),
            );

            const trace = await service.getById(
              tenantId,
              traceId,
              openProtections,
              { full: true },
            );

            expect(trace).toBeDefined();
            if (!trace) throw new Error("trace is null/undefined");
            const span = trace.spans[0];
            if (!span) throw new Error("trace.spans[0] is undefined");
            // FIX: no reserved eventref namespace leaks to the returned Span.
            expect(spanCarriesEventref(span)).toBe(false);
            const params = (span.params ?? {}) as Record<string, unknown>;
            const reserved = (
              params.langwatch as Record<string, unknown> | undefined
            )?.reserved as Record<string, unknown> | undefined;
            expect(reserved?.eventref).toBeUndefined();
          });

          it(`patches trace.${
            ioField === "langwatch.input" ? "input" : "output"
          } with the full resolved content (AC1 trace-level)`, async () => {
            const { tenantId, traceId, preview } = await seedOffloadedTrace({
              ioField,
            });

            const service = TraceService.create(
              prisma,
              buildTraceBlobResolutionDeps(),
            );

            const trace = await service.getById(
              tenantId,
              traceId,
              openProtections,
              { full: true },
            );

            expect(trace).toBeDefined();
            if (!trace) throw new Error("trace is null/undefined");
            // FIX (trace-level): the preview from trace_summaries is overwritten
            // with the recomputed full value.
            const traceValue = traceIoValue(trace, ioField);
            expect(traceValue).toBeDefined();
            expect(traceValue).toContain(UNIQUE_TAIL);
            expect(traceValue).not.toBe(preview);
            if (traceValue === undefined)
              throw new Error("traceValue is undefined");
            expect(traceValue.length).toBeGreaterThan(IO_PREVIEW_BYTES);
          });
        }
      });

      describe("when read with full:true and deps but the event_log row is absent (resolution failure, AC5)", () => {
        for (const ioField of IO_FIELDS) {
          it(`degrades to the ${ioField} preview, still strips the reserved key, and does not throw`, async () => {
            // Seed stored_spans + trace_summaries with the eventref, but NO
            // event_log row — getFromEventLog finds nothing (BlobNotFoundError).
            const { tenantId, traceId, preview } = await seedOffloadedTrace({
              ioField,
              shouldSeedEventLog: false,
            });

            const service = TraceService.create(
              prisma,
              buildTraceBlobResolutionDeps(),
            );

            // AC5: the missing row must NOT break the read.
            const trace = await service.getById(
              tenantId,
              traceId,
              openProtections,
              { full: true },
            );

            expect(trace).toBeDefined();
            if (!trace) throw new Error("trace is null/undefined");
            expect(trace.spans).toHaveLength(1);
            const span = trace.spans[0];
            if (!span) throw new Error("trace.spans[0] is undefined");

            // Degrades to the preview (no full value recoverable).
            const value = spanIoValue(span, ioField);
            expect(value).not.toContain(UNIQUE_TAIL);
            expect(value).toBe(preview);

            // Reserved eventref is stripped even on failure — never leaks to UI.
            expect(spanCarriesEventref(span)).toBe(false);
          });
        }
      });
    });
  },
);
