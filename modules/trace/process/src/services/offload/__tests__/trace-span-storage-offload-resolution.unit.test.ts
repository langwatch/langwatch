/** v2 read path resolves eventref pointers via optional blob resolution
 * dependencies. */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

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

import { type Authorization, narrowAuthorization } from "@langwatch/authorization";
import { aggregateProof, ownProof } from "@langwatch/authorization/testing";
import {
  EVENTREF_ATTR_PREFIX,
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "@langwatch/trace-contract";

import { TraceIOExtractionService } from "../../../features/derivation/services/trace-io-extraction.service.ts";
import { BlobNotFoundError } from "../../../features/media/services/trace-blob-store.service.ts";
import { SpanStorageService } from "../../../features/read/services/trace-span-storage-read.service.ts";
import type { SpanStorageRepository } from "../../../repositories/span-storage.repository.ts";
import { NullSpanStorageRepository } from "../../../repositories/span-storage.repository.ts";
import {
  blobStoreReading,
  blobStoreResolving,
} from "../../__tests__/support/trace-blob-store.support.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const FULL_OUTPUT = "The full 50 KB output that was offloaded to event_log";
const PREVIEW_OUTPUT = "The full 50 KB output that was offloaded…";

const proofFor = (projectId: string): Authorization => ownProof({ projectId, now: Date.now() });

const ioExtraction = () => TraceIOExtractionService.create(TraceCanonicalisationService.create());

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
        const blobStore = blobStoreResolving({ "langwatch.output": FULL_OUTPUT });
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
          authorization: proofFor("proj-1"),
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
          authorization: proofFor("proj-1"),
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
        const blobStore = blobStoreResolving({ "langwatch.output": FULL_OUTPUT });
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
          authorization: proofFor("proj-1"),
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
          authorization: proofFor("proj-1"),
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
        const blobStore = blobStoreResolving({});
        const getFromEventLogSpy = blobStore.getFromEventLog;
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
          authorization: proofFor("proj-1"),
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
          authorization: proofFor("proj-1"),
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
        const blobStore = blobStoreResolving({}); // empty — will throw BlobNotFoundError
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
            authorization: proofFor("proj-1"),
            traceId: "trace-stale",
          }),
        ).resolves.not.toThrow();

        const spans = await service.getSpansByTraceId({
          authorization: proofFor("proj-1"),
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

  describe("given a member's offloaded span read through an aggregate", () => {
    const AGGREGATE = "proj-aggregate";
    const MEMBER = "proj-member";
    const memberSpan = makeNormalizedSpan({
      spanId: "span-member",
      traceId: "trace-member",
      tenantId: MEMBER,
      spanAttributes: {
        "langwatch.output": PREVIEW_OUTPUT,
        [`${EVENTREF_ATTR_PREFIX}langwatch.output`]: JSON.stringify({
          field: "langwatch.output",
          eventId: "evt-member",
        }),
      },
    });
    const aggregateReadsMember = () =>
      aggregateProof({
        projectId: AGGREGATE,
        members: [{ projectId: MEMBER, from: 0 }],
        now: Date.now(),
      });
    /** A blob store that holds the full body under the member only. */
    const memberBlobStore = () =>
      blobStoreReading(async ({ eventId, field, tenantId }) => {
        if (tenantId === MEMBER) return FULL_OUTPUT;
        throw new BlobNotFoundError(eventId, field, tenantId);
      });
    const outputOf = (span: { output?: unknown } | null | undefined) => {
      const output = span?.output as { type: string; value: unknown } | null | undefined;
      return output?.type === "text" ? output.value : JSON.stringify(output);
    };

    describe("when the proof is narrowed to the member", () => {
      const narrowedToMember = (): Authorization => {
        const narrowed = narrowAuthorization({
          authorization: aggregateReadsMember(),
          projectId: MEMBER,
        });
        if (narrowed === null) throw new Error("the aggregate's proof names the member");
        return narrowed;
      };

      it("resolves the body under the member for the trace's spans", async () => {
        const blobStore = memberBlobStore();
        const service = SpanStorageService.create({
          repository: makeStubRepository([memberSpan]),
          blobResolutionDeps: { blobStore, ioExtractionService: ioExtraction() },
        });

        const spans = await service.getSpansByTraceId({
          authorization: narrowedToMember(),
          traceId: "trace-member",
        });

        expect(outputOf(spans[0])).toBe(FULL_OUTPUT);
        expect(blobStore.getFromEventLog).toHaveBeenCalledWith(
          expect.objectContaining({ tenantId: MEMBER }),
        );
      });

      it("resolves the body under the member for one span", async () => {
        const service = SpanStorageService.create({
          repository: makeStubRepository([memberSpan]),
          blobResolutionDeps: { blobStore: memberBlobStore(), ioExtractionService: ioExtraction() },
        });

        const span = await service.findSpanById({
          authorization: narrowedToMember(),
          traceId: "trace-member",
          spanId: "span-member",
        });

        expect(outputOf(span)).toBe(FULL_OUTPUT);
      });
    });

    describe("when the proof still spans the aggregate and its member", () => {
      it("keeps the preview, reads no body and hides the reserved pointer", async () => {
        const blobStore = memberBlobStore();
        const service = SpanStorageService.create({
          repository: makeStubRepository([memberSpan]),
          blobResolutionDeps: { blobStore, ioExtractionService: ioExtraction() },
        });

        const spans = await service.getSpansByTraceId({
          authorization: aggregateReadsMember(),
          traceId: "trace-member",
        });

        expect(outputOf(spans[0])).toBe(PREVIEW_OUTPUT);
        expect(blobStore.getFromEventLog).not.toHaveBeenCalled();
        expect(JSON.stringify(spans[0]?.params ?? {})).not.toContain(EVENTREF_ATTR_PREFIX);
      });
    });
  });
});
