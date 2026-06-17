/**
 * TDD-red tests for issue #4888 — opt-in full blob resolution on the trace-detail
 * read path.
 *
 * These tests target the resolver layer (resolveOffloadedTraces) and are written
 * BEFORE the TraceService full-flag wiring lands. They encode the AC behaviours
 * that must become green once the fix is in.
 *
 * ACs covered here:
 *   AC1 — full resolution: >64 KB span attribute byte-identical to event_log,
 *          parameterized over {langwatch.input, langwatch.output,
 *          gen_ai.input.messages, gen_ai.output.messages}, UTF-8 boundary char.
 *   AC3 — eventref resolves + reserved langwatch.reserved.* keys stripped.
 *   AC4 — no-eventref fast path: identical output, anyResolved=false, 0 CH calls.
 *   AC5 — resolution failure (BlobNotFoundError / BlobFieldNotFoundError /
 *          CH-unconfigured) degrades to preview, never throws, logger.warn called.
 *   AC6 — partial/mixed: resolved + un-resolved in same trace.
 *
 * AC2 (list path spy) and AC7 (cross-tenant) are covered in
 * trace-service-full-flag.unit.test.ts (TraceService layer).
 * AC8 is a git-diff review check — no runtime test.
 *
 * Conventions matched from resolve-offloaded-traces.unit.test.ts:
 *   - vitest, vi.mock("langwatch", ...) tracer passthrough
 *   - BDD nested describe (given / when)
 *   - One expectation per it()
 *   - No "should" in test names
 *   - fakeBlobStore / makeSpan helpers consistent with sibling test file
 */

import { describe, it, expect, vi } from "vitest";

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
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import {
  BlobNotFoundError,
  BlobFieldNotFoundError,
} from "~/server/app-layer/traces/blob-store.service";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import { resolveOffloadedTraces } from "./resolve-offloaded-traces";

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

function fakeBlobStore(resolvedValues: Record<string, string>): BlobStore {
  return {
    getFromEventLog: vi.fn(
      async ({
        field,
      }: {
        eventId: string;
        field: string;
        tenantId: string;
        aggregateType: string;
        aggregateId: string;
      }) => {
        if (field in resolvedValues) return resolvedValues[field]!;
        throw new BlobNotFoundError("evt-test", field, "proj-1");
      },
    ),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

/**
 * Builds a BlobStore whose getFromEventLog throws "ClickHouseClient not
 * configured" — simulates a CH-unconfigured deployment (AC5 third arm).
 */
function unconfiguredBlobStore(): BlobStore {
  return {
    getFromEventLog: vi.fn(async () => {
      throw new Error(
        "ClickHouseClient not configured — cannot read from event_log (ADR-022)",
      );
    }),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

const realIOService = new TraceIOExtractionService();

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

/**
 * AC1 UTF-8 multibyte boundary: a string whose boundary character straddles the
 * 65536-byte split.  The preview would cut before the char, losing it; full
 * resolution returns it intact.
 *
 * We build a string where bytes 0..65533 are ASCII "a" (1 byte each) and then
 * append a 4-byte emoji (🎉 = U+1F389, 4 UTF-8 bytes) so the emoji starts at
 * byte 65534 and ends at byte 65537 — straddling the IO_PREVIEW_BYTES boundary.
 * Total: 65534 ASCII bytes + 4 emoji bytes = 65538 bytes (just over threshold).
 * A preview truncating at 65536 MUST cut mid-emoji; full resolution returns the
 * emoji intact.
 */
const MULTIBYTE_BOUNDARY_EMOJI = "🎉"; // 4 UTF-8 bytes
const MULTIBYTE_BOUNDARY_VALUE =
  "a".repeat(IO_PREVIEW_BYTES - 2) + MULTIBYTE_BOUNDARY_EMOJI;

// The full value is 65538 bytes — over threshold.
// The preview would stop somewhere inside or just before the emoji.

// ---------------------------------------------------------------------------
// AC1 — full resolution byte-identical to event_log (parameterized over IO attr keys)
// ---------------------------------------------------------------------------

/**
 * AC1: full=true on a detail surface resolves a >64 KB offloaded field:
 * span attribute byte-identical to event_log.EventPayload.
 * Parameterized over {langwatch.input, langwatch.output,
 * gen_ai.input.messages, gen_ai.output.messages}.
 */
const IO_ATTR_KEYS = [
  "langwatch.input",
  "langwatch.output",
  "gen_ai.input.messages",
  "gen_ai.output.messages",
] as const;

describe("resolveOffloadedTraces() — AC1: >64 KB field byte-identical after resolution", () => {
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
        it(`${attrKey} — resolved span attribute is byte-identical to event_log value (Buffer.byteLength equal)`, async () => {
          const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
          const logger = createMockLogger();

          const result = await resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          });

          const resolved = result.resolvedSpans[0]!.spanAttributes[
            attrKey
          ] as string;
          expect(Buffer.byteLength(resolved, "utf8")).toBe(
            Buffer.byteLength(fullValue, "utf8"),
          );
        });

        it(`${attrKey} — resolved span attribute value is === (strict equality) to event_log value`, async () => {
          const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
          const logger = createMockLogger();

          const result = await resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          });

          const resolved = result.resolvedSpans[0]!.spanAttributes[
            attrKey
          ] as string;
          expect(resolved).toBe(fullValue);
        });

        it(`${attrKey} — resolved value has no trailing truncation marker (…)`, async () => {
          const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
          const logger = createMockLogger();

          const result = await resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          });

          const resolved = result.resolvedSpans[0]!.spanAttributes[
            attrKey
          ] as string;
          expect(resolved.endsWith("…")).toBe(false);
        });

        it(`${attrKey} — resolved value length (bytes) is ${LARGE_BYTE_COUNT}, not 65537 (preview+ellipsis)`, async () => {
          const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
          const logger = createMockLogger();

          const result = await resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          });

          const resolved = result.resolvedSpans[0]!.spanAttributes[
            attrKey
          ] as string;
          // Must be the full 400 KB, not the 64 KB preview (65536) + "…" (3 bytes UTF-8 = 1 char)
          expect(Buffer.byteLength(resolved, "utf8")).toBeGreaterThan(
            IO_PREVIEW_BYTES,
          );
          // And === the exact ingested byte count
          expect(Buffer.byteLength(resolved, "utf8")).toBe(LARGE_BYTE_COUNT);
        });

        it(`${attrKey} — anyResolved is true`, async () => {
          const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
          const logger = createMockLogger();

          const result = await resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: blobSvc,
            ioExtractionService: realIOService,
            logger,
          });

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
      it("the 4-byte emoji survives intact in the resolved span attribute (not split/corrupted)", async () => {
        const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const resolved = result.resolvedSpans[0]!.spanAttributes[
          attrKey
        ] as string;
        // The emoji must be present and intact
        expect(resolved).toContain(MULTIBYTE_BOUNDARY_EMOJI);
      });

      it("byte length of resolved value equals byte length of the ingested value (UTF-8 preserved)", async () => {
        const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const resolved = result.resolvedSpans[0]!.spanAttributes[
          attrKey
        ] as string;
        expect(Buffer.byteLength(resolved, "utf8")).toBe(
          Buffer.byteLength(fullValue, "utf8"),
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC3 — eventref resolves from event_log; reserved keys stripped
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces() — AC3: eventref resolves + reserved keys stripped", () => {
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
        const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(blobSvc.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("no key with prefix 'langwatch.reserved.' remains in returned span attributes", async () => {
        const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReserved = Object.keys(attrs).some((k) =>
          k.startsWith("langwatch.reserved."),
        );
        expect(hasReserved).toBe(false);
      });

      it("the resolved span attribute carries the full value from event_log", async () => {
        const blobSvc = fakeBlobStore({ [attrKey]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(
          fullValue,
        );
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC4 — no-eventref fast path: identical output, anyResolved=false, 0 CH calls
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces() — AC4: no-eventref trace reads identical to pre-feature", () => {
  describe("given a trace with NO eventref pointers in any span", () => {
    const spanClean = makeSpan({
      spanAttributes: {
        "langwatch.output": "a normal ≤64 KB output value",
      },
    });

    describe("when resolved with any caller opts", () => {
      it("getFromEventLog is called 0 times", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(blobSvc.getFromEventLog).toHaveBeenCalledTimes(0);
      });

      it("returns spans unchanged (same object reference)", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]).toBe(spanClean);
      });

      it("anyResolved is false", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.anyResolved).toBe(false);
      });

      it("span attribute value is unchanged (preview equals original)", async () => {
        const blobSvc = fakeBlobStore({});
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanClean],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(
          result.resolvedSpans[0]!.spanAttributes["langwatch.output"],
        ).toBe("a normal ≤64 KB output value");
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC5 — resolution failure degrades to preview, never throws/500
// ---------------------------------------------------------------------------

describe("resolveOffloadedTraces() — AC5: resolution failure degrades to preview gracefully", () => {
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
    function blobNotFoundStore(): BlobStore {
      return {
        getFromEventLog: vi.fn(async () => {
          throw new BlobNotFoundError("evt-fail", attrKey, "proj-1");
        }),
        putSpool: vi.fn(),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;
    }

    describe("when resolved", () => {
      it("does not throw", async () => {
        const logger = createMockLogger();
        await expect(
          resolveOffloadedTraces({
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
        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(
          previewValue,
        );
      });

      it("logger.warn is called at least once", async () => {
        const logger = createMockLogger();
        await resolveOffloadedTraces({
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
        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        const attrs = result.resolvedSpans[0]!.spanAttributes;
        const hasReserved = Object.keys(attrs).some((k) =>
          k.startsWith("langwatch.reserved."),
        );
        expect(hasReserved).toBe(false);
      });
    });
  });

  // --- BlobFieldNotFoundError ---
  describe("given getFromEventLog throws BlobFieldNotFoundError", () => {
    function blobFieldNotFoundStore(): BlobStore {
      return {
        getFromEventLog: vi.fn(async () => {
          throw new BlobFieldNotFoundError("evt-fail", attrKey);
        }),
        putSpool: vi.fn(),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;
    }

    describe("when resolved", () => {
      it("does not throw", async () => {
        const logger = createMockLogger();
        await expect(
          resolveOffloadedTraces({
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
        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: blobFieldNotFoundStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(
          previewValue,
        );
      });

      it("logger.warn is called at least once", async () => {
        const logger = createMockLogger();
        await resolveOffloadedTraces({
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
          resolveOffloadedTraces({
            projectId: "proj-1",
            normalizedSpans: [spanWithRef],
            blobStore: unconfiguredBlobStore(),
            ioExtractionService: realIOService,
            logger,
          }),
        ).resolves.not.toThrow();
      });

      it("returned span carries the original preview value", async () => {
        const logger = createMockLogger();
        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: unconfiguredBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrKey]).toBe(
          previewValue,
        );
      });

      it("logger.warn is called (not silently swallowed)", async () => {
        const logger = createMockLogger();
        await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [spanWithRef],
          blobStore: unconfiguredBlobStore(),
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

describe("resolveOffloadedTraces() — AC6: partial/mixed resolution in same trace", () => {
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
      it("the offloaded field is resolved to the full value", async () => {
        const blobSvc = fakeBlobStore({ [largeAttr]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [mixedSpan],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes[largeAttr]).toBe(
          fullValue,
        );
      });

      it("the ≤64 KB field is unchanged", async () => {
        const blobSvc = fakeBlobStore({ [largeAttr]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [mixedSpan],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

        expect(result.resolvedSpans[0]!.spanAttributes[smallAttr]).toBe(
          smallValue,
        );
      });

      it("anyResolved is true", async () => {
        const blobSvc = fakeBlobStore({ [largeAttr]: fullValue });
        const logger = createMockLogger();

        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [mixedSpan],
          blobStore: blobSvc,
          ioExtractionService: realIOService,
          logger,
        });

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

    function partialBlobStore(): BlobStore {
      return {
        getFromEventLog: vi.fn(
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
        ),
        putSpool: vi.fn(),
        getSpool: vi.fn(),
        deleteSpool: vi.fn(),
      } as unknown as BlobStore;
    }

    describe("when resolved", () => {
      it("the successfully resolved field carries the full value", async () => {
        const logger = createMockLogger();
        const result = await resolveOffloadedTraces({
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
        const result = await resolveOffloadedTraces({
          projectId: "proj-1",
          normalizedSpans: [twoRefSpan],
          blobStore: partialBlobStore(),
          ioExtractionService: realIOService,
          logger,
        });
        expect(result.resolvedSpans[0]!.spanAttributes[attrB]).toBe(
          previewValue,
        );
      });

      it("does not throw — the span-level error is absorbed", async () => {
        const logger = createMockLogger();
        await expect(
          resolveOffloadedTraces({
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
