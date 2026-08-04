import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/traces/protections";
import type { GetAllTracesForProjectInput } from "../types";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const { mockClickHouseQuery, mockPrismaFindUnique } = vi.hoisted(() => ({
  mockClickHouseQuery: vi.fn(),
  mockPrismaFindUnique: vi.fn(),
}));

vi.mock("~/server/clickhouse/clickhouseClient", () => ({
  getClickHouseClientForProject: () =>
    Promise.resolve({ query: mockClickHouseQuery }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (_name: string, ...args: unknown[]) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: () => {} };
      return (fn as (span: { setAttribute: () => void }) => Promise<unknown>)(
        span,
      );
    },
  }),
}));

// Stub the filter module to return empty conditions
vi.mock("~/server/filters/clickhouse", () => ({
  generateClickHouseFilterConditions: () => ({
    conditions: [],
    params: {},
    hasUnsupportedFilters: false,
  }),
}));

describe("ClickHouseTraceService", () => {
  const protections: Protections = {
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  } as Protections;

  const baseInput = {
    projectId: "proj_123",
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
    pageSize: 2,
    pageOffset: 0,
  } as GetAllTracesForProjectInput;

  // A minimal trace summary row from ClickHouse
  const makeSummaryRow = (traceId: string) => ({
    ts_TraceId: traceId,
    ts_SpanCount: 1,
    ts_TotalDurationMs: 100,
    ts_ComputedIOSchemaVersion: 1,
    ts_ComputedInput: '{"type":"text","value":"hello"}',
    ts_ComputedOutput: '{"type":"text","value":"world"}',
    ts_TimeToFirstTokenMs: 10,
    ts_TimeToLastTokenMs: 90,
    ts_TokensPerSecond: 5,
    ts_ContainsErrorStatus: false,
    ts_ContainsOKStatus: true,
    ts_ErrorMessage: "",
    ts_Models: ["gpt-4"],
    ts_TotalCost: 0.01,
    ts_TokensEstimated: false,
    ts_TotalPromptTokenCount: 10,
    ts_TotalCompletionTokenCount: 20,
    ts_TopicId: "",
    ts_SubTopicId: "",
    ts_HasAnnotation: false,
    ts_Attributes: {},
    ts_OccurredAt: Date.now(),
    ts_CreatedAt: Date.now(),
    ts_UpdatedAt: Date.now(),
  });

  // A minimal span row from ClickHouse stored_spans table
  const makeSpanRow = (traceId: string, spanId: string) => ({
    SpanId: spanId,
    TraceId: traceId,
    TenantId: "proj_123",
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: true,
    StartTime: Date.now(),
    EndTime: Date.now() + 100,
    DurationMs: 100,
    SpanName: "test-span",
    SpanKind: 1,
    ResourceAttributes: {},
    SpanAttributes: {},
    StatusCode: 1,
    StatusMessage: "",
    ScopeName: "test",
    ScopeVersion: "1.0",
    Events_Timestamp: [],
    Events_Name: [],
    Events_Attributes: [],
    Links_TraceId: [],
    Links_SpanId: [],
    Links_Attributes: [],
  });

  let ClickHouseTraceService: typeof import("../clickhouse-trace.service").ClickHouseTraceService;

  beforeEach(async () => {
    vi.clearAllMocks();

    mockPrismaFindUnique.mockResolvedValue({});

    // Dynamic import to get fresh module after mocks are set
    const mod = await import("../clickhouse-trace.service");
    ClickHouseTraceService = mod.ClickHouseTraceService;
  });

  describe("getAllTracesForProject()", () => {
    // Helper: set up the standard 4-mock sequence for fetchTracesWithPagination
    // count → IDs → data → evaluations
    const setupStandardMocks = (traceIds: string[]) => {
      const summaryRows = traceIds.map((id) => makeSummaryRow(id));
      const idRows = traceIds.map((id) => ({ TraceId: id }));
      mockClickHouseQuery
        .mockResolvedValueOnce({
          json: () => Promise.resolve([{ total: String(traceIds.length) }]),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve(idRows),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve(summaryRows),
        })
        .mockResolvedValueOnce({
          json: () => Promise.resolve([]),
        });
    };

    describe("when includeSpans is false or not provided", () => {
      it("returns traces with empty spans", async () => {
        setupStandardMocks(["trace-1"]);

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        expect(traces).toHaveLength(1);
        expect(traces[0]!.spans).toEqual([]);
      });
    });

    describe("when traceIds is provided", () => {
      it("includes TraceId IN clause in the queries", async () => {
        setupStandardMocks(["trace-A"]);

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const inputWithTraceIds = {
          ...baseInput,
          traceIds: ["trace-A", "trace-B"],
        } as GetAllTracesForProjectInput;

        const result = await service.getAllTracesForProject(
          inputWithTraceIds,
          protections,
        );

        expect(result).not.toBeNull();

        // Verify the count query (1st call) contains the TraceId IN clause
        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).toContain(
          "ts.TraceId IN ({traceIds:Array(String)})",
        );
        expect(countCall[0].query_params.traceIds).toEqual([
          "trace-A",
          "trace-B",
        ]);

        // Verify the IDs query (2nd call) contains the TraceId IN clause
        const dataCall = mockClickHouseQuery.mock.calls[1]!;
        expect(dataCall[0].query).toContain(
          "ts.TraceId IN ({traceIds:Array(String)})",
        );
        expect(dataCall[0].query_params.traceIds).toEqual([
          "trace-A",
          "trace-B",
        ]);
      });

      it("returns only matching traces", async () => {
        setupStandardMocks(["trace-A"]);

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const inputWithTraceIds = {
          ...baseInput,
          traceIds: ["trace-A"],
        } as GetAllTracesForProjectInput;

        const result = await service.getAllTracesForProject(
          inputWithTraceIds,
          protections,
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        expect(traces).toHaveLength(1);
        expect(traces[0]!.trace_id).toBe("trace-A");
      });
    });

    describe("when traceIds is undefined", () => {
      it("does not include TraceId IN clause in the queries", async () => {
        setupStandardMocks(["trace-1"]);

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
        );

        expect(result).not.toBeNull();

        // Verify neither the count nor data query contains the TraceId IN clause
        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).not.toContain(
          "ts.TraceId IN ({traceIds:Array(String)})",
        );

        const dataCall = mockClickHouseQuery.mock.calls[1]!;
        expect(dataCall[0].query).not.toContain(
          "ts.TraceId IN ({traceIds:Array(String)})",
        );
      });
    });

    describe("scrollId / pagination cursor handling", () => {
      const cursorTimestamp = 1700000000000;
      const cursorTraceId = "trace-cursor";

      /** Builds a valid base64-encoded scrollId cursor */
      const makeScrollId = (overrides: Record<string, unknown> = {}) =>
        Buffer.from(
          JSON.stringify({
            lastTimestamp: cursorTimestamp,
            lastTraceId: cursorTraceId,
            sortDirection: "desc",
            pageSize: baseInput.pageSize,
            ...overrides,
          }),
        ).toString("base64");

      const setupMocksForCursorTest = () => {
        setupStandardMocks(["trace-1"]);
      };

      describe("when scrollId is passed via options", () => {
        it("applies keyset pagination from options.scrollId", async () => {
          setupMocksForCursorTest();
          const scrollId = makeScrollId();

          const service = new ClickHouseTraceService({
            project: { findUnique: mockPrismaFindUnique },
          } as never);

          const result = await service.getAllTracesForProject(
            baseInput,
            protections,
            { scrollId },
          );

          expect(result).not.toBeNull();

          // The data query (2nd call) includes the keyset cursor condition on deduped values
          const dataCall = mockClickHouseQuery.mock.calls[1]!;
          expect(dataCall[0].query).toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) <",
          );
          expect(dataCall[0].query_params.lastTimestamp).toBe(cursorTimestamp);
          expect(dataCall[0].query_params.lastTraceId).toBe(cursorTraceId);
        });
      });

      describe("when scrollId is only in input (not options)", () => {
        it("ignores input.scrollId and does not apply cursor", async () => {
          setupMocksForCursorTest();
          const scrollId = makeScrollId();

          const service = new ClickHouseTraceService({
            project: { findUnique: mockPrismaFindUnique },
          } as never);

          const inputWithScrollId = {
            ...baseInput,
            scrollId,
          } as GetAllTracesForProjectInput;

          const result = await service.getAllTracesForProject(
            inputWithScrollId,
            protections,
          );

          expect(result).not.toBeNull();

          // input.scrollId is ignored — only options.scrollId is read
          const dataCall = mockClickHouseQuery.mock.calls[1]!;
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) <",
          );
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) >",
          );
        });
      });

      describe("when no scrollId is provided", () => {
        it("does not apply keyset cursor condition", async () => {
          setupMocksForCursorTest();

          const service = new ClickHouseTraceService({
            project: { findUnique: mockPrismaFindUnique },
          } as never);

          const result = await service.getAllTracesForProject(
            baseInput,
            protections,
          );

          expect(result).not.toBeNull();

          // The data query (2nd call) must NOT contain cursor condition
          const dataCall = mockClickHouseQuery.mock.calls[1]!;
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) <",
          );
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) >",
          );
        });
      });

      describe("when scrollId is malformed base64", () => {
        it("falls back to no cursor", async () => {
          setupMocksForCursorTest();

          const service = new ClickHouseTraceService({
            project: { findUnique: mockPrismaFindUnique },
          } as never);

          const result = await service.getAllTracesForProject(
            baseInput,
            protections,
            { scrollId: "not-valid-base64!!!" },
          );

          expect(result).not.toBeNull();

          // The data query (2nd call) must NOT contain cursor condition
          const dataCall = mockClickHouseQuery.mock.calls[1]!;
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) <",
          );
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) >",
          );
        });
      });

      describe("when scrollId has mismatched sortDirection", () => {
        it("discards the cursor and paginates from the beginning", async () => {
          setupMocksForCursorTest();
          // baseInput defaults to desc (or undefined which defaults to desc)
          // Build a cursor with "asc" sortDirection to trigger mismatch
          const scrollId = makeScrollId({ sortDirection: "asc" });

          const service = new ClickHouseTraceService({
            project: { findUnique: mockPrismaFindUnique },
          } as never);

          const result = await service.getAllTracesForProject(
            baseInput,
            protections,
            { scrollId },
          );

          expect(result).not.toBeNull();

          const dataCall = mockClickHouseQuery.mock.calls[1]!;
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) <",
          );
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) >",
          );
        });
      });

      describe("when scrollId has mismatched pageSize", () => {
        it("discards the cursor and paginates from the beginning", async () => {
          setupMocksForCursorTest();
          // baseInput.pageSize is 2, build cursor with pageSize 10
          const scrollId = makeScrollId({ pageSize: 10 });

          const service = new ClickHouseTraceService({
            project: { findUnique: mockPrismaFindUnique },
          } as never);

          const result = await service.getAllTracesForProject(
            baseInput,
            protections,
            { scrollId },
          );

          expect(result).not.toBeNull();

          const dataCall = mockClickHouseQuery.mock.calls[1]!;
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) <",
          );
          expect(dataCall[0].query).not.toContain(
            "(toUnixTimestamp64Milli(ts.OccurredAt), ts.TraceId) >",
          );
        });
      });
    });

    const setupMocksForQueryTest = () => {
      setupStandardMocks(["trace-1"]);
    };

    describe("when query is provided", () => {
      it("includes LIKE clause in count query", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "Hello World" } as GetAllTracesForProjectInput,
          protections,
        );

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).toContain(
          "lower(ifNull(ts.ComputedInput, '')) LIKE {searchQuery:String}",
        );
        expect(countCall[0].query).toContain(
          "lower(ifNull(ts.ComputedOutput, '')) LIKE {searchQuery:String}",
        );
      });

      it("includes LIKE clause in data query", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "Hello World" } as GetAllTracesForProjectInput,
          protections,
        );

        const dataCall = mockClickHouseQuery.mock.calls[1]!;
        expect(dataCall[0].query).toContain(
          "lower(ifNull(ts.ComputedInput, '')) LIKE {searchQuery:String}",
        );
        expect(dataCall[0].query).toContain(
          "lower(ifNull(ts.ComputedOutput, '')) LIKE {searchQuery:String}",
        );
      });

      it("lowercases and wraps query param with wildcards", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "Hello World" } as GetAllTracesForProjectInput,
          protections,
        );

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query_params.searchQuery).toBe("%hello world%");
      });

      it("escapes wildcard characters in query", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          {
            ...baseInput,
            query: "100% success_rate",
          } as GetAllTracesForProjectInput,
          protections,
        );

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query_params.searchQuery).toBe(
          "%100\\% success\\_rate%",
        );
      });

      // Issue #6356: a tool or agent identifier usually lives on the span
      // name, not in the captured I/O, so free text has to reach the trace
      // name and the span names as well.
      it.each([
        ["count", 0],
        ["data", 1],
      ])("searches the trace name in the %s query", async (_label, callIdx) => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "codex" } as GetAllTracesForProjectInput,
          protections,
        );

        const call = mockClickHouseQuery.mock.calls[callIdx as number]!;
        expect(call[0].query).toContain(
          "lower(ifNull(ts.TraceName, '')) LIKE {searchQuery:String}",
        );
      });

      it.each([
        ["count", 0],
        ["data", 1],
      ])("searches span names in the %s query", async (_label, callIdx) => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "codex" } as GetAllTracesForProjectInput,
          protections,
        );

        const sql = mockClickHouseQuery.mock.calls[callIdx as number]![0].query;
        expect(sql).toContain("FROM stored_spans sp");
        expect(sql).toContain("lower(sp.SpanName) LIKE {searchQuery:String}");
        // Correlated on the outer row and bounded, so it prunes partitions
        // instead of cold-scanning every weekly partition.
        expect(sql).toContain("sp.TraceId = ts.TraceId");
        expect(sql).toContain(
          "sp.StartTime >= fromUnixTimestamp64Milli({startDate:UInt64})",
        );
      });

      it("ORs the name branches with the IO branches rather than replacing them", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "codex" } as GetAllTracesForProjectInput,
          protections,
        );

        const sql = mockClickHouseQuery.mock.calls[0]![0].query;
        expect(sql).toContain("lower(ifNull(ts.ComputedInput, ''))");
        expect(sql).toContain("lower(ifNull(ts.ComputedOutput, ''))");
        expect(sql).toContain("lower(ifNull(ts.TraceName, ''))");
        expect(sql).toContain("lower(sp.SpanName)");

        // Presence alone would pass just as happily if the branches were
        // AND-joined, which is the actual regression to fear: an AND of four
        // substring tests matches nothing. Pin the join operator. The slice
        // stops at EXISTS so the span subquery's own internal ANDs (its tenant,
        // trace and time predicates) stay out of the assertion.
        const columnBranches = sql.slice(
          sql.indexOf("lower(ifNull(ts.ComputedInput, ''))"),
          sql.indexOf("EXISTS ("),
        );
        expect(columnBranches).toContain(" OR ");
        expect(columnBranches).not.toContain(" AND ");
        // ...and the span branch is OR-ed onto them, not AND-ed.
        expect(sql).toContain("OR EXISTS (");
      });

      // The 3-char floor exists because the ngrambf_v1 skip indexes are
      // n=3; adding name branches must not start issuing queries below it.
      it("still no-ops below the three-character floor", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "co" } as GetAllTracesForProjectInput,
          protections,
        );

        const call = mockClickHouseQuery.mock.calls[0]!;
        expect(call[0].query_params.searchQuery).toBeUndefined();
        expect(call[0].query).not.toContain("lower(sp.SpanName)");
      });

      // The privacy-relevant asymmetry in this change: the two Computed*
      // branches stay gated on the I/O protections, while trace and span names
      // are operation names already visible in the list and so are searched
      // either way. Pin it so neither half drifts.
      it("drops a redacted IO column but keeps the name branches", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "codex" } as GetAllTracesForProjectInput,
          { ...protections, canSeeCapturedOutput: false },
        );

        const sql = mockClickHouseQuery.mock.calls[0]![0].query;
        expect(sql).not.toContain("lower(ifNull(ts.ComputedOutput, ''))");
        expect(sql).toContain("lower(ifNull(ts.ComputedInput, ''))");
        expect(sql).toContain("lower(ifNull(ts.TraceName, ''))");
        expect(sql).toContain("lower(sp.SpanName)");
      });
    });

    describe("when user cannot see input or output", () => {
      it("returns empty results when searching without I/O access", async () => {
        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, query: "hello" } as GetAllTracesForProjectInput,
          {
            canSeeCapturedInput: false,
            canSeeCapturedOutput: false,
          },
        );

        expect(result!.groups).toEqual([]);
        expect(result!.totalHits).toBe(0);
        expect(mockClickHouseQuery).not.toHaveBeenCalled();
      });

      it("searches only output when input is hidden", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "hello" } as GetAllTracesForProjectInput,
          {
            canSeeCapturedInput: false,
            canSeeCapturedOutput: true,
          },
        );

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).toContain(
          "lower(ifNull(ts.ComputedOutput, '')) LIKE",
        );
        expect(countCall[0].query).not.toContain("ComputedInput");
      });

      it("searches only input when output is hidden", async () => {
        setupMocksForQueryTest();

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "hello" } as GetAllTracesForProjectInput,
          {
            canSeeCapturedInput: true,
            canSeeCapturedOutput: false,
          },
        );

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).toContain(
          "lower(ifNull(ts.ComputedInput, '')) LIKE",
        );
        expect(countCall[0].query).not.toContain("ComputedOutput");
      });
    });

    describe("when query is too short", () => {
      it("does not include LIKE clause for queries under 3 characters", async () => {
        setupStandardMocks(["trace-1"]);

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getAllTracesForProject(
          { ...baseInput, query: "ab" } as GetAllTracesForProjectInput,
          protections,
        );

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).not.toContain("LIKE");
        expect(countCall[0].query_params.searchQuery).toBeUndefined();
      });
    });

    describe("when query is undefined", () => {
      it("does not include LIKE clause in queries", async () => {
        setupStandardMocks(["trace-1"]);

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
        );

        expect(result).not.toBeNull();

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).not.toContain("LIKE");
        expect(countCall[0].query_params.searchQuery).toBeUndefined();

        const dataCall = mockClickHouseQuery.mock.calls[1]!;
        expect(dataCall[0].query).not.toContain("LIKE");
        expect(dataCall[0].query_params.searchQuery).toBeUndefined();
      });
    });

    describe("when ClickHouse MEMORY_LIMIT_EXCEEDED on summary query", () => {
      it("retries in smaller batches and returns all traces", async () => {
        const traceIds = Array.from({ length: 4 }, (_, i) => `trace-${i}`);
        const summaryRows = traceIds.map((id, i) => ({
          ...makeSummaryRow(id),
          ts_OccurredAt: Date.now() - i * 1000,
        }));
        const idRows = traceIds.map((id) => ({ TraceId: id }));

        // Batch size is 25, so 4 traces fit in one retry batch
        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          // summary — OOM
          .mockRejectedValueOnce(
            new Error(
              "Query memory limit exceeded: would use 3.50 GiB, " +
                "maximum: 3.50 GiB: MEMORY_LIMIT_EXCEEDED",
            ),
          )
          // retry batch (all 4 fit in one batch of 25)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows),
          })
          // evaluations
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 4 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        expect(traces).toHaveLength(4);
      });

      it("splits into 25-ID batches when retrying with >25 traces", async () => {
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);
        const summaryRows = traceIds.map((id, i) => ({
          ...makeSummaryRow(id),
          ts_OccurredAt: Date.now() - i * 1000,
        }));
        const idRows = traceIds.map((id) => ({ TraceId: id }));

        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          // summary — OOM
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // retry batch 1: traces 0-24
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(0, 25)),
          })
          // retry batch 2: traces 25-29
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(25)),
          })
          // evaluations
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 30 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        expect(traces).toHaveLength(30);

        // Verify batch split: call 0=count, 1=IDs, 2=OOM, 3=batch1, 4=batch2
        const batch1Params = mockClickHouseQuery.mock.calls[3]![0];
        const batch2Params = mockClickHouseQuery.mock.calls[4]![0];
        expect(batch1Params.query_params.pageTraceIds).toHaveLength(25);
        expect(batch2Params.query_params.pageTraceIds).toHaveLength(5);
      });

      it("re-throws non-OOM errors from summary query", async () => {
        const idRows = [{ TraceId: "trace-1" }];

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          .mockRejectedValueOnce(new Error("SYNTAX_ERROR: bad query"));

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await expect(
          service.getAllTracesForProject(baseInput, protections),
        ).rejects.toThrow("SYNTAX_ERROR");
      });

      /** @scenario A batch that still exceeds the memory limit is split and retried */
      it("bisects a 25-ID batch that still OOMs and resolves both halves", async () => {
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);
        const summaryRows = traceIds.map((id, i) => ({
          ...makeSummaryRow(id),
          ts_OccurredAt: Date.now() - i * 1000,
        }));
        const idRows = traceIds.map((id) => ({ TraceId: id }));

        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          // summary full list — OOM, drops to fixed-size batches
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // first 25-ID batch — STILL OOMs, triggers recursive bisection
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // bisected lower half (ids 0-11)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(0, 12)),
          })
          // bisected upper half (ids 12-24)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(12, 25)),
          })
          // second fixed-size batch (ids 25-29)
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(25)),
          })
          // evaluations
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 30 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result!.groups.flat()).toHaveLength(30);
        // calls: 0=count, 1=IDs, 2=full OOM, 3=25-ID batch OOM, 4 & 5 = halves
        expect(
          mockClickHouseQuery.mock.calls[3]![0].query_params.pageTraceIds,
        ).toHaveLength(25);
        expect(
          mockClickHouseQuery.mock.calls[4]![0].query_params.pageTraceIds,
        ).toHaveLength(12);
        expect(
          mockClickHouseQuery.mock.calls[5]![0].query_params.pageTraceIds,
        ).toHaveLength(13);
      });

      it("rethrows when a single-ID summary batch still OOMs after bisecting", async () => {
        const traceIds = ["trace-0", "trace-1"];
        const idRows = traceIds.map((id) => ({ TraceId: id }));

        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          // every summary read OOMs: full list, the batch, then the bisected
          // single id — which can no longer be split, so it propagates.
          .mockRejectedValue(new Error("MEMORY_LIMIT_EXCEEDED"));

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await expect(
          service.getAllTracesForProject(
            { ...baseInput, pageSize: 2 } as GetAllTracesForProjectInput,
            protections,
          ),
        ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
        // count, IDs, full-list OOM, 2-ID batch OOM, then the bisected 1-ID OOM
        // — proof the helper descended to a single id before giving up.
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(5);
      });

      /** @scenario Splitting continues until a batch holds a single trace */
      it("descends all the way to single ids when every larger chunk OOMs", async () => {
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => ({ TraceId: id }))),
          })
          // Every read of more than one id OOMs; single ids succeed. The helper
          // must therefore walk 25 -> 12 -> 6 -> 3 -> 1 rather than giving up at
          // the first split, which is the "down to a single id" claim the doc
          // comment makes and the one-level tests above never exercise.
          .mockImplementation(
            (args: { query_params?: { pageTraceIds?: string[] } }) => {
              const ids = args.query_params?.pageTraceIds ?? [];
              if (ids.length > 1) {
                return Promise.reject(new Error("MEMORY_LIMIT_EXCEEDED"));
              }
              return Promise.resolve({
                json: () =>
                  Promise.resolve(ids.map((id) => makeSummaryRow(id))),
              });
            },
          );

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 30 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result!.groups.flat()).toHaveLength(30);

        const chunkSizes = mockClickHouseQuery.mock.calls
          .map((call) => call[0].query_params?.pageTraceIds?.length)
          .filter((n): n is number => typeof n === "number");
        // The descent bottomed out at 1, and every id was served by exactly one
        // single-id read (25 from the first chunk, 5 from the second).
        expect(chunkSizes).toContain(1);
        expect(chunkSizes.filter((n) => n === 1)).toHaveLength(30);
        // Intermediate levels really were visited, not skipped.
        expect(chunkSizes).toContain(12);
        expect(chunkSizes).toContain(6);
        expect(chunkSizes).toContain(3);
      });

      /** @scenario Recovery stops once its work budget is spent */
      it("stops bisecting once the work budget is spent instead of grinding every chunk", async () => {
        // The regime the budget exists for: server-wide memory pressure, where
        // a chunk fails at 25 but succeeds once small. Nothing aborts early, so
        // every chunk pays a full recursion tree — 12 chunks x 17 runs = 204
        // sequential queries at an instance that just reported it was OOM.
        const traceIds = Array.from({ length: 300 }, (_, i) => `trace-${i}`);

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => ({ TraceId: id }))),
          })
          .mockImplementation(
            (args: { query_params?: { pageTraceIds?: string[] } }) => {
              const ids = args.query_params?.pageTraceIds ?? [];
              if (ids.length > 3) {
                return Promise.reject(new Error("MEMORY_LIMIT_EXCEEDED"));
              }
              return Promise.resolve({
                json: () =>
                  Promise.resolve(ids.map((id) => makeSummaryRow(id))),
              });
            },
          );

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        // Uncapped this call SUCCEEDS after grinding all 300 ids. The budget is
        // what turns it back into the fast failure that protected the instance
        // before bisection existed — so `rejects` here IS the fix, and it flips
        // to a resolved page the moment the cap is removed.
        await expect(
          service.getAllTracesForProject(
            { ...baseInput, pageSize: 300 } as GetAllTracesForProjectInput,
            protections,
          ),
        ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");

        // Total work stays under the documented ceiling:
        //   ceil(300/25) baseline chunks + MAX_BISECT_RETRIES + count + IDs.
        // Uncapped this is 206, so the bound fails without the budget.
        expect(mockClickHouseQuery.mock.calls.length).toBeLessThanOrEqual(
          12 + 100 + 2,
        );
      });

      /** @scenario Retries of a split batch run one at a time */
      it("runs the two halves sequentially so a retry never doubles memory pressure", async () => {
        const traceIds = Array.from({ length: 25 }, (_, i) => `trace-${i}`);
        let inFlight = 0;
        let maxInFlight = 0;

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => ({ TraceId: id }))),
          })
          .mockImplementation(
            async (args: { query_params?: { pageTraceIds?: string[] } }) => {
              const ids = args.query_params?.pageTraceIds ?? [];
              inFlight += 1;
              maxInFlight = Math.max(maxInFlight, inFlight);
              try {
                // Yield the microtask queue so overlapping calls would actually
                // observe each other; a Promise.all refactor lands here at 2.
                await new Promise((resolve) => setTimeout(resolve, 0));
                if (ids.length > 12) {
                  throw new Error("MEMORY_LIMIT_EXCEEDED");
                }
                return {
                  json: () =>
                    Promise.resolve(ids.map((id) => makeSummaryRow(id))),
                };
              } finally {
                inFlight -= 1;
              }
            },
          );

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 25 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        // Load-bearing safety property, called out in the helper's comment and
        // otherwise untested: a Promise.all refactor would stay green without it.
        expect(maxInFlight).toBe(1);
      });

      /** @scenario A failure unrelated to memory is surfaced immediately */
      it("re-throws a non-OOM error raised inside the bisection, without descending further", async () => {
        const traceIds = Array.from({ length: 25 }, (_, i) => `trace-${i}`);

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => ({ TraceId: id }))),
          })
          // full list OOMs, the 25-id chunk OOMs, then the bisected lower half
          // fails for an unrelated reason — the guard's non-OOM arm in the
          // RECURSIVE position, which the top-level test can't reach.
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          .mockRejectedValueOnce(new Error("SYNTAX_ERROR"));

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await expect(
          service.getAllTracesForProject(
            { ...baseInput, pageSize: 25 } as GetAllTracesForProjectInput,
            protections,
          ),
        ).rejects.toThrow("SYNTAX_ERROR");
        // count, IDs, full-list OOM, chunk OOM, lower-half SYNTAX_ERROR — and
        // nothing after it: the upper half is never attempted.
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(5);
      });

      it("bisects on the translated query_memory_exceeded the resilient client actually raises", async () => {
        const { QueryMemoryExceededError } = await import(
          "~/server/app-layer/traces/errors"
        );
        const traceIds = Array.from({ length: 25 }, (_, i) => `trace-${i}`);
        const summaryRows = traceIds.map((id) => makeSummaryRow(id));

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => ({ TraceId: id }))),
          })
          // Production never surfaces a raw Error carrying the ClickHouse
          // fragment any more: every read path runs through
          // translateClickHouseQueryError, which hands back this handled error
          // with the driver detail buried in `reasons`. The other bisection
          // tests reach the fallback via the legacy string-match arm, so this
          // is the only one that proves the feature fires in prod.
          .mockRejectedValueOnce(
            new QueryMemoryExceededError({
              reasons: [new Error("Code: 241. DB::Exception: ...")],
            }),
          )
          .mockRejectedValueOnce(
            new QueryMemoryExceededError({
              reasons: [new Error("Code: 241. DB::Exception: ...")],
            }),
          )
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(0, 12)),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows.slice(12)),
          })
          .mockResolvedValueOnce({ json: () => Promise.resolve([]) });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 25 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result!.groups.flat()).toHaveLength(25);
        expect(
          mockClickHouseQuery.mock.calls[4]![0].query_params.pageTraceIds,
        ).toHaveLength(12);
        expect(
          mockClickHouseQuery.mock.calls[5]![0].query_params.pageTraceIds,
        ).toHaveLength(13);
      });
    });

    describe("when ClickHouse MEMORY_LIMIT_EXCEEDED on evaluations query", () => {
      it("retries evaluations in batches and returns traces", async () => {
        const summaryRows = [makeSummaryRow("trace-1")];
        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ TraceId: "trace-1" }]),
          })
          // summary
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows),
          })
          // evaluations — OOM
          .mockRejectedValueOnce(
            Object.assign(new Error("Query memory limit exceeded"), {
              type: "MEMORY_LIMIT_EXCEEDED",
            }),
          )
          // evaluations retry batch
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result!.groups.flat()).toHaveLength(1);
      });

      it("bisects a 25-ID evaluations batch that still OOMs and resolves both halves", async () => {
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);
        const summaryRows = traceIds.map((id) => makeSummaryRow(id));
        const idRows = traceIds.map((id) => ({ TraceId: id }));

        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: String(traceIds.length) }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          // summary — succeeds in one read
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows),
          })
          // evaluations full list — OOM, drops to fixed-size batches
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // first 25-ID eval batch — STILL OOMs, triggers recursive bisection
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // bisected lower half (12 ids)
          .mockResolvedValueOnce({ json: () => Promise.resolve([]) })
          // bisected upper half (13 ids)
          .mockResolvedValueOnce({ json: () => Promise.resolve([]) })
          // second fixed-size eval batch (5 ids)
          .mockResolvedValueOnce({ json: () => Promise.resolve([]) });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          { ...baseInput, pageSize: 30 } as GetAllTracesForProjectInput,
          protections,
        );

        expect(result).not.toBeNull();
        expect(result!.groups.flat()).toHaveLength(30);
        // calls: 0=count, 1=IDs, 2=summary, 3=full eval OOM, 4=25-ID OOM, 5 & 6 = halves
        expect(
          mockClickHouseQuery.mock.calls[4]![0].query_params.traceIds,
        ).toHaveLength(25);
        expect(
          mockClickHouseQuery.mock.calls[5]![0].query_params.traceIds,
        ).toHaveLength(12);
        expect(
          mockClickHouseQuery.mock.calls[6]![0].query_params.traceIds,
        ).toHaveLength(13);
      });

      it("rethrows when a single-ID evaluations batch still OOMs after bisecting", async () => {
        const summaryRows = [
          makeSummaryRow("trace-0"),
          makeSummaryRow("trace-1"),
        ];
        const idRows = [{ TraceId: "trace-0" }, { TraceId: "trace-1" }];

        mockClickHouseQuery
          // count
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "2" }]),
          })
          // IDs
          .mockResolvedValueOnce({
            json: () => Promise.resolve(idRows),
          })
          // summary — succeeds
          .mockResolvedValueOnce({
            json: () => Promise.resolve(summaryRows),
          })
          // every evaluations read OOMs, down to the single-id batch which can
          // no longer be split — so it propagates.
          .mockRejectedValue(new Error("MEMORY_LIMIT_EXCEEDED"));

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await expect(
          service.getAllTracesForProject(
            { ...baseInput, pageSize: 2 } as GetAllTracesForProjectInput,
            protections,
          ),
        ).rejects.toThrow("MEMORY_LIMIT_EXCEEDED");
        // count, IDs, summary, full eval OOM, 2-ID batch OOM, bisected 1-ID OOM
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(6);
      });
    });

    describe("when includeSpans is true", () => {
      it("fetches and attaches spans to traces", async () => {
        const summaryRow = makeSummaryRow("trace-1");
        const spanRow = makeSpanRow("trace-1", "span-1");

        mockClickHouseQuery
          // 1st call: count query
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          // 2nd call: IDs query
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ TraceId: "trace-1" }]),
          })
          // 3rd call: data query (fetchTracesWithPagination)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          // 4th call: trace summary query (fetchTracesWithSpansJoined - summaries)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          // 5th call: spans query (fetchTracesWithSpansJoined - spans)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([spanRow]),
          })
          // 6th call: evaluation query
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const result = await service.getAllTracesForProject(
          baseInput,
          protections,
          { includeSpans: true },
        );

        expect(result).not.toBeNull();
        const traces = result!.groups.flat();
        expect(traces).toHaveLength(1);
        expect(traces[0]!.spans).toHaveLength(1);
        expect(traces[0]!.spans[0]!.span_id).toBe("span-1");
      });
    });
  });

  describe("getTracesWithSpans()", () => {
    describe("when the join read hits MEMORY_LIMIT_EXCEEDED", () => {
      it("retries in batches and returns all traces with their spans", async () => {
        const traceIds = ["trace-0", "trace-1"];

        mockClickHouseQuery
          // resolve: min/max OccurredAt for the ids (no occurredAt passed)
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([{ fromMs: 1_000_000, toMs: 2_000_000 }]),
          })
          // summary query for the full list — OOM
          .mockRejectedValueOnce(
            new Error(
              "Query memory limit exceeded: would use 3.50 GiB, " +
                "maximum: 3.50 GiB: MEMORY_LIMIT_EXCEEDED",
            ),
          )
          // retry batch (both traces fit in one batch of 25): summary then spans
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => makeSummaryRow(id))),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(traceIds.map((id) => makeSpanRow(id, `${id}-s`))),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const traces = await service.getTracesWithSpans(
          "proj_123",
          traceIds,
          protections,
        );

        expect(traces).not.toBeNull();
        expect(traces!.map((t) => t.trace_id).sort()).toEqual(traceIds);
        for (const trace of traces!) {
          expect(trace.spans).toHaveLength(1);
        }
      });

      it("splits into 25-trace batches when retrying with >25 traces", async () => {
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);

        mockClickHouseQuery
          // resolve: min/max OccurredAt for the ids (no occurredAt passed)
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([{ fromMs: 1_000_000, toMs: 2_000_000 }]),
          })
          // full-list summary — OOM
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // batch 1: summary (0-24) then spans
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(0, 25).map((id) => makeSummaryRow(id)),
              ),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(0, 25).map((id) => makeSpanRow(id, `${id}-s`)),
              ),
          })
          // batch 2: summary (25-29) then spans
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(25).map((id) => makeSummaryRow(id)),
              ),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(25).map((id) => makeSpanRow(id, `${id}-s`)),
              ),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const traces = await service.getTracesWithSpans(
          "proj_123",
          traceIds,
          protections,
        );

        expect(traces).toHaveLength(30);
        // call 0 = resolve, 1 = OOM full summary, 2 = summary batch1,
        // 3 = spans batch1, 4 = summary batch2, 5 = spans batch2
        const batch1Summary = mockClickHouseQuery.mock.calls[2]![0];
        const batch2Summary = mockClickHouseQuery.mock.calls[4]![0];
        expect(batch1Summary.query_params.traceIds).toHaveLength(25);
        expect(batch2Summary.query_params.traceIds).toHaveLength(5);
      });

      it("does not batch-retry non-OOM errors", async () => {
        mockClickHouseQuery.mockRejectedValue(
          new Error("SYNTAX_ERROR: bad query"),
        );

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await expect(
          service.getTracesWithSpans("proj_123", ["trace-0"], protections),
        ).rejects.toThrow();
        // The resolve fails open (call 1), then the summary's non-OOM error
        // propagates without per-batch retries (call 2) — no retry loop.
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(2);
      });

      it("bisects a 25-trace join batch that still OOMs and resolves both halves", async () => {
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);

        mockClickHouseQuery
          // OccurredAt sort-key resolve (light seek that bounds the reads below)
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([{ fromMs: 1_000_000, toMs: 2_000_000 }]),
          })
          // full-list summary — OOM, drops to fixed-size batches
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // first 25-trace batch summary — STILL OOMs, triggers bisection
          .mockRejectedValueOnce(new Error("MEMORY_LIMIT_EXCEEDED"))
          // bisected lower half (12): summary then spans
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(0, 12).map((id) => makeSummaryRow(id)),
              ),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(0, 12).map((id) => makeSpanRow(id, `${id}-s`)),
              ),
          })
          // bisected upper half (13): summary then spans
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(12, 25).map((id) => makeSummaryRow(id)),
              ),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(12, 25).map((id) => makeSpanRow(id, `${id}-s`)),
              ),
          })
          // second fixed-size batch (5): summary then spans
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(25).map((id) => makeSummaryRow(id)),
              ),
          })
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve(
                traceIds.slice(25).map((id) => makeSpanRow(id, `${id}-s`)),
              ),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const traces = await service.getTracesWithSpans(
          "proj_123",
          traceIds,
          protections,
        );

        expect(traces).not.toBeNull();
        expect(traces).toHaveLength(30);
        for (const trace of traces!) {
          expect(trace.spans).toHaveLength(1);
        }
      });

      /** @scenario Splitting a batch does not narrow the span search window */
      it("keeps the span scan window identical across every bisected chunk", async () => {
        const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
        // Deliberately far from the summary rows' own OccurredAt (Date.now()):
        // if the window were still derived from a chunk's matched rows, the
        // span reads would land near now instead of on this list-wide range.
        const RESOLVED_FROM_MS = 1_000_000;
        const RESOLVED_TO_MS = 2_000_000;
        const traceIds = Array.from({ length: 30 }, (_, i) => `trace-${i}`);

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([
                { fromMs: RESOLVED_FROM_MS, toMs: RESOLVED_TO_MS },
              ]),
          })
          .mockImplementation(
            (args: {
              query: string;
              query_params?: { traceIds?: string[] };
            }) => {
              const ids = args.query_params?.traceIds ?? [];
              const isSpanRead = args.query.includes("stored_spans");
              // Chunks above 12 OOM, so the 25-id chunk bisects; the halves
              // then run their own span reads. Pre-fix each of those derived a
              // window from its own summary rows.
              if (!isSpanRead && ids.length > 12) {
                return Promise.reject(new Error("MEMORY_LIMIT_EXCEEDED"));
              }
              return Promise.resolve({
                json: () =>
                  Promise.resolve(
                    isSpanRead
                      ? ids.map((id) => makeSpanRow(id, `${id}-s`))
                      : ids.map((id) => makeSummaryRow(id)),
                  ),
              });
            },
          );

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const traces = await service.getTracesWithSpans(
          "proj_123",
          traceIds,
          protections,
        );

        expect(traces).toHaveLength(30);

        const spanCalls = mockClickHouseQuery.mock.calls
          .map((call) => call[0])
          .filter((args) => args.query.includes("stored_spans"));
        // More than one chunk ran, so "identical" is a real constraint here.
        expect(spanCalls.length).toBeGreaterThan(1);
        for (const spanCall of spanCalls) {
          // Chunk-INVARIANT: bisecting changes how many span reads happen,
          // never which rows they are allowed to see. Derived per chunk, the
          // narrowest of these would have collapsed toward a single trace's
          // OccurredAt and silently dropped spans outside it.
          expect(spanCall.query_params.fromMs).toBe(
            RESOLVED_FROM_MS - TWO_DAYS_MS,
          );
          expect(spanCall.query_params.toMs).toBe(RESOLVED_TO_MS + TWO_DAYS_MS);
        }
      });
    });

    describe("when an occurredAt range is supplied", () => {
      const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;

      it("bounds the summary read to the OccurredAt window (±2 days)", async () => {
        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSummaryRow("trace-0")]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSpanRow("trace-0", "trace-0-s")]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getTracesWithSpans("proj_123", ["trace-0"], protections, {
          from: 1_000_000,
          to: 2_000_000,
        });

        const summaryCall = mockClickHouseQuery.mock.calls[0]![0];
        // Both bounds present in both the outer scan and the inner dedup
        // subquery (a dropped upper bound would leave the read half-open).
        expect(
          summaryCall.query.match(/OccurredAt >= fromUnixTimestamp64Milli/g) ??
            [],
        ).toHaveLength(2);
        expect(
          summaryCall.query.match(/OccurredAt <= fromUnixTimestamp64Milli/g) ??
            [],
        ).toHaveLength(2);
        expect(summaryCall.query_params.fromMs).toBe(1_000_000 - TWO_DAYS_MS);
        expect(summaryCall.query_params.toMs).toBe(2_000_000 + TWO_DAYS_MS);
      });
    });

    describe("when no occurredAt range is supplied", () => {
      it("resolves the OccurredAt window from a sort-key seek and bounds the summary read", async () => {
        const TWO_DAYS_MS = 2 * 24 * 60 * 60 * 1000;
        mockClickHouseQuery
          // resolve: min/max OccurredAt for the trace ids (light sort-key seek)
          .mockResolvedValueOnce({
            json: () =>
              Promise.resolve([{ fromMs: 1_000_000, toMs: 2_000_000 }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSummaryRow("trace-0")]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSpanRow("trace-0", "trace-0-s")]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getTracesWithSpans("proj_123", ["trace-0"], protections);

        const resolveCall = mockClickHouseQuery.mock.calls[0]![0];
        expect(resolveCall.query).toContain("min(OccurredAt)");
        expect(resolveCall.query).toContain("max(OccurredAt)");

        const summaryCall = mockClickHouseQuery.mock.calls[1]![0];
        // Bounded to the resolved window (±2 days) in outer scan and inner dedup.
        expect(
          summaryCall.query.match(/OccurredAt >= fromUnixTimestamp64Milli/g) ??
            [],
        ).toHaveLength(2);
        expect(summaryCall.query_params.fromMs).toBe(1_000_000 - TWO_DAYS_MS);
        expect(summaryCall.query_params.toMs).toBe(2_000_000 + TWO_DAYS_MS);
      });

      it("keeps the summary read unbounded when the ids resolve to no rows", async () => {
        mockClickHouseQuery
          // resolve finds nothing -> min/max default to epoch (0) = "no window"
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ fromMs: 0, toMs: 0 }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSummaryRow("trace-0")]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSpanRow("trace-0", "trace-0-s")]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        await service.getTracesWithSpans("proj_123", ["trace-0"], protections);

        const summaryCall = mockClickHouseQuery.mock.calls[1]![0];
        // No OccurredAt predicate inlined at all, and no window params.
        expect(summaryCall.query).not.toContain("OccurredAt >=");
        expect(summaryCall.query).not.toContain("OccurredAt <=");
        expect(summaryCall.query_params.fromMs).toBeUndefined();
        expect(summaryCall.query_params.toMs).toBeUndefined();
      });

      it("fails open to the unbounded read when the resolve query errors", async () => {
        mockClickHouseQuery
          // resolve errors (transient ClickHouse failure)
          .mockRejectedValueOnce(new Error("resolve boom"))
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSummaryRow("trace-0")]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([makeSpanRow("trace-0", "trace-0-s")]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const traces = await service.getTracesWithSpans(
          "proj_123",
          ["trace-0"],
          protections,
        );

        // The read still succeeds; the summary just stays unbounded (the
        // pre-optimization behaviour) rather than propagating the resolve error.
        expect(traces).toHaveLength(1);
        const summaryCall = mockClickHouseQuery.mock.calls[1]![0];
        expect(summaryCall.query).not.toContain("OccurredAt >=");
        expect(summaryCall.query_params.fromMs).toBeUndefined();
      });
    });
  });
});

describe("isClickHouseMemoryLimitError", () => {
  it("recognizes the resilient client's translated query_memory_exceeded", async () => {
    const { isClickHouseMemoryLimitError } = await import(
      "../clickhouse-trace.service"
    );
    const { QueryMemoryExceededError } = await import(
      "~/server/app-layer/traces/errors"
    );

    const translated = new QueryMemoryExceededError({
      reasons: [new Error("some driver detail without the fragment")],
    });
    expect(isClickHouseMemoryLimitError(translated)).toBe(true);
  });

  it("recognizes a handled error wrapping a raw MEMORY_LIMIT_EXCEEDED in reasons", async () => {
    const { isClickHouseMemoryLimitError } = await import(
      "../clickhouse-trace.service"
    );
    const { ClickHouseUnavailableError } = await import(
      "~/server/app-layer/traces/errors"
    );

    const wrapped = new ClickHouseUnavailableError({
      reasons: [
        new Error("Code: 241. DB::Exception: ... (MEMORY_LIMIT_EXCEEDED)"),
      ],
    });
    expect(isClickHouseMemoryLimitError(wrapped)).toBe(true);
  });

  it("does not match an unrelated handled error", async () => {
    const { isClickHouseMemoryLimitError } = await import(
      "../clickhouse-trace.service"
    );
    const { ClickHouseUnavailableError } = await import(
      "~/server/app-layer/traces/errors"
    );

    expect(isClickHouseMemoryLimitError(new ClickHouseUnavailableError())).toBe(
      false,
    );
  });
});
