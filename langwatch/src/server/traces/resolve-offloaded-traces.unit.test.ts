/**
 * Unit tests for the resolveOffloadedTraces helper — per-trace span-level
 * blob ref resolution and TraceIO recompute (read-resolution half of ADR-021,
 * decision B: read-time recompute). Each test covers one assertion.
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { describe, it, expect, vi } from "vitest";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
// Mock langwatch so the tracer's withActiveSpan is a passthrough in tests.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => {} }),
  }),
}));
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { BLOB_REF_ATTR_PREFIX } from "~/server/app-layer/traces/blob-ref-attributes";
import type { SpanBlobResolutionService } from "~/server/app-layer/traces/span-blob-resolution.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { BlobIntegrityError, type TraceBlobRef } from "~/server/app-layer/traces/blob-store.service";
import { resolveOffloadedTraces } from "./resolve-offloaded-traces";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const testRef = (key: string): TraceBlobRef => ({
  key,
  size: 100,
  sha256: "abc123",
  encoding: "utf-8",
});

function makeSpan(
  overrides: Partial<NormalizedSpan> & {
    spanAttributes?: Record<string, unknown>;
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
    startTimeUnixMs: 0,
    endTimeUnixMs: 1000,
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
    ...overrides,
  };
}

function createMockLogger() {
  return {
    warn: vi.fn(),
    error: vi.fn(),
    info: vi.fn(),
    debug: vi.fn(),
  };
}

function fakeBlobResolutionService(
  resolvedValues: Record<string, string>,
): SpanBlobResolutionService {
  return {
    resolve: vi.fn(
      async ({
        attributes,
        blobRefs,
      }: {
        projectId: string;
        attributes: Record<string, string>;
        blobRefs: Record<string, TraceBlobRef>;
      }) => {
        const out = { ...attributes };
        for (const attrKey of Object.keys(blobRefs)) {
          const key = blobRefs[attrKey]!.key;
          if (key in resolvedValues) {
            out[attrKey] = resolvedValues[key]!;
          }
        }
        return out;
      },
    ),
  } as unknown as SpanBlobResolutionService;
}

const realIOService = new TraceIOExtractionService();

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces()", () => {
  describe("given a trace whose winning span has a reserved blob-ref", () => {
    const fullOutput = "The full 50 KB output value that was offloaded to S3";
    const ref = testRef("trace-blobs/proj-1/trace-1/span-1/langwatch.output");

    const spanWithRef = makeSpan({
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${BLOB_REF_ATTR_PREFIX}langwatch.output`]:
          JSON.stringify(ref),
      },
    });

    describe("when resolved", () => {
      it("resolved span attributes contain the full value, not the preview", async () => {
        const blobSvc = fakeBlobResolutionService({ [ref.key]: fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          result.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe(fullOutput);
      });

      it("reserved blob-ref keys are stripped from the resolved span attributes", async () => {
        const blobSvc = fakeBlobResolutionService({ [ref.key]: fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasRef = Object.keys(attrs).some((k) =>
          k.startsWith(BLOB_REF_ATTR_PREFIX),
        );
        expect(hasRef).toBe(false);
      });

      it("trace.output is recomputed from the full span value", async () => {
        const blobSvc = fakeBlobResolutionService({ [ref.key]: fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.recomputedOutput?.text).toBe(fullOutput);
      });

      it("anyResolved is true", async () => {
        const blobSvc = fakeBlobResolutionService({ [ref.key]: fullOutput });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(true);
      });
    });
  });

  describe("given a trace with no blob refs in any span", () => {
    const spanClean = makeSpan({
      spanAttributes: {
        "langwatch.output": "a normal non-offloaded output",
      },
    });

    describe("when resolved", () => {
      it("returns spans unchanged", async () => {
        const blobSvc = fakeBlobResolutionService({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]).toBe(spanClean);
      });

      it("calls SpanBlobResolutionService.resolve zero times", async () => {
        const blobSvc = fakeBlobResolutionService({});
        const resolveSpy = blobSvc.resolve as ReturnType<typeof vi.fn>;
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(resolveSpy).not.toHaveBeenCalled();
      });

      it("anyResolved is false", async () => {
        const blobSvc = fakeBlobResolutionService({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });
    });
  });

  describe("given a missing blob (BlobStore.get throws a NoSuchKey error)", () => {
    const ref = testRef("trace-blobs/proj-1/trace-1/span-1/langwatch.output");

    const spanWithRef = makeSpan({
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${BLOB_REF_ATTR_PREFIX}langwatch.output`]:
          JSON.stringify(ref),
      },
    });

    function failingBlobResolutionService(): SpanBlobResolutionService {
      const noSuchKey = Object.assign(new Error("NoSuchKey"), {
        name: "NoSuchKey",
      });
      return {
        resolve: vi.fn(async () => {
          throw noSuchKey;
        }),
      } as unknown as SpanBlobResolutionService;
    }

    describe("when resolved", () => {
      it("does not throw — returns normally", async () => {
        const blobSvc = failingBlobResolutionService();
        const logger = createMockLogger();

        await expect(
          resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobResolutionService: blobSvc,
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("keeps the preview value intact in the span attributes", async () => {
        const blobSvc = failingBlobResolutionService();
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          result.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("preview…");
      });

      it("logs a warning at warn level", async () => {
        const blobSvc = failingBlobResolutionService();
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(logger.warn).toHaveBeenCalledOnce();
      });

      it("anyResolved is false (span was not resolved)", async () => {
        const blobSvc = failingBlobResolutionService();
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });
    });
  });

  describe("given a span with a reserved blob-ref attribute set to malformed JSON", () => {
    const spanWithMalformedRef = makeSpan({
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${BLOB_REF_ATTR_PREFIX}langwatch.output`]: 'not-json{',
      },
    });

    describe("when resolved", () => {
      it("strips the reserved blob-ref key from returned span attributes", async () => {
        const blobSvc = fakeBlobResolutionService({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithMalformedRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReservedKey = Object.keys(attrs).some((k) =>
          k.startsWith(BLOB_REF_ATTR_PREFIX),
        );
        expect(hasReservedKey).toBe(false);
      });
    });
  });

  describe("given a BlobIntegrityError (SHA-256 mismatch)", () => {
    const ref = testRef("trace-blobs/proj-1/trace-1/span-1/langwatch.output");

    const spanWithRef = makeSpan({
      spanAttributes: {
        "langwatch.output": "preview…",
        [`${BLOB_REF_ATTR_PREFIX}langwatch.output`]: JSON.stringify(ref),
      },
    });

    function integrityFailingBlobResolutionService(): SpanBlobResolutionService {
      const integrityError = new BlobIntegrityError(
        ref.key,
        "expectedhash",
        "actualhash",
      );
      return {
        resolve: vi.fn(async () => {
          throw integrityError;
        }),
      } as unknown as SpanBlobResolutionService;
    }

    describe("when resolved", () => {
      it("does not throw — returns normally with preview intact", async () => {
        const blobSvc = integrityFailingBlobResolutionService();
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes["langwatch.output"]).toBe(
          "preview…",
        );
      });

      it("logs at error level, not warn", async () => {
        const blobSvc = integrityFailingBlobResolutionService();
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobResolutionService: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(logger.error).toHaveBeenCalledOnce();
        expect(logger.warn).not.toHaveBeenCalled();
      });
    });
  });
});
