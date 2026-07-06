/**
 * Unit tests proving that the v2 read path (SpanStorageService.getSpansByTraceId
 * and SpanStorageService.getSpanById) resolves ADR-022 offloaded eventref
 * pointers before returning spans to the caller.
 *
 * The fix: SpanStorageService now accepts optional SpanReadBlobResolutionDeps.
 * When present, getSpansByTraceId/getSpanById call getNormalizedSpansByTraceId
 * → resolveOffloadedTraces → mapNormalizedSpansToSpans instead of delegating
 * directly to getSpansByTraceId/getSpanByIds on the repository.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */

import { describe, expect, it, vi } from "vitest";

// Passthrough mock for langwatch tracer used by TraceIOExtractionService.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: {
        setAttribute: () => void;
        setAttributes: () => void;
      }) => unknown,
    ) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
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

import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { SpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import { NullSpanStorageRepository } from "~/server/app-layer/traces/repositories/span-storage.repository";
import { SpanStorageService } from "~/server/app-layer/traces/span-storage.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import {
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FULL_OUTPUT = "The full 50 KB output that was offloaded to event_log";
const PREVIEW_OUTPUT = "The full 50 KB output that was offloaded…";

function makeNormalizedSpan(
  overrides: Partial<NormalizedSpan> & {
    spanAttributes?: Record<string, string>;
  } = {},
): NormalizedSpan {
  return {
    id: "span-1",
    traceId: "trace-1",
    spanId: "span-1",
    tenantId: "proj-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: 1000,
    endTimeUnixMs: 2000,
    durationMs: 1000,
    name: "test-span",
    kind: NormalizedSpanKind.INTERNAL,
    resourceAttributes: {},
    spanAttributes: {},
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
    ...overrides,
  };
}

/**
 * Builds a SpanStorageRepository stub whose getNormalizedSpansByTraceId
 * returns the given spans, and whose getSpansByTraceId / getSpanByIds delegate
 * to the NullSpanStorageRepository (return empty/null) so any resolved result
 * must come from the resolution path, not the raw-Span path.
 */
function makeStubRepository(
  normalizedSpans: NormalizedSpan[],
): SpanStorageRepository {
  const nullRepo = new NullSpanStorageRepository();
  return {
    ...nullRepo,
    getNormalizedSpansByTraceId: vi.fn(async () => normalizedSpans),
    // Keep raw paths returning empty so tests can distinguish the two paths.
    getSpansByTraceId: vi.fn(async () => []),
    getSpanByIds: vi.fn(async () => null),
  } as unknown as SpanStorageRepository;
}

function makeBlobStore(resolvedValues: Record<string, string>): BlobStore {
  return {
    getFromEventLog: vi.fn(async ({ field }: { field: string }) => {
      if (field in resolvedValues) return resolvedValues[field]!;
      throw new BlobNotFoundError("evt-test", field, "proj-1");
    }),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("SpanStorageService v2 offload-resolution wiring", () => {
  describe("given a span stored with a langwatch.output eventref pointer (ADR-022 offloaded)", () => {
    const spanWithRef = makeNormalizedSpan({
      spanId: "span-1",
      traceId: "trace-1",
      spanAttributes: {
        "langwatch.output": PREVIEW_OUTPUT,
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-001",
        }),
      },
    });

    describe("when getSpansByTraceId is called with BlobResolutionDeps wired", () => {
      it("returns spans with the full output value, not the preview", async () => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({ "langwatch.output": FULL_OUTPUT });
        const service = new SpanStorageService(repo, {
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
        });

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-1",
        });

        expect(spans).toHaveLength(1);
        // The Span output is extracted from the resolved langwatch.output attribute.
        const outputValue = spans[0]?.output;
        expect(outputValue).not.toBeNull();
        // mapNormalizedSpanToSpan extracts langwatch.output as SpanInputOutput.
        // The full value must be present somewhere in the serialized output.
        const outputStr =
          outputValue?.type === "text"
            ? outputValue.value
            : JSON.stringify(outputValue);
        expect(outputStr).toContain(FULL_OUTPUT);
        expect(outputStr).not.toBe(PREVIEW_OUTPUT);
      });

      it("does not surface the reserved eventref key in the serialized params", async () => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({ "langwatch.output": FULL_OUTPUT });
        const service = new SpanStorageService(repo, {
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
        });

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-1",
        });

        // params are the unflattened spanAttributes; the reserved eventref
        // key prefix must not appear anywhere in the serialized params so it
        // never leaks the internal namespace to the v2 UI.
        const serializedParams = JSON.stringify(spans[0]?.params ?? {});
        expect(serializedParams).not.toContain(EVENTREF_ATTR_PREFIX);
      });
    });

    describe("when getSpanById is called with BlobResolutionDeps wired", () => {
      it("returns the span with the full output value, not the preview", async () => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({ "langwatch.output": FULL_OUTPUT });
        const service = new SpanStorageService(repo, {
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
        });

        const span = await service.getSpanById({
          tenantId: "proj-1",
          traceId: "trace-1",
          spanId: "span-1",
        });

        expect(span).not.toBeNull();
        const outputValue = span?.output;
        expect(outputValue).not.toBeNull();
        const outputStr =
          outputValue?.type === "text"
            ? outputValue.value
            : JSON.stringify(outputValue);
        expect(outputStr).toContain(FULL_OUTPUT);
        expect(outputStr).not.toBe(PREVIEW_OUTPUT);
      });

      it("returns null when the spanId is not found in the trace", async () => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({ "langwatch.output": FULL_OUTPUT });
        const service = new SpanStorageService(repo, {
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
        });

        const span = await service.getSpanById({
          tenantId: "proj-1",
          traceId: "trace-1",
          spanId: "non-existent-span",
        });

        expect(span).toBeNull();
      });
    });
  });

  describe("given spans with no eventref pointers (normal, non-offloaded trace)", () => {
    const cleanSpan = makeNormalizedSpan({
      spanId: "span-clean",
      traceId: "trace-2",
      spanAttributes: {
        "langwatch.output": "A short non-offloaded output value",
      },
    });

    describe("when getSpansByTraceId is called with BlobResolutionDeps wired", () => {
      it("returns the span with the output value unchanged", async () => {
        const repo = makeStubRepository([cleanSpan]);
        const getFromEventLogSpy = vi.fn();
        const blobStore = {
          getFromEventLog: getFromEventLogSpy,
          putSpool: vi.fn(),
          getSpool: vi.fn(),
          deleteSpool: vi.fn(),
        } as unknown as BlobStore;
        const service = new SpanStorageService(repo, {
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
        });

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-2",
        });

        expect(spans).toHaveLength(1);
        // Output is unchanged — the non-offloaded value passes through.
        const outputValue = spans[0]?.output;
        const outputStr =
          outputValue?.type === "text"
            ? outputValue.value
            : JSON.stringify(outputValue);
        expect(outputStr).toBe("A short non-offloaded output value");
        // Fast-path: BlobStore is never called when there are no eventref attrs.
        expect(getFromEventLogSpy).not.toHaveBeenCalled();
      });
    });
  });

  describe("given BlobResolutionDeps are NOT provided (legacy / no-op path)", () => {
    const spanWithRef = makeNormalizedSpan({
      spanId: "span-legacy",
      spanAttributes: {
        "langwatch.output": PREVIEW_OUTPUT,
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-002",
        }),
      },
    });

    describe("when getSpansByTraceId is called without BlobResolutionDeps", () => {
      it("delegates directly to the repository getSpansByTraceId (no normalization path)", async () => {
        const repo = makeStubRepository([spanWithRef]);
        // Without deps, the service calls getSpansByTraceId on the repo (which returns []).
        const service = new SpanStorageService(repo);

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-legacy",
        });

        // The stub repo's getSpansByTraceId returns [] — proving the direct path was taken.
        expect(spans).toHaveLength(0);
        // getNormalizedSpansByTraceId must NOT have been called (no resolution).
        expect(
          (repo.getNormalizedSpansByTraceId as ReturnType<typeof vi.fn>).mock
            .calls,
        ).toHaveLength(0);
      });
    });
  });

  describe("given a missing event_log row (BlobNotFoundError on resolution)", () => {
    const spanWithRef = makeNormalizedSpan({
      spanId: "span-stale",
      traceId: "trace-stale",
      spanAttributes: {
        "langwatch.output": PREVIEW_OUTPUT,
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-missing",
        }),
      },
    });

    describe("when getSpansByTraceId is called with BlobResolutionDeps wired", () => {
      it("returns the preview value without throwing", async () => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({}); // empty — will throw BlobNotFoundError
        const service = new SpanStorageService(repo, {
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
        });

        await expect(
          service.getSpansByTraceId({
            tenantId: "proj-1",
            traceId: "trace-stale",
          }),
        ).resolves.not.toThrow();

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-stale",
        });
        const outputValue = spans[0]?.output;
        const outputStr =
          outputValue?.type === "text"
            ? outputValue.value
            : JSON.stringify(outputValue);
        // Falls back to preview value when event_log row is missing.
        expect(outputStr).toBe(PREVIEW_OUTPUT);
      });
    });
  });
});
