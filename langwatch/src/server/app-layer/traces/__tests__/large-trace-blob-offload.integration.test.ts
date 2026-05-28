/**
 * Integration test for the large-trace blob offload pipeline (#4215 / ADR-021).
 *
 * Environment choice: in-process stubs only (no testcontainers, no real S3).
 *
 * Rationale: the goal of this test is pipeline WIRING, not S3 fidelity or
 * ClickHouse SQL correctness — those are separately covered by unit tests
 * (blob-store.service.unit.test.ts, resolve-offloaded-traces.unit.test.ts).
 * The full pipeline wiring is exercised by:
 *   - Building a `TraceRequestCollectionService` with the offload hook wired in
 *     to a fake `BlobStore` (spy-backed in-process map).
 *   - Capturing what `recordSpan` receives (spy at the CH boundary).
 *   - Feeding the captured NormalizedSpans directly into
 *     `resolveOffloadedTraces` → `TraceIOExtractionService` (the same call
 *     path that `TraceService.getTracesWithSpans` exercises in production via
 *     `ClickHouseTraceService`).
 *
 * This approach exercises every production module in the pipeline without
 * requiring infrastructure, and the assertions are identical to what the real
 * read path delivers.
 *
 * BDD structure: `describe("given …")` → `describe("when …")` → `it("…")`.
 * No "should" in it() names (project convention).
 */

import { createHash } from "node:crypto";
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { IExportTraceServiceRequest } from "@opentelemetry/otlp-transformer";

import type { RecordSpanCommandData } from "~/server/event-sourcing/pipelines/trace-processing/schemas/commands";
import { NullSpanDedupeService } from "~/server/app-layer/traces/span-dedupe.service";
import { TraceRequestCollectionService } from "~/server/app-layer/traces/trace-request-collection.service";
import { offloadOtlpSpanAttributes } from "~/server/app-layer/traces/otlp-span-offload";
import {
  BlobStore,
  type TraceBlobRef,
} from "~/server/app-layer/traces/blob-store.service";
import { SpanBlobResolutionService } from "~/server/app-layer/traces/span-blob-resolution.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  resolveOffloadedTraces,
  type WarnLogger,
} from "~/server/traces/resolve-offloaded-traces";
import { BLOB_REF_ATTR_PREFIX } from "~/server/app-layer/traces/blob-ref-attributes";
import type { OtlpKeyValue } from "~/server/event-sourcing/pipelines/trace-processing/schemas/otlp";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

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

/** 1 MB string — well over the 32 KB default threshold. */
const ONE_MB_OUTPUT = "x".repeat(1024 * 1024);

/** SHA-256 of ONE_MB_OUTPUT for integrity checks. */
const ONE_MB_OUTPUT_SHA256 = createHash("sha256")
  .update(Buffer.from(ONE_MB_OUTPUT, "utf-8"))
  .digest("hex");

/** Bounded preview kept inline in place of an offloaded value (2 KB per span-field-offload.service). */
const PREVIEW_BYTES = 2 * 1024;

/** Expected blob key for langwatch.output. */
const EXPECTED_BLOB_KEY = `trace-blobs/${PROJECT_ID}/${TRACE_ID}/${SPAN_ID}/langwatch.output`;

/**
 * Builds an in-process BlobStore backed by a simple Map.
 * Returns the store and the spy functions for assertions.
 */
function makeFakeBlobStore(initialContents: Map<string, string> = new Map()): {
  blobStore: BlobStore;
  putSpy: ReturnType<typeof vi.fn>;
  getSpy: ReturnType<typeof vi.fn>;
} {
  const storage = new Map<string, string>(initialContents);

  const putSpy = vi.fn(
    async ({
      projectId,
      traceId,
      spanId,
      attrKey,
      value,
    }: {
      projectId: string;
      traceId: string;
      spanId: string;
      attrKey: string;
      value: string;
    }): Promise<TraceBlobRef> => {
      const key = BlobStore.blobKey({ projectId, traceId, spanId, attrKey });
      storage.set(key, value);
      const sha256 = createHash("sha256")
        .update(Buffer.from(value, "utf-8"))
        .digest("hex");
      return {
        key,
        size: Buffer.byteLength(value, "utf-8"),
        sha256,
        encoding: "utf-8",
      };
    },
  );

  const getSpy = vi.fn(
    async ({
      ref,
    }: {
      projectId: string;
      ref: TraceBlobRef;
    }): Promise<string> => {
      const val = storage.get(ref.key);
      if (val === undefined) {
        const err = Object.assign(new Error("NoSuchKey"), { name: "NoSuchKey" });
        throw err;
      }
      return val;
    },
  );

  const blobStore = { put: putSpy, get: getSpy } as unknown as BlobStore;
  return { blobStore, putSpy, getSpy };
}

/**
 * Builds a valid IExportTraceServiceRequest with a single span having
 * `langwatch.output` set to the given value.
 *
 * Uses string traceId / spanId (hex) so `idSchema` passes them through
 * directly (they are already hex strings).
 */
function makeOtlpRequest({
  output,
  traceId = TRACE_ID,
  spanId = SPAN_ID,
}: {
  output: string;
  traceId?: string;
  spanId?: string;
}): IExportTraceServiceRequest {
  const nowNs = String(Date.now() * 1_000_000);
  const endNs = String((Date.now() + 1000) * 1_000_000);

  return {
    resourceSpans: [
      {
        resource: { attributes: [] },
        scopeSpans: [
          {
            scope: { name: "test-scope" },
            spans: [
              {
                traceId,
                spanId,
                name: "test-span",
                kind: 1, // INTERNAL
                startTimeUnixNano: nowNs as unknown as number,
                endTimeUnixNano: endNs as unknown as number,
                attributes: [
                  {
                    key: "langwatch.output",
                    value: { stringValue: output },
                  },
                ] as OtlpKeyValue[],
                events: [],
                links: [],
                status: { code: 1, message: null },
                droppedAttributesCount: 0,
                droppedEventsCount: 0,
                droppedLinksCount: 0,
              },
            ],
          },
        ],
      },
    ],
  } as unknown as IExportTraceServiceRequest;
}

/**
 * Builds the TraceRequestCollectionService with the blob offload hook wired,
 * and returns the capturedSpans array that `recordSpan` populates.
 */
function buildIngestionService({
  blobStore,
  flagEnabled,
}: {
  blobStore: BlobStore;
  flagEnabled: boolean;
}): {
  collectionService: TraceRequestCollectionService;
  capturedSpans: RecordSpanCommandData[];
} {
  const capturedSpans: RecordSpanCommandData[] = [];

  const recordSpan = vi.fn(async (data: RecordSpanCommandData) => {
    capturedSpans.push(data);
  });

  // The `offloadSpanAttributes` callback receives `NormalizedIdSpan` (an
  // unexported intersection of OtlpSpan with forced hex traceId/spanId).
  // We use `any` here so the test file doesn't need to export that private
  // type; the production implementation in presets.ts provides the real types.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const offloadSpanAttributes = flagEnabled
    ? async ({ projectId, span }: { projectId: string; span: any }) => {
        const attributes = await offloadOtlpSpanAttributes({
          attributes: span.attributes as OtlpKeyValue[],
          projectId,
          traceId: span.traceId as string,
          spanId: span.spanId as string,
          blobStore,
        });
        return attributes === span.attributes
          ? span
          : { ...span, attributes };
      }
    : undefined;

  const collectionService = new TraceRequestCollectionService({
    dedup: new NullSpanDedupeService(),
    recordSpan,
    offloadSpanAttributes,
  });

  return { collectionService, capturedSpans };
}

/**
 * Simulates the read path: given spans captured at the recordSpan boundary
 * (which carry the same attribute shape as NormalizedSpans stored in CH),
 * resolves blobs and extracts IO.
 *
 * In production this is done by ClickHouseTraceService.fetchTracesWithSpansJoined
 * → resolveTraceSpans → resolveOffloadedTraces. We call resolveOffloadedTraces
 * directly here because the CH layer is irrelevant for pipeline-wiring.
 */
async function simulateReadPath({
  capturedSpans,
  blobStore,
  logger,
}: {
  capturedSpans: RecordSpanCommandData[];
  blobStore: BlobStore;
  logger: WarnLogger;
}) {
  // Reconstruct a NormalizedSpan from what recordSpan received.
  // The OtlpSpan.attributes is an OtlpKeyValue[]; to simulate what the
  // trace-processing fold emits as NormalizedSpan.spanAttributes, we map
  // the array to a Record<string, string>.
  const otlpSpan = capturedSpans[0]!.span;
  const spanAttributes: Record<string, string> = {};
  for (const kv of otlpSpan.attributes ?? []) {
    const sv = kv.value?.stringValue;
    if (typeof sv === "string") {
      spanAttributes[kv.key] = sv;
    }
  }

  const normalizedSpan: NormalizedSpan = {
    id: otlpSpan.spanId,
    traceId: otlpSpan.traceId,
    spanId: otlpSpan.spanId,
    tenantId: PROJECT_ID,
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
    durationMs: 1000,
    name: otlpSpan.name,
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
  };

  const blobResolutionService = new SpanBlobResolutionService(blobStore);
  const ioExtractionService = new TraceIOExtractionService();

  return resolveOffloadedTraces({
    projectId: PROJECT_ID,
    normalizedSpans: [normalizedSpan],
    blobResolutionService,
    ioExtractionService,
    logger,
  });
}

// ---------------------------------------------------------------------------
// Test suite
// ---------------------------------------------------------------------------

describe("given the release_trace_blob_offload flag is on for the project and a span has a 1 MB langwatch.output", () => {
  let capturedSpans: RecordSpanCommandData[];
  let putSpy: ReturnType<typeof vi.fn>;
  let blobStore: BlobStore;

  beforeEach(async () => {
    const fake = makeFakeBlobStore();
    blobStore = fake.blobStore;
    putSpy = fake.putSpy;

    const { collectionService, capturedSpans: spans } = buildIngestionService({
      blobStore,
      flagEnabled: true,
    });
    capturedSpans = spans;

    await collectionService.handleOtlpTraceRequest(
      PROJECT_ID,
      makeOtlpRequest({ output: ONE_MB_OUTPUT }),
      "DISABLED",
    );
  });

  describe("when ingested via TraceRequestCollectionService", () => {
    /** @scenario An over-threshold field is offloaded once with preview inline and ref recorded */
    /** @scenario Offloaded blob round-trips with byte integrity */
    it("BlobStore.put is called once with the over-threshold value keyed trace-blobs/{projectId}/{traceId}/{spanId}/langwatch.output", () => {
      expect(putSpy).toHaveBeenCalledOnce();
      const callArg = putSpy.mock.calls[0]![0];
      expect(callArg.projectId).toBe(PROJECT_ID);
      expect(callArg.traceId).toBe(TRACE_ID);
      expect(callArg.spanId).toBe(SPAN_ID);
      expect(callArg.attrKey).toBe("langwatch.output");
      expect(callArg.value).toBe(ONE_MB_OUTPUT);
    });

    it("recordSpan receives the span with langwatch.output shortened to a preview within the preview byte budget", () => {
      expect(capturedSpans).toHaveLength(1);
      const attrs = capturedSpans[0]!.span.attributes ?? [];
      const outputAttr = (attrs as OtlpKeyValue[]).find(
        (kv) => kv.key === "langwatch.output",
      );
      expect(outputAttr).toBeDefined();
      const previewValue = outputAttr!.value?.stringValue ?? "";
      // Preview must be smaller than the 1 MB original
      expect(Buffer.byteLength(previewValue, "utf-8")).toBeLessThanOrEqual(
        PREVIEW_BYTES + 4, // +4 bytes for the ellipsis character "…" (3 bytes UTF-8)
      );
      expect(Buffer.byteLength(previewValue, "utf-8")).toBeLessThan(
        Buffer.byteLength(ONE_MB_OUTPUT, "utf-8"),
      );
    });

    it("recordSpan receives a reserved blob-ref attribute langwatch.reserved.blobref.langwatch.output with parseable ref JSON", () => {
      const attrs = capturedSpans[0]!.span.attributes ?? [];
      const refAttr = (attrs as OtlpKeyValue[]).find(
        (kv) => kv.key === `${BLOB_REF_ATTR_PREFIX}langwatch.output`,
      );
      expect(refAttr).toBeDefined();

      const ref = JSON.parse(refAttr!.value?.stringValue ?? "{}") as TraceBlobRef;
      expect(ref.key).toBe(EXPECTED_BLOB_KEY);
      expect(ref.size).toBe(Buffer.byteLength(ONE_MB_OUTPUT, "utf-8"));
      expect(ref.sha256).toBe(ONE_MB_OUTPUT_SHA256);
      expect(ref.encoding).toBe("utf-8");
    });
  });

  describe("when read back via the resolution pipeline (simulating TraceService.getTracesWithSpans)", () => {
    /** @scenario Trace-detail read returns input and output byte-identical to ingestion */
    /** @scenario Trace-detail resolves refs to full IO while list and search use the preview */
    it("the returned span's langwatch.output is the full value byte-identical to the input", async () => {
      const logger = { warn: vi.fn(), error: vi.fn() };
      const result = await simulateReadPath({ capturedSpans, blobStore, logger });

      const resolvedAttrValue =
        result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"];
      expect(resolvedAttrValue).toBe(ONE_MB_OUTPUT);
    });

    it("the reserved blob-ref attribute is stripped from the returned span attributes", async () => {
      const logger = { warn: vi.fn(), error: vi.fn() };
      const result = await simulateReadPath({ capturedSpans, blobStore, logger });

      const attrs = result.resolvedSpans[0]?.spanAttributes ?? {};
      const hasRef = Object.keys(attrs).some((k) =>
        k.startsWith(BLOB_REF_ATTR_PREFIX),
      );
      expect(hasRef).toBe(false);
    });

    /** @scenario An online evaluator on an over-threshold trace receives the full output */
    it("the recomputed trace.output (via TraceIOExtractionService) is the full value, not the preview", async () => {
      const logger = { warn: vi.fn(), error: vi.fn() };
      const result = await simulateReadPath({ capturedSpans, blobStore, logger });

      expect(result.recomputedOutput).not.toBeNull();
      expect(result.recomputedOutput!.text).toBe(ONE_MB_OUTPUT);
    });

    it("anyResolved is true", async () => {
      const logger = { warn: vi.fn(), error: vi.fn() };
      const result = await simulateReadPath({ capturedSpans, blobStore, logger });
      expect(result.anyResolved).toBe(true);
    });
  });
});

// ---------------------------------------------------------------------------
// Flag-off path
// ---------------------------------------------------------------------------

describe("given the release_trace_blob_offload flag is OFF for the project and a span has a 1 MB langwatch.output", () => {
  let capturedSpans: RecordSpanCommandData[];
  let putSpy: ReturnType<typeof vi.fn>;
  let blobStore: BlobStore;

  beforeEach(async () => {
    const fake = makeFakeBlobStore();
    blobStore = fake.blobStore;
    putSpy = fake.putSpy;

    const { collectionService, capturedSpans: spans } = buildIngestionService({
      blobStore,
      flagEnabled: false,
    });
    capturedSpans = spans;

    await collectionService.handleOtlpTraceRequest(
      PROJECT_ID,
      makeOtlpRequest({ output: ONE_MB_OUTPUT }),
      "DISABLED",
    );
  });

  describe("when ingested via TraceRequestCollectionService", () => {
    /** @scenario With the flag off, ingestion and reads behave exactly as before */
    it("BlobStore.put is never called", () => {
      expect(putSpy).not.toHaveBeenCalled();
    });

    it("recordSpan receives the full value in langwatch.output with no truncation", () => {
      expect(capturedSpans).toHaveLength(1);
      const attrs = capturedSpans[0]!.span.attributes ?? [];
      const outputAttr = (attrs as OtlpKeyValue[]).find(
        (kv) => kv.key === "langwatch.output",
      );
      expect(outputAttr).toBeDefined();
      expect(outputAttr!.value?.stringValue).toBe(ONE_MB_OUTPUT);
    });

    it("recordSpan does not include any reserved blob-ref attribute", () => {
      const attrs = capturedSpans[0]!.span.attributes ?? [];
      const hasRef = (attrs as OtlpKeyValue[]).some((kv) =>
        kv.key.startsWith(BLOB_REF_ATTR_PREFIX),
      );
      expect(hasRef).toBe(false);
    });
  });

  describe("when read back via the resolution pipeline", () => {
    it("returns the full value byte-identical to the input without invoking BlobStore.get", async () => {
      // Build a blobStore with a get spy to confirm it is never invoked
      const fakeFlagOff = makeFakeBlobStore();

      // Reconstruct spans without any blob refs (flag-off path)
      const otlpSpan = capturedSpans[0]!.span;
      const spanAttributes: Record<string, string> = {};
      for (const kv of (otlpSpan.attributes ?? []) as OtlpKeyValue[]) {
        const sv = kv.value?.stringValue;
        if (typeof sv === "string") {
          spanAttributes[kv.key] = sv;
        }
      }

      const normalizedSpan: NormalizedSpan = {
        id: otlpSpan.spanId,
        traceId: otlpSpan.traceId,
        spanId: otlpSpan.spanId,
        tenantId: PROJECT_ID,
        parentSpanId: null,
        parentTraceId: null,
        parentIsRemote: null,
        sampled: true,
        startTimeUnixMs: 0,
        endTimeUnixMs: 1000,
        durationMs: 1000,
        name: otlpSpan.name,
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
      };

      const blobResolutionService = new SpanBlobResolutionService(
        fakeFlagOff.blobStore,
      );
      const ioExtractionService = new TraceIOExtractionService();
      const logger = { warn: vi.fn(), error: vi.fn() };

      const result = await resolveOffloadedTraces({
        projectId: PROJECT_ID,
        normalizedSpans: [normalizedSpan],
        blobResolutionService,
        ioExtractionService,
        logger,
      });

      // Full value is preserved as-is (fast path: no refs → no resolution)
      expect(
        result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"],
      ).toBe(ONE_MB_OUTPUT);

      // BlobStore.get is never called because no refs were present
      expect(fakeFlagOff.getSpy).not.toHaveBeenCalled();

      // anyResolved is false: no blob refs to resolve
      expect(result.anyResolved).toBe(false);
    });
  });
});

// ---------------------------------------------------------------------------
// Stale blob (NoSuchKey on read)
// ---------------------------------------------------------------------------

describe("given the flag is on, a span was offloaded, but the blob is missing on read (stale blob)", () => {
  let capturedSpans: RecordSpanCommandData[];
  let previewValue: string;

  beforeEach(async () => {
    // Ingest with flag on so the span gets offloaded
    const { blobStore: ingestionBlobStore } = makeFakeBlobStore();
    const { collectionService, capturedSpans: spans } = buildIngestionService({
      blobStore: ingestionBlobStore,
      flagEnabled: true,
    });
    capturedSpans = spans;

    await collectionService.handleOtlpTraceRequest(
      PROJECT_ID,
      makeOtlpRequest({ output: ONE_MB_OUTPUT }),
      "DISABLED",
    );

    // Capture the preview value for assertion
    const attrs = capturedSpans[0]!.span.attributes ?? [];
    previewValue =
      (attrs as OtlpKeyValue[]).find((kv) => kv.key === "langwatch.output")
        ?.value?.stringValue ?? "";
  });

  describe("when BlobStore.get throws NoSuchKey on read", () => {
    it("does not throw to the caller", async () => {
      // Empty blob store — get will throw NoSuchKey for any key
      const { blobStore: emptyBlobStore } = makeFakeBlobStore(new Map());
      const logger = { warn: vi.fn(), error: vi.fn() };

      await expect(
        simulateReadPath({
          capturedSpans,
          blobStore: emptyBlobStore,
          logger,
        }),
      ).resolves.not.toThrow();
    });

    it("returns the preview value (not the full value)", async () => {
      const { blobStore: emptyBlobStore } = makeFakeBlobStore(new Map());
      const logger = { warn: vi.fn(), error: vi.fn() };

      const result = await simulateReadPath({
        capturedSpans,
        blobStore: emptyBlobStore,
        logger,
      });

      const returnedValue =
        result.resolvedSpans[0]?.spanAttributes?.["langwatch.output"];
      expect(returnedValue).toBe(previewValue);
      // Preview is shorter than the original 1 MB value
      expect((returnedValue as string).length).toBeLessThan(ONE_MB_OUTPUT.length);
    });

    it("logs at warn level (not error or silent)", async () => {
      const { blobStore: emptyBlobStore } = makeFakeBlobStore(new Map());
      const logger = { warn: vi.fn(), error: vi.fn() };

      await simulateReadPath({
        capturedSpans,
        blobStore: emptyBlobStore,
        logger,
      });

      expect(logger.warn).toHaveBeenCalledOnce();
    });

    it("anyResolved is false (the span was not resolved)", async () => {
      const { blobStore: emptyBlobStore } = makeFakeBlobStore(new Map());
      const logger = { warn: vi.fn(), error: vi.fn() };

      const result = await simulateReadPath({
        capturedSpans,
        blobStore: emptyBlobStore,
        logger,
      });

      expect(result.anyResolved).toBe(false);
    });
  });
});
