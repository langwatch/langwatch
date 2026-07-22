/**
 * Unit tests for TraceSummaryService.getByTraceId's `full` option (ADR-022).
 *
 * BDD structure: given/when nested describes, action-based it() names.
 */
import { describe, expect, it, vi } from "vitest";

// TraceIOExtractionService wraps its methods in getLangWatchTracer spans.
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttributes: () => void }) => unknown,
    ) => fn({ setAttributes: () => {} }),
  }),
}));

import type { BlobStore } from "../blob-store.service";
import { BlobNotFoundError } from "../blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "../lean-for-projection";
import { TraceIOExtractionService } from "../trace-io-extraction.service";
import type { SpanStorageRepository } from "../repositories/span-storage.repository";
import {
  NormalizedSpanKind,
  NormalizedStatusCode,
  type NormalizedSpan,
} from "~/server/event-sourcing/pipelines/trace-processing/schemas/spans";
import { TraceSummaryService } from "../trace-summary.service";

// ---------------------------------------------------------------------------
// Helpers — mirrors resolve-offloaded-traces.unit.test.ts's fixtures.
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
  } as NormalizedSpan;
}

function fakeBlobStore(resolvedValues: Record<string, string>): BlobStore {
  return {
    getFromEventLog: vi.fn(
      async ({ field }: { field: string }) => {
        if (field in resolvedValues) return resolvedValues[field]!;
        throw new BlobNotFoundError("evt-test", field, "proj-1");
      },
    ),
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore;
}

const realIOService = new TraceIOExtractionService();

const makeSummary = () => ({
  traceId: "trace-1",
  occurredAt: Date.now(),
  computedInput: "preview-input…",
  computedOutput: "preview-output…",
  errorMessage: null,
  spanCount: 1,
  totalDurationMs: 120,
  attributes: { "service.name": "svc" },
});

function makeSpanRepo(spans: NormalizedSpan[]): SpanStorageRepository {
  return {
    getNormalizedSpansByTraceId: vi.fn().mockResolvedValue(spans),
  } as unknown as SpanStorageRepository;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("TraceSummaryService.getByTraceId({ full: true })", () => {
  describe("given no full-resolution deps were supplied at construction", () => {
    it("returns the stored preview unchanged", async () => {
      const service = new TraceSummaryService({
        findByTraceId: vi.fn().mockResolvedValue(makeSummary()),
        upsert: vi.fn(),
      } as never);

      const result = await service.getByTraceId("proj-1", "trace-1", {
        full: true,
      });

      expect(result.computedInput).toBe("preview-input…");
      expect(result.computedOutput).toBe("preview-output…");
    });
  });

  describe("given full-resolution deps and a span carrying an eventref pointer", () => {
    const fullInput = "The full original input that was offloaded to event_log";
    const spanWithRef = makeSpan({
      spanAttributes: {
        "langwatch.input": "preview…",
        [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
          field: "langwatch.input",
          eventId: "evt-001",
        }),
      },
    });

    describe("when full is requested", () => {
      it("returns the recomputed full input instead of the stored preview", async () => {
        const service = new TraceSummaryService(
          {
            findByTraceId: vi.fn().mockResolvedValue(makeSummary()),
            upsert: vi.fn(),
          } as never,
          {
            spanStorageRepository: makeSpanRepo([spanWithRef]),
            blobStore: fakeBlobStore({ "langwatch.input": fullInput }),
            ioExtractionService: realIOService,
          },
        );

        const result = await service.getByTraceId("proj-1", "trace-1", {
          full: true,
        });

        expect(result.computedInput).toBe(fullInput);
      });
    });

    describe("when full is not requested", () => {
      it("returns the stored preview and never reads spans", async () => {
        const spanRepo = makeSpanRepo([spanWithRef]);
        const service = new TraceSummaryService(
          {
            findByTraceId: vi.fn().mockResolvedValue(makeSummary()),
            upsert: vi.fn(),
          } as never,
          {
            spanStorageRepository: spanRepo,
            blobStore: fakeBlobStore({ "langwatch.input": fullInput }),
            ioExtractionService: realIOService,
          },
        );

        const result = await service.getByTraceId("proj-1", "trace-1");

        expect(result.computedInput).toBe("preview-input…");
        expect(spanRepo.getNormalizedSpansByTraceId).not.toHaveBeenCalled();
      });
    });
  });

  describe("given full-resolution deps but no span carries an eventref", () => {
    it("returns the stored preview without any event_log read", async () => {
      const plainSpan = makeSpan({
        spanAttributes: { "langwatch.input": "small input, never offloaded" },
      });
      const blobStore = fakeBlobStore({});
      const service = new TraceSummaryService(
        {
          findByTraceId: vi.fn().mockResolvedValue(makeSummary()),
          upsert: vi.fn(),
        } as never,
        {
          spanStorageRepository: makeSpanRepo([plainSpan]),
          blobStore,
          ioExtractionService: realIOService,
        },
      );

      const result = await service.getByTraceId("proj-1", "trace-1", {
        full: true,
      });

      expect(result.computedInput).toBe("preview-input…");
      expect(blobStore.getFromEventLog).not.toHaveBeenCalled();
    });
  });

  describe("given the eventref points at a missing event_log row", () => {
    it("falls back to the stored preview instead of throwing", async () => {
      const spanWithBadRef = makeSpan({
        spanAttributes: {
          "langwatch.input": "preview…",
          [`${EVENTREF_ATTR_PREFIX}langwatch.input`]: JSON.stringify({
            field: "langwatch.input",
            eventId: "evt-missing",
          }),
        },
      });
      const service = new TraceSummaryService(
        {
          findByTraceId: vi.fn().mockResolvedValue(makeSummary()),
          upsert: vi.fn(),
        } as never,
        {
          spanStorageRepository: makeSpanRepo([spanWithBadRef]),
          blobStore: fakeBlobStore({}), // nothing resolves — always throws BlobNotFoundError
          ioExtractionService: realIOService,
        },
      );

      const result = await service.getByTraceId("proj-1", "trace-1", {
        full: true,
      });

      expect(result.computedInput).toBe("preview-input…");
    });
  });

  describe("given the spans read itself throws", () => {
    it("falls back to the stored preview instead of throwing", async () => {
      const service = new TraceSummaryService(
        {
          findByTraceId: vi.fn().mockResolvedValue(makeSummary()),
          upsert: vi.fn(),
        } as never,
        {
          spanStorageRepository: {
            getNormalizedSpansByTraceId: vi
              .fn()
              .mockRejectedValue(new Error("ClickHouse unavailable")),
          } as unknown as SpanStorageRepository,
          blobStore: fakeBlobStore({}),
          ioExtractionService: realIOService,
        },
      );

      const result = await service.getByTraceId("proj-1", "trace-1", {
        full: true,
      });

      expect(result.computedInput).toBe("preview-input…");
    });
  });
});
