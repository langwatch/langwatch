/** v2 read path resolves eventref pointers via optional blob resolution
 * dependencies. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

// Passthrough mock for langwatch tracer used by TraceIOExtractionService.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: () => void; setAttributes: () => void }) => unknown,
    ) => fn({ setAttribute: () => {}, setAttributes: () => {} }),
  }),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

import {
  EVENTREF_ATTR_PREFIX,
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "@langwatch/trace-contract";

import type { SpanStorageRepository } from "../../../repositories/span-storage.repository.ts";
import { NullSpanStorageRepository } from "../../../repositories/span-storage.repository.ts";
import type { TraceBlobStoreService } from "../../trace-blob-store.service.ts";
import { BlobNotFoundError } from "../../trace-blob-store.service.ts";
import { TraceIOExtractionService } from "../../trace-io-extraction.service.ts";
import { SpanStorageService } from "../../trace-span-storage-read.service.ts";

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

/** Stub with findNormalizedSpansByTraceId returning spans, others null (forces
 * resolution path). */
function makeStubRepository(normalizedSpans: NormalizedSpan[]): SpanStorageRepository {
  return Object.assign(new NullSpanStorageRepository(), {
    findNormalizedSpansByTraceId: vi.fn(async () => normalizedSpans),
    // Keep raw paths returning empty so tests can distinguish the two paths.
    findSpansByTraceId: vi.fn(async () => []),
    findSpanByIds: vi.fn(async () => null),
  });
}

function makeBlobStore(resolvedValues: Record<string, string>): TraceBlobStoreService {
  return {
    getFromEventLog: vi.fn(async ({ field }: { field: string }) => {
      if (field in resolvedValues) return resolvedValues[field]!;
      throw new BlobNotFoundError("evt-test", field, "proj-1");
    }),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as TraceBlobStoreService;
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
      let service: ReturnType<typeof SpanStorageService.create>;

      beforeEach(() => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({ "langwatch.output": FULL_OUTPUT });
        service = SpanStorageService.create({
          repository: repo,
          blobResolutionDeps: {
            blobStore,
            ioExtractionService: TraceIOExtractionService.create(
              TraceCanonicalisationService.create(),
            ),
          },
        });
      });

      it("returns spans with the full output value, not the preview", async () => {
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
          outputValue?.type === "text" ? outputValue.value : JSON.stringify(outputValue);
        expect(outputStr).toContain(FULL_OUTPUT);
        expect(outputStr).not.toBe(PREVIEW_OUTPUT);
      });

      it("does not surface the reserved eventref key in the serialized params", async () => {
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

    describe("when findSpanById is called with BlobResolutionDeps wired", () => {
      let service: ReturnType<typeof SpanStorageService.create>;

      beforeEach(() => {
        const repo = makeStubRepository([spanWithRef]);
        const blobStore = makeBlobStore({ "langwatch.output": FULL_OUTPUT });
        service = SpanStorageService.create({
          repository: repo,
          blobResolutionDeps: {
            blobStore,
            ioExtractionService: TraceIOExtractionService.create(
              TraceCanonicalisationService.create(),
            ),
          },
        });
      });

      it("returns the span with the full output value, not the preview", async () => {
        const span = await service.findSpanById({
          tenantId: "proj-1",
          traceId: "trace-1",
          spanId: "span-1",
        });

        expect(span).not.toBeNull();
        const outputValue = span?.output;
        expect(outputValue).not.toBeNull();
        const outputStr =
          outputValue?.type === "text" ? outputValue.value : JSON.stringify(outputValue);
        expect(outputStr).toContain(FULL_OUTPUT);
        expect(outputStr).not.toBe(PREVIEW_OUTPUT);
      });

      it("returns null when the spanId is not found in the trace", async () => {
        const span = await service.findSpanById({
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
        } as unknown as TraceBlobStoreService;
        const service = SpanStorageService.create({
          repository: repo,
          blobResolutionDeps: {
            blobStore,
            ioExtractionService: TraceIOExtractionService.create(
              TraceCanonicalisationService.create(),
            ),
          },
        });

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-2",
        });

        expect(spans).toHaveLength(1);
        // Output is unchanged — the non-offloaded value passes through.
        const outputValue = spans[0]?.output;
        const outputStr =
          outputValue?.type === "text" ? outputValue.value : JSON.stringify(outputValue);
        expect(outputStr).toBe("A short non-offloaded output value");
        // Fast-path: TraceBlobStoreService is never called when there are no eventref attrs.
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
      it("delegates directly to the repository findSpansByTraceId (no normalization path)", async () => {
        const repo = makeStubRepository([spanWithRef]);
        // Without deps, the service calls findSpansByTraceId on the repo (which returns []).
        const service = SpanStorageService.create({ repository: repo });

        const spans = await service.getSpansByTraceId({
          tenantId: "proj-1",
          traceId: "trace-legacy",
        });

        // The stub repo's findSpansByTraceId returns [] — proving the direct path was taken.
        expect(spans).toHaveLength(0);
        // findNormalizedSpansByTraceId must NOT have been called (no resolution).
        expect(
          (repo.findNormalizedSpansByTraceId as ReturnType<typeof vi.fn>).mock.calls,
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
        const service = SpanStorageService.create({
          repository: repo,
          blobResolutionDeps: {
            blobStore,
            ioExtractionService: TraceIOExtractionService.create(
              TraceCanonicalisationService.create(),
            ),
          },
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
          outputValue?.type === "text" ? outputValue.value : JSON.stringify(outputValue);
        // Falls back to preview value when event_log row is missing.
        expect(outputStr).toBe(PREVIEW_OUTPUT);
      });
    });
  });
});
