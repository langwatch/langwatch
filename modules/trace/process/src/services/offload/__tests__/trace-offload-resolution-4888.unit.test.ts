/**
 * @see #4888
 * Full blob resolution tests: covers eventref resolution, degradation to
 * preview, fast-path skip, and partial resolution across IO fields.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import { TraceCanonicalisationService } from "#services/trace-canonicalisation.service";

import { TraceOffloadResolutionService } from "../../trace-offload-resolution.service.ts";

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) =>
      fn({
        setAttributes: () => {
          /* noop */
        },
      }),
  }),
}));

import {
  EVENTREF_ATTR_PREFIX,
  type NormalizedSpan,
  NormalizedSpanKind,
  NormalizedStatusCode,
} from "@langwatch/trace-contract";

import {
  blobStoreReading,
  blobStoreResolving,
  blobStoreWithoutClickHouse,
} from "../../__tests__/support/trace-blob-store.support.ts";
import type { TraceBlobStoreService } from "../../trace-blob-store.service.ts";
import { BlobFieldNotFoundError, BlobNotFoundError } from "../../trace-blob-store.service.ts";
import { TraceIOExtractionService } from "../../trace-io-extraction.service.ts";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

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
    cost: null,
    nonBilledCost: null,
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

const realIOService = TraceIOExtractionService.create(TraceCanonicalisationService.create());

/** IO_PREVIEW_BYTES = 64 * 1024 = 65536. */
const IO_PREVIEW_BYTES = 65536;

/** 400 KB — matches the production repro shape in the plan. */
const LARGE_BYTE_COUNT = 400_000;

/**
 * Produces a LARGE_BYTE_COUNT-byte ASCII string whose byte length equals its
 * char length (no multibyte), for use in parameterized AC1 cases where we
 * want a deterministic large value.
 */
function makeLargeValue(byteCount: number = LARGE_BYTE_COUNT): string {
  return "x".repeat(byteCount);
}

/** UTF-8 boundary: emoji straddles the preview cut at 65536 bytes, so
 * preview loses the char but full resolution keeps it. */
const MULTIBYTE_BOUNDARY_EMOJI = "🎉"; // 4 UTF-8 bytes
const MULTIBYTE_BOUNDARY_VALUE = "a".repeat(IO_PREVIEW_BYTES - 2) + MULTIBYTE_BOUNDARY_EMOJI;

// The full value is 65538 bytes — over threshold.
// The preview would stop somewhere inside or just before the emoji.

// ---------------------------------------------------------------------------
// AC1 — full resolution byte-identical to event_log (parameterized over IO attr keys)
// ---------------------------------------------------------------------------

/** Full resolution returns >64KB offloaded fields byte-identical to event_log
 * across all IO attribute keys. */
const IO_ATTR_KEYS = [
  "langwatch.input",
  "langwatch.output",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
] as const;

describe("TraceOffloadResolutionService.resolveOffloadedTraces() — AC1: >64 KB field byte-identical after resolution", () => {
  for (const attrKey of IO_ATTR_KEYS) {
    describe(`given a span with offloaded ${attrKey} (400 KB)`, () => {
      const fullValue = makeLargeValue(LARGE_BYTE_COUNT);
      const previewValue = "x".repeat(IO_PREVIEW_BYTES) + "…";
      const eventId = `evt-${attrKey.replace(/\./g, "-")}`;

      const spanWithRef = makeSpan({
        spanAttributes: {
          [attrKey]: previewValue,
          [`${EVENTREF_ATTR_PREFIX}${attrKey}`]: JSON.stringify({
            field: attrKey,
            eventId,
          }),
        },
      });

      describe("when resolved", () => {
        let result: Awaited<
          ReturnType<typeof TraceOffloadResolutionService.resolveOffloadedTraces>
        >;

        beforeEach(async () => {
          const blobSvc = blobStoreResolving({ [attrKey]: fullValue });
          const logger = createMockLogger();

          result = await TraceOffloadResolutionService.resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          });
        });

        it(`${attrKey} — resolved span attribute is byte-identical to event_log value (Buffer.byteLength equal)`, async () => {
          const resolved = result.resolvedSpans[0]!.spanAttributes[attrKey] as string;
          expect(Buffer.byteLength(resolved, "utf8")).toBe(Buffer.byteLength(fullValue, "utf8"));
        });

        it(`${attrKey} — resolved span attribute value is === (strict equality) to event_log value`, async () => {
          const resolved = result.resolvedSpans[0]!.spanAttributes[attrKey] as string;
          expect(resolved).toBe(fullValue);
        });

        it(`${attrKey} — resolved value has no trailing truncation marker (…)`, async () => {
          const resolved = result.resolvedSpans[0]!.spanAttributes[attrKey] as string;
          expect(resolved.endsWith("…")).toBe(false);
        });

        it(`${attrKey} — resolved value length (bytes) is ${LARGE_BYTE_COUNT}, not 65537 (preview+ellipsis)`, async () => {
          const resolved = result.resolvedSpans[0]!.spanAttributes[attrKey] as string;
          // Must be the full 400 KB, not the 64 KB preview (65536) + "…" (3 bytes UTF-8 = 1 char)
          expect(Buffer.byteLength(resolved, "utf8")).toBeGreaterThan(IO_PREVIEW_BYTES);
          // And === the exact ingested byte count
          expect(Buffer.byteLength(resolved, "utf8")).toBe(LARGE_BYTE_COUNT);
        });

        it(`${attrKey} — anyResolved is true`, async () => {
          expect(result.anyResolved).toBe(true);
        });
      });
    });
  }

  // UTF-8 multibyte boundary sub-case (part of AC1)
  describe("given a span with offloaded langwatch.output where a 4-byte emoji straddles the 65536-byte boundary", () => {
    const attrKey = "langwatch.output";
    const fullValue = MULTIBYTE_BOUNDARY_VALUE;
    const previewValue = fullValue.slice(0, IO_PREVIEW_BYTES - 2) + "…"; // approximate

    const spanWithRef = makeSpan({
      spanAttributes: {
        [attrKey]: previewValue,
        [`${EVENTREF_ATTR_PREFIX}${attrKey}`]: JSON.stringify({
          field: attrKey,
          eventId: "evt-utf8-boundary",
        }),
      },
    });

    describe("when resolved", () => {
      let result: Awaited<ReturnType<typeof TraceOffloadResolutionService.resolveOffloadedTraces>>;

      beforeEach(async () => {
        const blobSvc = blobStoreResolving({ [attrKey]: fullValue });
        const logger = createMockLogger();

        result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });
      });

      it("the 4-byte emoji survives intact in the resolved span attribute (not split/corrupted)", async () => {
        const resolved = result.resolvedSpans[0]!.spanAttributes[attrKey] as string;
        // The emoji must be present and intact
        expect(resolved).toContain(MULTIBYTE_BOUNDARY_EMOJI);
      });

      it("byte length of resolved value equals byte length of the ingested value (UTF-8 preserved)", async () => {
        const resolved = result.resolvedSpans[0]!.spanAttributes[attrKey] as string;
        expect(Buffer.byteLength(resolved, "utf8")).toBe(Buffer.byteLength(fullValue, "utf8"));
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC3 — eventref resolves from event_log; reserved keys stripped
// ---------------------------------------------------------------------------

describe("TraceOffloadResolutionService.resolveOffloadedTraces() — AC3: eventref resolves + reserved keys stripped", () => {
  describe("given a span with a valid eventref (non-empty eventId)", () => {
    const attrKey = "langwatch.output";
    const fullValue = makeLargeValue();
    const spanWithRef = makeSpan({
      spanAttributes: {
        [attrKey]: "preview…",
        [`${EVENTREF_ATTR_PREFIX}${attrKey}`]: JSON.stringify({
          field: attrKey,
          eventId: "evt-ac3",
        }),
      },
    });

    describe("when resolved", () => {
      it("getFromEventLog is called exactly once (resolution attempted)", async () => {
        const blobSvc = blobStoreResolving({ [attrKey]: fullValue });
        const logger = createMockLogger();

        await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(blobSvc.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("no key with prefix 'langwatch.reserved.' remains in returned span attributes", async () => {
        const blobSvc = blobStoreResolving({ [attrKey]: fullValue });
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReserved = Object.keys(attrs).some((k) => k.startsWith("langwatch.reserved."));
        expect(hasReserved).toBe(false);
      });

      it("the resolved span attribute carries the full value from event_log", async () => {
        const blobSvc = blobStoreResolving({ [attrKey]: fullValue });
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(fullValue);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC4 — no-eventref fast path: identical output, anyResolved=false, 0 CH calls
// ---------------------------------------------------------------------------

describe("TraceOffloadResolutionService.resolveOffloadedTraces() — AC4: no-eventref trace reads identical to pre-feature", () => {
  describe("given a trace with NO eventref pointers in any span", () => {
    const spanClean = makeSpan({
      spanAttributes: {
        "langwatch.output": "a normal ≤64 KB output value",
      },
    });

    describe("when resolved with any caller opts", () => {
      it("getFromEventLog is called 0 times", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(blobSvc.getFromEventLog).toHaveBeenCalledTimes(0);
      });

      it("returns spans unchanged (same object reference)", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]).toBe(spanClean);
      });

      it("anyResolved is false", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });

      it("span attribute value is unchanged (preview equals original)", async () => {
        const blobSvc = blobStoreResolving({});
        const logger = createMockLogger();

        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes["langwatch.output"]).toBe(
          "a normal ≤64 KB output value",
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC5 — resolution failure degrades to preview, never throws/500
// ---------------------------------------------------------------------------

describe("TraceOffloadResolutionService.resolveOffloadedTraces() — AC5: resolution failure degrades to preview gracefully", () => {
  const attrKey = "langwatch.output";
  const previewValue = "x".repeat(IO_PREVIEW_BYTES) + "…";

  const spanWithRef = makeSpan({
    spanAttributes: {
      [attrKey]: previewValue,
      [`${EVENTREF_ATTR_PREFIX}${attrKey}`]: JSON.stringify({
        field: attrKey,
        eventId: "evt-fail",
      }),
    },
  });

  // --- BlobNotFoundError ---
  describe("given getFromEventLog throws BlobNotFoundError", () => {
    function blobNotFoundStore(): TraceBlobStoreService {
      return blobStoreReading(async () => {
        throw new BlobNotFoundError("evt-fail", attrKey, "proj-1");
      });
    }

    describe("when resolved", () => {
      it("does not throw", async () => {
        const logger = createMockLogger();
        await expect(
          TraceOffloadResolutionService.resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobNotFoundStore(),
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("returned span carries the original preview value (not empty, not undefined)", async () => {
        const logger = createMockLogger();
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(previewValue);
      });

      it("logger.warn is called at least once", async () => {
        const logger = createMockLogger();
        await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(logger.warn).toHaveBeenCalledOnce();
      });

      it("reserved eventref key is still stripped from returned span attributes", async () => {
        const logger = createMockLogger();
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReserved = Object.keys(attrs).some((k) => k.startsWith("langwatch.reserved."));
        expect(hasReserved).toBe(false);
      });
    });
  });

  // --- BlobFieldNotFoundError ---
  describe("given getFromEventLog throws BlobFieldNotFoundError", () => {
    function blobFieldNotFoundStore(): TraceBlobStoreService {
      return blobStoreReading(async () => {
        throw new BlobFieldNotFoundError("evt-fail", attrKey);
      });
    }

    describe("when resolved", () => {
      it("does not throw", async () => {
        const logger = createMockLogger();
        await expect(
          TraceOffloadResolutionService.resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobFieldNotFoundStore(),
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("returned span carries the original preview value", async () => {
        const logger = createMockLogger();
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobFieldNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(previewValue);
      });

      it("logger.warn is called at least once", async () => {
        const logger = createMockLogger();
        await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobFieldNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(logger.warn).toHaveBeenCalledOnce();
      });
    });
  });

  // --- CH-unconfigured (generic Error: "ClickHouseClient not configured") ---
  describe("given getFromEventLog throws because ClickHouseClient is not configured", () => {
    describe("when resolved", () => {
      it("does not throw", async () => {
        const logger = createMockLogger();
        await expect(
          TraceOffloadResolutionService.resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobStoreWithoutClickHouse(),
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("returned span carries the original preview value", async () => {
        const logger = createMockLogger();
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobStoreWithoutClickHouse(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(previewValue);
      });

      it("logger.warn is called (not silently swallowed)", async () => {
        const logger = createMockLogger();
        await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobStoreWithoutClickHouse(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(logger.warn).toHaveBeenCalledOnce();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC6 — partial/mixed: one resolved + one unresolved in same trace
// ---------------------------------------------------------------------------

describe("TraceOffloadResolutionService.resolveOffloadedTraces() — AC6: partial/mixed resolution in same trace", () => {
  const largeAttr = "langwatch.output";
  const smallAttr = "langwatch.input";
  const fullValue = makeLargeValue();
  const smallValue = "small ≤64 KB input value";
  const previewValue = "x".repeat(IO_PREVIEW_BYTES) + "…";

  describe("given one span with an offloaded eventref field AND one ≤64 KB field without eventref", () => {
    const mixedSpan = makeSpan({
      spanAttributes: {
        [largeAttr]: previewValue, // offloaded
        [`${EVENTREF_ATTR_PREFIX}${largeAttr}`]: JSON.stringify({
          field: largeAttr,
          eventId: "evt-large",
        }),
        [smallAttr]: smallValue, // not offloaded — no eventref
      },
    });

    describe("when resolved", () => {
      let result: Awaited<ReturnType<typeof TraceOffloadResolutionService.resolveOffloadedTraces>>;

      beforeEach(async () => {
        const blobSvc = blobStoreResolving({ [largeAttr]: fullValue });
        const logger = createMockLogger();

        result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [mixedSpan],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });
      });

      it("the offloaded field is resolved to the full value", async () => {
        expect(result.resolvedSpans[0]!.spanAttributes[largeAttr]).toBe(fullValue);
      });

      it("the ≤64 KB field is unchanged", async () => {
        expect(result.resolvedSpans[0]!.spanAttributes[smallAttr]).toBe(smallValue);
      });

      it("anyResolved is true", async () => {
        expect(result.anyResolved).toBe(true);
      });
    });
  });

  describe("given two eventrefs in the same span where the second one throws BlobNotFoundError", () => {
    const attrA = "langwatch.output";
    const attrB = "gen_ai.output.messages";

    const twoRefSpan = makeSpan({
      spanAttributes: {
        [attrA]: previewValue,
        [`${EVENTREF_ATTR_PREFIX}${attrA}`]: JSON.stringify({
          field: attrA,
          eventId: "evt-a",
        }),
        [attrB]: previewValue,
        [`${EVENTREF_ATTR_PREFIX}${attrB}`]: JSON.stringify({
          field: attrB,
          eventId: "evt-b",
        }),
      },
    });

    function partialBlobStore(): TraceBlobStoreService {
      return blobStoreReading(
        async ({
          field,
        }: {
          eventId: string;
          field: string;
          tenantId: string;
          aggregateType: string;
          aggregateId: string;
        }) => {
          if (field === attrA) return fullValue;
          throw new BlobNotFoundError("evt-b", field, "proj-1");
        },
      );
    }

    describe("when resolved", () => {
      it("the successfully resolved field carries the full value", async () => {
        const logger = createMockLogger();
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [twoRefSpan],
          blobStore: partialBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrA]).toBe(fullValue);
      });

      it("the failed field keeps the preview value", async () => {
        const logger = createMockLogger();
        const result = await TraceOffloadResolutionService.resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [twoRefSpan],
          blobStore: partialBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrB]).toBe(previewValue);
      });

      it("does not throw — the span-level error is absorbed", async () => {
        const logger = createMockLogger();
        await expect(
          TraceOffloadResolutionService.resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [twoRefSpan],
            blobStore: partialBlobStore(),
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });
    });
  });
});
