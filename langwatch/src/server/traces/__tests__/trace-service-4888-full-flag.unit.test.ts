/**
 * TDD tests for issue #4888 — TraceService full-flag read path, exercised at
 * the REAL seam.
 *
 * Resolution lives in the ClickHouse layer (`resolveAndMerge` →
 * `resolveOffloadedTraces`), gated per-call by a `resolveBlobs` flag that
 * `TraceService.getById` / `getTracesWithSpans` forward from `opts.full`.
 * Resolution operates on NormalizedSpan with FLAT `spanAttributes` carrying the
 * `langwatch.reserved.eventref.*` keys — the only level where the eventref is
 * present (the legacy mapper strips it and nests the rest under `params`).
 *
 * So these tests mock ONLY the raw ClickHouse client (summary + span rows) and
 * let the REAL CH service + REAL resolver run, with a fake BlobStore providing
 * `getFromEventLog`. That exercises the gate at the layer it actually lives —
 * unlike a TS-layer mock, which would pass on a shape production never produces.
 *
 * The CH-layer mapper-crossing describe block at the bottom exercises
 * `ClickHouseTraceService.getTracesWithSpans` directly (via `buildService`) to
 * prove the full value survives `mapNormalizedSpanToSpan` (params.langwatch.output
 * byte-identical, no reserved-key leak, trace.output widens past 64 KB).
 * These cases were previously in `trace-service-4888-full-flag.integration.test.ts`
 * but that file mocked ALL boundaries, so it needed no Docker and belonged here.
 *
 * ACs covered:
 *   AC1 — full=true triggers resolution (getFromEventLog called ≥ 1 time) and
 *          the resolved span attribute is the full 400 KB value.
 *   AC2 — full=false (or omitted) → getFromEventLog called 0 times (preview).
 *   AC7 — cross-tenant: same EventId, wrong tenant → BlobNotFoundError → preview
 *          returned; getFromEventLog called with the reading tenant's id.
 *
 * BDD structure: describe(given/when) → it() — assertions grouped per behavior.
 * No "should" in test names.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { BlobStore } from "~/server/app-layer/traces/blob-store.service";
import { BlobNotFoundError } from "~/server/app-layer/traces/blob-store.service";
import { EVENTREF_ATTR_PREFIX } from "~/server/app-layer/traces/lean-for-projection";
import { TraceIOExtractionService } from "~/server/app-layer/traces/trace-io-extraction.service";
import type { Protections } from "~/server/traces/protections";
import { createLogger } from "~/utils/logger/server";
import { ClickHouseTraceService } from "../clickhouse-trace.service";
import { resolveOffloadedTraces } from "../resolve-offloaded-traces";
import { TraceService } from "../trace.service";
import {
  makeSpanRowWithEventRef,
  makeSummaryRow,
} from "./fixtures/ch-row-fixtures";

// ---------------------------------------------------------------------------
// Hoisted mocks — mock only the raw CH SQL boundary so the real resolver runs
// ---------------------------------------------------------------------------

const { mockClickHouseQuery } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ query: mockClickHouseQuery }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("~/server/filters/clickhouse", () => ({
  generateClickHouseFilterConditions: () => ({
    conditions: [],
    params: {},
    hasUnsupportedFilters: false,
  }),
}));

vi.mock("~/server/evaluations/evaluation.service", () => ({
  EvaluationService: Object.assign(vi.fn(), {
    create: () => ({}),
  }),
}));

vi.mock("../elasticsearch-trace.service", () => ({
  ElasticsearchTraceService: Object.assign(vi.fn(), {
    create: () => ({}),
  }),
}));

// Mirror the sibling test's tracer passthrough — the span exposes BOTH
// setAttribute (singular) and setAttributes (plural), matching the real OTel
// Span interface (TraceIOExtractionService calls setAttributes).
vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const fakeSpan = {
        setAttribute: () => {},
        setAttributes: () => {},
        addEvent: () => {},
      };
      return (fn as (s: typeof fakeSpan) => Promise<unknown>)(fakeSpan);
    },
  }),
}));

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const IO_PREVIEW_BYTES = 65536;
const LARGE_BYTE_COUNT = 400_000;

const protections: Protections = {
  canSeeCosts: true,
  canSeePiiData: true,
  canSeeTopics: true,
  // Required for trace.input/output to survive applyTraceProtections — without
  // these the redaction layer strips trace.output to undefined.
  canSeeCapturedInput: true,
  canSeeCapturedOutput: true,
} as Protections;

const PROJECT_ID_A = "tenant-aaa";
const PROJECT_ID_B = "tenant-bbb";
const TRACE_ID = "trace-001";

const FULL_OUTPUT = "x".repeat(LARGE_BYTE_COUNT);
const PREVIEW_OUTPUT = "x".repeat(IO_PREVIEW_BYTES) + "…";

// ---------------------------------------------------------------------------
// Mock setup helper
// ---------------------------------------------------------------------------

/** Set up the two CH queries fetchTracesWithSpansJoined fires (summary, spans). */
function setupGetTracesWithSpansMocks(tenantId = PROJECT_ID_A) {
  mockClickHouseQuery
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSummaryRow(TRACE_ID, {
            computedOutput: `{"type":"text","value":${JSON.stringify(PREVIEW_OUTPUT)}}`,
          }),
        ]),
    })
    .mockResolvedValueOnce({
      json: () =>
        Promise.resolve([
          makeSpanRowWithEventRef(TRACE_ID, "span-1", {
            tenantId,
            previewOutput: PREVIEW_OUTPUT,
          }),
        ]),
    });
}

// ---------------------------------------------------------------------------
// Tenant-scoped BlobStore fake
// ---------------------------------------------------------------------------

/**
 * getFromEventLog resolves the full value only for PROJECT_ID_A; any other
 * tenant gets a BlobNotFoundError, mirroring the real TenantId WHERE predicate.
 */
function makeTenantScopedBlobStore(): BlobStore & {
  getFromEventLog: ReturnType<typeof vi.fn>;
} {
  const getFromEventLog = vi.fn(
    async ({ tenantId, field }: { tenantId: string; field: string }) => {
      if (tenantId === PROJECT_ID_A && field === "langwatch.output") {
        return FULL_OUTPUT;
      }
      throw new BlobNotFoundError("evt-001", field, tenantId);
    },
  );

  return {
    getFromEventLog,
    putSpool: vi.fn(),
    getSpool: vi.fn(),
    deleteSpool: vi.fn(),
  } as unknown as BlobStore & { getFromEventLog: ReturnType<typeof vi.fn> };
}

function makeService(blobStore: BlobStore): TraceService {
  return new TraceService({} as never, {
    blobStore,
    ioExtractionService: new TraceIOExtractionService(),
  });
}

// ---------------------------------------------------------------------------
// AC1 — full=true triggers resolution at the CH layer (TraceService level)
// ---------------------------------------------------------------------------

describe("TraceService — AC1: getById with full=true resolves from event_log", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("given a trace whose span carries an offloaded langwatch.output eventref", () => {
    describe("when getById is called with opts { full: true }", () => {
      it("calls BlobStore.getFromEventLog at least once (resolution runs)", async () => {
        setupGetTracesWithSpansMocks();

        await service.getById(PROJECT_ID_A, TRACE_ID, protections, {
          full: true,
        });

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("the resolved span attribute is defined", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        const span = trace?.spans?.[0] as
          | { params?: { langwatch?: { output?: string } } }
          | undefined;
        expect(span?.params?.langwatch?.output).toBeDefined();
      });

      it("the resolved span attribute byte length equals the full 400 KB value", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        const span = trace?.spans?.[0] as
          | { params?: { langwatch?: { output?: string } } }
          | undefined;
        const resolved = span?.params?.langwatch?.output;
        expect(Buffer.byteLength(resolved!, "utf8")).toBe(LARGE_BYTE_COUNT);
      });

      it("no langwatch.reserved.* key survives in the returned span (key-level check)", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        const span = trace?.spans?.[0] as
          | { params?: { langwatch?: { reserved?: unknown } } }
          | undefined;
        // Key-level: reserved namespace must be absent from the mapped span
        expect(span?.params?.langwatch?.reserved).toBeUndefined();
        // Also check that no flat key under params carries the reserved prefix
        const flatParams = span?.params as Record<string, unknown> | undefined;
        if (flatParams) {
          const allKeys = Object.keys(flatParams);
          expect(
            allKeys.every((k) => !k.startsWith(EVENTREF_ATTR_PREFIX)),
          ).toBe(true);
        }
      });

      it("the recomputed trace.output value equals the full 400 KB value", async () => {
        setupGetTracesWithSpansMocks();

        const trace = await service.getById(
          PROJECT_ID_A,
          TRACE_ID,
          protections,
          { full: true },
        );

        expect(trace?.output?.value).toBe(FULL_OUTPUT);
      });
    });
  });
});

describe("TraceService — AC1: getTracesWithSpans with full=true resolves from event_log", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("given a trace list with an offloaded langwatch.output eventref", () => {
    describe("when getTracesWithSpans is called with opts { full: true }", () => {
      it("calls BlobStore.getFromEventLog at least once", async () => {
        setupGetTracesWithSpansMocks();

        await service.getTracesWithSpans(
          PROJECT_ID_A,
          [TRACE_ID],
          protections,
          undefined,
          {
            full: true,
          },
        );

        expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(1);
      });

      it("the recomputed trace.output value equals the full 400 KB value", async () => {
        setupGetTracesWithSpansMocks();

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_A,
          [TRACE_ID],
          protections,
          undefined,
          { full: true },
        );

        expect(traces[0]?.output?.value).toBe(FULL_OUTPUT);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC2 — full=false (or omitted) → getFromEventLog called 0 times (preview)
// ---------------------------------------------------------------------------

describe("TraceService — AC2: getById without full resolves nothing (preview)", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("when getById is called with opts { full: false }", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getById(PROJECT_ID_A, TRACE_ID, protections, {
        full: false,
      });

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });
  });

  describe("when getById is called without opts (default)", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getById(PROJECT_ID_A, TRACE_ID, protections);

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });

    it("the returned trace.output is the ≤64 KB preview, not the full value", async () => {
      setupGetTracesWithSpansMocks();

      const trace = await service.getById(PROJECT_ID_A, TRACE_ID, protections);

      expect(trace?.output?.value).not.toBe(FULL_OUTPUT);
    });
  });
});

describe("TraceService — AC2: getTracesWithSpans without full resolves nothing", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;
  let service: TraceService;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
    service = makeService(blobStore);
  });

  describe("when getTracesWithSpans is called without opts (default)", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getTracesWithSpans(PROJECT_ID_A, [TRACE_ID], protections);

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });
  });

  describe("when getTracesWithSpans is called with opts { full: false }", () => {
    it("BlobStore.getFromEventLog is called 0 times", async () => {
      setupGetTracesWithSpansMocks();

      await service.getTracesWithSpans(
        PROJECT_ID_A,
        [TRACE_ID],
        protections,
        undefined,
        {
          full: false,
        },
      );

      expect(blobStore.getFromEventLog).toHaveBeenCalledTimes(0);
    });
  });
});

describe("TraceService — AC2: a service constructed without blobResolutionDeps never resolves", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given a TraceService created without blobResolutionDeps (list/search router context)", () => {
    describe("when getTracesWithSpans is called with full=true", () => {
      it("does not throw and returns the preview (no resolver wired)", async () => {
        setupGetTracesWithSpansMocks();
        const listService = new TraceService({} as never);

        const traces = await listService.getTracesWithSpans(
          PROJECT_ID_A,
          [TRACE_ID],
          protections,
          undefined,
          { full: true },
        );

        // No resolver → preview kept, no full value.
        expect(traces[0]?.output?.value).not.toBe(FULL_OUTPUT);
      });
    });
  });
});

// ---------------------------------------------------------------------------
// AC7 — cross-tenant: tenant B cannot read tenant A's event_log data
// ---------------------------------------------------------------------------

describe("TraceService — AC7: cross-tenant event_log read denied, preview returned", () => {
  let blobStore: ReturnType<typeof makeTenantScopedBlobStore>;

  beforeEach(() => {
    vi.clearAllMocks();
    blobStore = makeTenantScopedBlobStore();
  });

  describe("given an eventref whose event_log row belongs to tenant A", () => {
    describe("when getById is called with full=true but projectId is tenant B", () => {
      it("getFromEventLog is called with tenantId = tenant B (not A)", async () => {
        setupGetTracesWithSpansMocks();
        const serviceB = makeService(blobStore);

        await serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, {
          full: true,
        });

        const callArgs = blobStore.getFromEventLog.mock.calls[0]?.[0] as
          | { tenantId: string }
          | undefined;
        expect(callArgs?.tenantId).toBe(PROJECT_ID_B);
      });

      it("the returned trace output is the preview (not tenant A full value)", async () => {
        setupGetTracesWithSpansMocks();
        const serviceB = makeService(blobStore);

        const trace = await serviceB.getById(
          PROJECT_ID_B,
          TRACE_ID,
          protections,
          { full: true },
        );

        expect(trace?.output?.value).not.toBe(FULL_OUTPUT);
      });

      it("does not throw — cross-tenant denial degrades to preview", async () => {
        setupGetTracesWithSpansMocks();
        const serviceB = makeService(blobStore);

        await expect(
          serviceB.getById(PROJECT_ID_B, TRACE_ID, protections, { full: true }),
        ).resolves.not.toThrow();
      });
    });
  });
});

// ---------------------------------------------------------------------------
// CH-layer mapper-crossing tests (merged from integration test — all boundaries
// are mocked so these need no Docker container and belong in unit).
//
// These call ClickHouseTraceService.getTracesWithSpans directly via buildService
// to prove: (a) full value survives mapNormalizedSpanToSpan byte-identical, (b)
// no reserved-key leak, (c) trace.output widens past 64 KB, (d) resolveBlobs:false
// issues zero getFromEventLog calls and preserves the preview.
// ---------------------------------------------------------------------------

describe("ClickHouseTraceService — #4888 full resolution crosses the mapper", () => {
  const PROJECT_ID_CH = "proj-4888";
  const TRACE_ID_CH = "trace-4888";

  beforeEach(() => {
    vi.clearAllMocks();
  });

  function setupJoinedFetch() {
    mockClickHouseQuery
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            makeSummaryRow(TRACE_ID_CH, {
              computedOutput: `{"type":"text","value":${JSON.stringify(PREVIEW_OUTPUT)}}`,
            }),
          ]),
      })
      .mockResolvedValueOnce({
        json: () =>
          Promise.resolve([
            makeSpanRowWithEventRef(TRACE_ID_CH, "span-1", {
              tenantId: PROJECT_ID_CH,
              previewOutput: PREVIEW_OUTPUT,
            }),
          ]),
      });
  }

  function makeEventRefBlobStore(contents: Record<string, string>): {
    blobStore: BlobStore;
    getFromEventLogSpy: ReturnType<typeof vi.fn>;
  } {
    const getFromEventLogSpy = vi.fn(async ({ field }: { field: string }) => {
      if (field in contents) return contents[field]!;
      throw new BlobNotFoundError("evt-001", field, PROJECT_ID_CH);
    });
    const blobStore = {
      getFromEventLog: getFromEventLogSpy,
      putSpool: vi.fn(),
      getSpool: vi.fn(),
      deleteSpool: vi.fn(),
    } as unknown as BlobStore;
    return { blobStore, getFromEventLogSpy };
  }

  function buildService(blobStore: BlobStore) {
    const resolveTraceSpansFn: import("../clickhouse-trace.service").ResolveTraceSpansFn =
      (projectId, normalizedSpans) =>
        resolveOffloadedTraces({
          projectId,
          normalizedSpans,
          blobStore,
          ioExtractionService: new TraceIOExtractionService(),
          logger: createLogger("test"),
        });
    return new ClickHouseTraceService(
      { project: { findUnique: vi.fn() } } as never,
      resolveTraceSpansFn,
    );
  }

  describe("given a >64 KB offloaded langwatch.output (preview + flat eventref)", () => {
    describe("when getTracesWithSpans is called with resolveBlobs: true (detail path)", () => {
      it("calls getFromEventLog exactly once", async () => {
        setupJoinedFetch();
        const { blobStore, getFromEventLogSpy } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          {
            resolveBlobs: true,
          },
        );

        expect(getFromEventLogSpy).toHaveBeenCalledOnce();
      });

      it("the resolved value is defined in params.langwatch.output", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        const span = traces![0]!.spans[0] as unknown as {
          params?: { langwatch?: { output?: string } };
        };
        expect(span.params?.langwatch?.output).toBeDefined();
      });

      it("the resolved value survives the mapper byte-identical (400 KB)", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        const span = traces![0]!.spans[0] as unknown as {
          params?: { langwatch?: { output?: string } };
        };
        const resolved = span.params?.langwatch?.output;
        expect(Buffer.byteLength(resolved!, "utf8")).toBe(LARGE_BYTE_COUNT);
      });

      it("the resolved value in params.langwatch.output equals FULL_OUTPUT", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        const span = traces![0]!.spans[0] as unknown as {
          params?: { langwatch?: { output?: string } };
        };
        expect(span.params?.langwatch?.output).toBe(FULL_OUTPUT);
      });

      it("no langwatch.reserved.* key leaks into the mapped span (key-level check)", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        const span = traces![0]!.spans[0] as unknown as {
          params?: { langwatch?: { reserved?: unknown } };
        };
        // Key-level: reserved namespace must be absent from the mapped span
        expect(span?.params?.langwatch?.reserved).toBeUndefined();
        // Also verify no flat key under params carries the reserved prefix
        const flatParams = span?.params as Record<string, unknown> | undefined;
        if (flatParams) {
          const allKeys = Object.keys(flatParams);
          expect(
            allKeys.every((k) => !k.startsWith(EVENTREF_ATTR_PREFIX)),
          ).toBe(true);
        }
      });

      it("trace.output is defined after resolution", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        expect(traces![0]!.output?.value).toBeDefined();
      });

      it("trace.output widens past the 64 KB preview to the full value", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        const outputVal = traces![0]!.output?.value as string | undefined;
        expect(Buffer.byteLength(outputVal!, "utf8")).toBeGreaterThan(
          IO_PREVIEW_BYTES,
        );
      });

      it("trace.output equals FULL_OUTPUT after resolution", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: true },
        );

        expect(traces![0]!.output?.value).toBe(FULL_OUTPUT);
      });
    });

    describe("when getTracesWithSpans is called with resolveBlobs: false (list/enrich path)", () => {
      it("issues ZERO getFromEventLog calls (no event_log load on the list path)", async () => {
        setupJoinedFetch();
        const { blobStore, getFromEventLogSpy } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          {
            resolveBlobs: false,
          },
        );

        expect(getFromEventLogSpy).not.toHaveBeenCalled();
      });

      it("preserves the ≤64 KB preview (does not widen to the full value)", async () => {
        setupJoinedFetch();
        const { blobStore } = makeEventRefBlobStore({
          "langwatch.output": FULL_OUTPUT,
        });
        const service = buildService(blobStore);

        const traces = await service.getTracesWithSpans(
          PROJECT_ID_CH,
          [TRACE_ID_CH],
          protections,
          undefined,
          { resolveBlobs: false },
        );

        expect(traces![0]!.output?.value).not.toBe(FULL_OUTPUT);
      });
    });
  });
});
