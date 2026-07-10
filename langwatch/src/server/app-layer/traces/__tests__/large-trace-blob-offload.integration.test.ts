/**
 * Integration test for the large-trace blob offload pipeline (#4215 / ADR-022).
 *
 * Environment choice: in-process stubs only (no testcontainers, no real S3).
 *
 * Rationale: the goal of this test is pipeline WIRING, not S3 fidelity or
 * ClickHouse SQL correctness — those are separately covered by unit tests
 * (blob-store.service.unit.test.ts, resolve-offloaded-traces.unit.test.ts).
 * The full pipeline wiring is exercised by:
 *   - Simulating the dispatch interposition: calling `leanForProjection` on a
 *     synthetic SpanReceived event whose IO attr exceeds IO_PREVIEW_BYTES.
 *   - Verifying the lean event carries the eventref pointer and the preview.
 *   - Feeding the lean span attributes directly into `resolveOffloadedTraces`
 *     backed by a fake BlobStore.getFromEventLog, which returns the full value.
 *   - Asserting TraceIOExtractionService recomputes trace.output correctly.
 *
 * This approach exercises every production module in the pipeline without
 * requiring infrastructure, and the assertions are identical to what the real
 * read path delivers.
 *
 * BDD structure: `describe("given …")` → `describe("when …")` → `it("…")`.
 * No "should" in it() names (project convention).
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { maybeSpool } from "~/server/app-layer/traces/edge-spool";
import {
  COMMAND_INLINE_THRESHOLD,
  EVENTREF_ATTR_PREFIX,
  IO_PREVIEW_BYTES,
  leanForProjection,
} from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { Event } from "~/server/event-sourcing";
import type { RecordSpanCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { SPAN_RECEIVED_EVENT_TYPE } from "~/server/event-sourcing/pipelines/trace-processing/schemas/constants";
import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import {
  resolveOffloadedTraces,
  type WarnLogger,
} from "~/server/traces/resolve-offloaded-traces";

// ---------------------------------------------------------------------------
// Mock langwatch tracer (passthrough in tests)
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

// Suppress logger noise
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

// ---------------------------------------------------------------------------
// Constants and helpers
// ---------------------------------------------------------------------------

const PROJECT_ID = "test-project-offload";
const TRACE_ID = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaabb";
const SPAN_ID = "bbbbbbbbbbbbbbbb";

/** 1 MB string — well over the 64 KB IO_PREVIEW_BYTES threshold. */
const ONE_MB_OUTPUT = "x".repeat(1024 * 1024);

/**
 * Builds a fake BlobStore whose getFromEventLog returns values from an in-memory map.
 * Simulates the event_log read path without a real ClickHouse instance.
 */
function makeEventLogBlobStore(contents: Record<string, string>): {
  blobStore: BlobStore;
  getFromEventLogSpy: ReturnType<typeof vi.fn>;
} {
  const getFromEventLogSpy = vi.fn(
    async ({
      field,
    }: {
      eventId: string;
      field: string;
      tenantId: string;
      aggregateType: string;
      aggregateId: string;
    }) => {
      if (field in contents) return contents[field]!;
      throw new BlobNotFoundError("evt-test", field, PROJECT_ID);
    },
  );

  const blobStore = {
    getFromEventLog: getFromEventLogSpy,
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;

  return { blobStore, getFromEventLogSpy };
}

/**
 * Builds a fake S3-backed BlobStore for spool operations.
 * Simulates the transient S3 spool path (maybeSpool test).
 */
function makeSpoolBlobStore(): {
  blobStore: BlobStore;
  putSpoolSpy: ReturnType<typeof vi.fn>;
  deleteSpoolSpy: ReturnType<typeof vi.fn>;
} {
  const spoolStorage = new Map<string, Buffer>();

  const putSpoolSpy = vi.fn(
    async ({
      projectId,
      traceId,
      spanId,
      body,
    }: {
      projectId: string;
      traceId: string;
      spanId: string;
      body: Buffer;
    }): Promise<string> => {
      const key = `trace-blobs/spool/${projectId}/${traceId}/${spanId}`;
      spoolStorage.set(key, body);
      return key;
    },
  );

  const deleteSpoolSpy = vi.fn(async (_spoolRef: string): Promise<void> => {
    // best-effort, swallow errors
  });

  const getSpoolSpy = vi.fn(async (spoolRef: string): Promise<Buffer> => {
    const val = spoolStorage.get(spoolRef);
    if (!val) {
      const err = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
      throw err;
    }
    return val;
  });

  const blobStore = {
    getFromEventLog: vi.fn(),
    putSpool: putSpoolSpy,
    getSpool: getSpoolSpy,
    deleteSpool: deleteSpoolSpy,
  } as unknown as BlobStore;

  return { blobStore, putSpoolSpy, deleteSpoolSpy };
}

/**
 * Builds a synthetic SpanReceived event whose langwatch.output is set to `output`.
 * This simulates the event written to event_log by the command worker.
 */
function makeSpanReceivedEvent({ output }: { output: string }): Event {
  return {
    type: SPAN_RECEIVED_EVENT_TYPE,
    id: "evt-1",
    tenantId: PROJECT_ID,
    aggregateId: TRACE_ID,
    aggregateType: "trace",
    occurredAt: Date.now(),
    data: {
      span: {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: String(Date.now() * 1_000_000),
        endTimeUnixNano: String((Date.now() + 1000) * 1_000_000),
        attributes: [
          { key: "langwatch.output", value: { stringValue: output } },
        ],
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
 * Extracts span attributes from a lean event (post-leanForProjection) into
 * the Record<string, string> format that NormalizedSpan.spanAttributes uses.
 */
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

/**
 * Builds a NormalizedSpan from a span attributes map, simulating what the
 * projection receives from the command worker after leanForProjection.
 */
function makeNormalizedSpan(
  spanAttributes: Record<string, string>,
): NormalizedSpan {
  return {
    id: SPAN_ID,
    traceId: TRACE_ID,
    spanId: SPAN_ID,
    tenantId: PROJECT_ID,
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

// ---------------------------------------------------------------------------
// Track 2 — event_log as SoT: leanForProjection + resolveOffloadedTraces pipeline
// ---------------------------------------------------------------------------

/**
 * @scenario event_log carries the full event content; projection queue carries the lean shape
 */
describe("given a span field value exceeds the offload threshold (IO_PREVIEW_BYTES)", () => {
  let leanEvent: Event;
  let leanAttrs: Record<string, string>;

  beforeEach(() => {
    const fullEvent = makeSpanReceivedEvent({ output: ONE_MB_OUTPUT });
    leanEvent = leanForProjection(fullEvent);
    leanAttrs = extractSpanAttrs(leanEvent);
  });

  describe("when leanForProjection is applied (simulating dispatch interposition)", () => {
    /** @scenario event_log carries the full event content; projection queue carries the lean shape */
    it("the lean event carries a preview within the IO_PREVIEW_BYTES budget for langwatch.output", () => {
      const previewValue = leanAttrs["langwatch.output"] ?? "";
      expect(Buffer.byteLength(previewValue, "utf-8")).toBeLessThanOrEqual(
        IO_PREVIEW_BYTES + 4, // +4 bytes for the ellipsis character "…" (3 bytes UTF-8)
      );
      expect(Buffer.byteLength(previewValue, "utf-8")).toBeLessThan(
        Buffer.byteLength(ONE_MB_OUTPUT, "utf-8"),
      );
    });

    it("the lean event carries a reserved eventref attribute for langwatch.output", () => {
      const eventrefKey = `${EVENTREF_ATTR_PREFIX}langwatch.output`;
      expect(leanAttrs[eventrefKey]).toBeDefined();
      const ref = JSON.parse(leanAttrs[eventrefKey]!) as { field: string };
      expect(ref.field).toBe("langwatch.output");
    });

    it("the lean event carries no full content (output value is truncated)", () => {
      const previewValue = leanAttrs["langwatch.output"] ?? "";
      expect(previewValue).not.toBe(ONE_MB_OUTPUT);
    });
  });

  describe("when the lean span is resolved via resolveOffloadedTraces backed by event_log", () => {
    let resolvedResult: Awaited<ReturnType<typeof resolveOffloadedTraces>>;
    let getFromEventLogSpy: ReturnType<typeof vi.fn>;
    let logger: WarnLogger;

    beforeEach(async () => {
      const { blobStore, getFromEventLogSpy: spy } = makeEventLogBlobStore({
        "langwatch.output": ONE_MB_OUTPUT,
      });
      getFromEventLogSpy = spy;
      logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);
      const ioExtractionService = new TraceIOExtractionService();

      resolvedResult = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService,
        logger,
      });
    });

    /** @scenario An online evaluator on an over-threshold trace receives the full output */
    it("the returned span's langwatch.output is the full value byte-identical to the original", () => {
      const resolvedAttrValue =
        resolvedResult.resolvedSpans[0]?.spanAttributes?.["langwatch.output"];
      expect(resolvedAttrValue).toBe(ONE_MB_OUTPUT);
    });

    it("the reserved eventref attribute is stripped from the returned span attributes", () => {
      const attrs = resolvedResult.resolvedSpans[0]?.spanAttributes ?? {};
      const hasRef = Object.keys(attrs).some((k) =>
        k.startsWith(EVENTREF_ATTR_PREFIX),
      );
      expect(hasRef).toBe(false);
    });

    /** @scenario Trace-detail collapsed uses preview; "show full" JOINs event_log */
    it("the recomputed trace.output (via TraceIOExtractionService) is the full value, not the preview", () => {
      expect(resolvedResult.recomputedOutput).not.toBeNull();
      expect(resolvedResult.recomputedOutput!.text).toBe(ONE_MB_OUTPUT);
    });

    it("anyResolved is true", () => {
      expect(resolvedResult.anyResolved).toBe(true);
    });

    it("BlobStore.getFromEventLog is called once for the langwatch.output field", () => {
      expect(getFromEventLogSpy).toHaveBeenCalledOnce();
      expect(getFromEventLogSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          field: "langwatch.output",
          tenantId: PROJECT_ID,
        }),
      );
    });
  });
});

// ---------------------------------------------------------------------------
// Track 2 — flag-off path: no lean, no resolution
// ---------------------------------------------------------------------------

/**
 * @scenario With the flag off, ingestion and reads behave exactly as before
 */
describe("given the span output is below IO_PREVIEW_BYTES (flag-off / sub-threshold)", () => {
  const SMALL_OUTPUT = "small output value";

  let leanEvent: Event;
  let leanAttrs: Record<string, string>;

  beforeEach(() => {
    const fullEvent = makeSpanReceivedEvent({ output: SMALL_OUTPUT });
    // leanForProjection is a no-op for sub-threshold values
    leanEvent = leanForProjection(fullEvent);
    leanAttrs = extractSpanAttrs(leanEvent);
  });

  describe("when leanForProjection is applied", () => {
    it("the event is returned unchanged (same object reference)", () => {
      // leanForProjection returns the exact same event object when nothing changes
      const fullEvent = makeSpanReceivedEvent({ output: SMALL_OUTPUT });
      const result = leanForProjection(fullEvent);
      expect(result).toBe(fullEvent);
    });

    it("no eventref attribute is present in the lean attrs", () => {
      const hasRef = Object.keys(leanAttrs).some((k) =>
        k.startsWith(EVENTREF_ATTR_PREFIX),
      );
      expect(hasRef).toBe(false);
    });
  });

  describe("when resolved via resolveOffloadedTraces", () => {
    /** @scenario With the flag off, ingestion and reads behave exactly as before */
    it("returns spans unchanged and calls getFromEventLog zero times", async () => {
      const { blobStore, getFromEventLogSpy } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);
      const ioExtractionService = new TraceIOExtractionService();

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService,
        logger,
      });

      // Span is returned as-is (same reference — fast path)
      expect(result.resolvedSpans[0]).toBe(normalizedSpan);

      // getFromEventLog is never called
      expect(getFromEventLogSpy).not.toHaveBeenCalled();

      // anyResolved is false
      expect(result.anyResolved).toBe(false);

      // Full value preserved
      expect(
        result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"],
      ).toBe(SMALL_OUTPUT);
    });
  });
});

// ---------------------------------------------------------------------------
// Track 2 — stale event_log row (BlobNotFoundError on read)
// ---------------------------------------------------------------------------

describe("given the span was offloaded but the event_log row is missing on read (stale ref)", () => {
  let leanAttrs: Record<string, string>;
  let previewValue: string;

  beforeEach(() => {
    const fullEvent = makeSpanReceivedEvent({ output: ONE_MB_OUTPUT });
    const leanEvent = leanForProjection(fullEvent);
    leanAttrs = extractSpanAttrs(leanEvent);
    previewValue = leanAttrs["langwatch.output"] ?? "";
  });

  describe("when getFromEventLog throws BlobNotFoundError", () => {
    it("does not throw to the caller", async () => {
      const { blobStore } = makeEventLogBlobStore({}); // empty — will throw BlobNotFoundError
      const logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);
      const ioExtractionService = new TraceIOExtractionService();

      await expect(
        resolveOffloadedTraces({
          projectId: PROJECT_ID,
          normalizedSpans: [normalizedSpan],
          blobStore,
          ioExtractionService,
          logger,
        }),
      ).resolves.not.toThrow();
    });

    it("returns the preview value (not the full value)", async () => {
      const { blobStore } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);
      const ioExtractionService = new TraceIOExtractionService();

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService,
        logger,
      });

      const returnedValue =
        result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"];
      expect(returnedValue).toBe(previewValue);
      // Preview is shorter than the original 1 MB value
      expect((returnedValue as string).length).toBeLessThan(
        ONE_MB_OUTPUT.length,
      );
    });

    it("logs at warn level (not error or silent)", async () => {
      const { blobStore } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);
      const ioExtractionService = new TraceIOExtractionService();

      await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("anyResolved is false (the span was not resolved)", async () => {
      const { blobStore } = makeEventLogBlobStore({});
      const logger = { warn: vi.fn(), error: vi.fn() };

      const normalizedSpan = makeNormalizedSpan(leanAttrs);
      const ioExtractionService = new TraceIOExtractionService();

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobStore,
        ioExtractionService,
        logger,
      });

      expect(result.anyResolved).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Track 2 — edge spool: maybeSpool for over-threshold commands (ADR-022)
// ---------------------------------------------------------------------------

/**
 * @scenario An over-threshold command is spooled to S3 transiently and reconstituted
 */
describe("given a span whose serialized command payload exceeds COMMAND_INLINE_THRESHOLD", () => {
  /**
   * Builds a RecordSpanCommandData that serializes to > COMMAND_INLINE_THRESHOLD bytes.
   * The simplest way is to embed a large output attribute inline.
   */
  function makeOversizedCommand(): RecordSpanCommandData {
    const LARGE_OUTPUT = "Z".repeat(COMMAND_INLINE_THRESHOLD + 1024);
    return {
      tenantId: PROJECT_ID,
      span: {
        traceId: TRACE_ID,
        spanId: SPAN_ID,
        name: "test-span",
        kind: 1,
        startTimeUnixNano: String(Date.now() * 1_000_000) as unknown as number,
        endTimeUnixNano: String(
          (Date.now() + 1000) * 1_000_000,
        ) as unknown as number,
        attributes: [
          { key: "langwatch.output", value: { stringValue: LARGE_OUTPUT } },
        ],
        events: [],
        links: [],
        status: { code: 1, message: null },
        droppedAttributesCount: 0,
        droppedEventsCount: 0,
        droppedLinksCount: 0,
      },
      resource: { attributes: [] },
      instrumentationScope: { name: "test" },
      piiRedactionLevel: "DISABLED",
      occurredAt: Date.now(),
    } as unknown as RecordSpanCommandData;
  }

  describe("when maybeSpool is called at the ingestion edge", () => {
    /** @scenario An over-threshold command is spooled to S3 transiently and reconstituted */
    it("returns a command with spoolRef set", async () => {
      const { blobStore, putSpoolSpy } = makeSpoolBlobStore();
      const logger = { warn: vi.fn() };
      const data = makeOversizedCommand();

      const result = await maybeSpool({ data, blobStore, logger });

      expect(result.spoolRef).toBeDefined();
      expect(result.spoolRef).toContain("trace-blobs/spool/");
      expect(putSpoolSpy).toHaveBeenCalledOnce();
    });

    it("returns a command with span attributes cleared (only id fields remain)", async () => {
      const { blobStore } = makeSpoolBlobStore();
      const logger = { warn: vi.fn() };
      const data = makeOversizedCommand();

      const result = await maybeSpool({ data, blobStore, logger });

      expect(result.span.attributes).toEqual([]);
    });

    it("calls BlobStore.putSpool with the correct projectId, traceId, spanId", async () => {
      const { blobStore, putSpoolSpy } = makeSpoolBlobStore();
      const logger = { warn: vi.fn() };
      const data = makeOversizedCommand();

      await maybeSpool({ data, blobStore, logger });

      const callArg = putSpoolSpy.mock.calls[0]![0];
      expect(callArg.projectId).toBe(PROJECT_ID);
      expect(callArg.traceId).toBe(TRACE_ID);
      expect(callArg.spanId).toBe(SPAN_ID);
    });
  });

  describe("when the S3 spool PUT fails", () => {
    it("fails open — returns the original command with full inline payload", async () => {
      const failingBlobStore: BlobStore = {
        getFromEventLog: vi.fn(),
        putSpool: vi.fn(async () => {
          throw new Error("S3 unavailable");
        }),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;

      const logger = { warn: vi.fn() };
      const data = makeOversizedCommand();

      const result = await maybeSpool({
        data,
        blobStore: failingBlobStore,
        logger,
      });

      // Returns original data (fail-open)
      expect(result).toBe(data);
      expect(result.spoolRef).toBeUndefined();
    });

    it("logs a warning when failing open", async () => {
      const failingBlobStore: BlobStore = {
        getFromEventLog: vi.fn(),
        putSpool: vi.fn(async () => {
          throw new Error("S3 unavailable");
        }),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;

      const logger = { warn: vi.fn() };
      const data = makeOversizedCommand();

      await maybeSpool({ data, blobStore: failingBlobStore, logger });

      expect(logger.warn).toHaveBeenCalledOnce();
    });
  });
});
