import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/elasticsearch/protections";
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
    withActiveSpan: (
      _name: string,
      ...args: unknown[]
    ) => {
      const fn = args.length === 1 ? args[0] : args[1];
      const span = { setAttribute: () => {} };
      return (fn as (span: { setAttribute: () => void }) => Promise<unknown>)(span);
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

    mockPrismaFindUnique.mockResolvedValue({
      featureClickHouseDataSourceTraces: true,
    });

    // Dynamic import to get fresh module after mocks are set
    const mod = await import("../clickhouse-trace.service");
    ClickHouseTraceService = mod.ClickHouseTraceService;
  });

  describe("getAllTracesForProject()", () => {
    describe("when includeSpans is false or not provided", () => {
      it("returns traces with empty spans", async () => {
        const summaryRow = makeSummaryRow("trace-1");

        // First call: count query
        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          // Second call: summary query
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          // Third call: evaluation query
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
        const traces = result!.groups.flat();
        expect(traces).toHaveLength(1);
        expect(traces[0]!.spans).toEqual([]);
      });
    });

    describe("when traceIds is provided", () => {
      it("includes TraceId IN clause in the queries", async () => {
        const summaryRow = makeSummaryRow("trace-A");

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

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

        // Verify the data query (2nd call) contains the TraceId IN clause
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
        const summaryRow = makeSummaryRow("trace-A");

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

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
        const summaryRow = makeSummaryRow("trace-1");

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
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
        const summaryRow = makeSummaryRow("trace-1");
        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });
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

          // The data query (2nd call) includes the keyset cursor condition
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

    describe("when query is provided", () => {
      it("includes ILIKE clause and searchQuery param in both queries", async () => {
        const summaryRow = makeSummaryRow("trace-1");

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([]),
          });

        const service = new ClickHouseTraceService({
          project: { findUnique: mockPrismaFindUnique },
        } as never);

        const inputWithQuery = {
          ...baseInput,
          query: "hello world",
        } as GetAllTracesForProjectInput;

        const result = await service.getAllTracesForProject(
          inputWithQuery,
          protections,
        );

        expect(result).not.toBeNull();

        // Count query (1st call) contains ILIKE
        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).toContain(
          "ts.ComputedInput ILIKE {searchQuery:String}",
        );
        expect(countCall[0].query).toContain(
          "ts.ComputedOutput ILIKE {searchQuery:String}",
        );
        expect(countCall[0].query_params.searchQuery).toBe("%hello world%");

        // Data query (2nd call) contains ILIKE
        const dataCall = mockClickHouseQuery.mock.calls[1]!;
        expect(dataCall[0].query).toContain(
          "ts.ComputedInput ILIKE {searchQuery:String}",
        );
        expect(dataCall[0].query).toContain(
          "ts.ComputedOutput ILIKE {searchQuery:String}",
        );
        expect(dataCall[0].query_params.searchQuery).toBe("%hello world%");
      });
    });

    describe("when query is undefined", () => {
      it("does not include ILIKE clause in queries", async () => {
        const summaryRow = makeSummaryRow("trace-1");

        mockClickHouseQuery
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
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

        const countCall = mockClickHouseQuery.mock.calls[0]!;
        expect(countCall[0].query).not.toContain("ILIKE");
        expect(countCall[0].query_params.searchQuery).toBeUndefined();

        const dataCall = mockClickHouseQuery.mock.calls[1]!;
        expect(dataCall[0].query).not.toContain("ILIKE");
        expect(dataCall[0].query_params.searchQuery).toBeUndefined();
      });
    });

    describe("when includeSpans is true", () => {
      it("fetches and attaches spans to traces", async () => {
        const summaryRow = makeSummaryRow("trace-1");
        const spanRow = makeSpanRow("trace-1", "span-1");

        mockClickHouseQuery
          // 1st call: count query (fetchTracesWithPagination)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([{ total: "1" }]),
          })
          // 2nd call: summary query (fetchTracesWithPagination)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          // 3rd call: trace summary query (fetchTracesWithSpansJoined - summaries)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([summaryRow]),
          })
          // 4th call: spans query (fetchTracesWithSpansJoined - spans)
          .mockResolvedValueOnce({
            json: () => Promise.resolve([spanRow]),
          })
          // 5th call: evaluation query
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
});
