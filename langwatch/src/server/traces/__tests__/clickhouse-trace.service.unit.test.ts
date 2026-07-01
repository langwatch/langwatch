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
        // The single failed query is not followed by per-batch retries.
        expect(mockClickHouseQuery).toHaveBeenCalledTimes(1);
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
        expect(summaryCall.query_params.sumFromMs).toBe(
          1_000_000 - TWO_DAYS_MS,
        );
        expect(summaryCall.query_params.sumToMs).toBe(2_000_000 + TWO_DAYS_MS);
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
        expect(summaryCall.query_params.sumFromMs).toBe(1_000_000 - TWO_DAYS_MS);
        expect(summaryCall.query_params.sumToMs).toBe(2_000_000 + TWO_DAYS_MS);
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
        expect(summaryCall.query_params.sumFromMs).toBeUndefined();
        expect(summaryCall.query_params.sumToMs).toBeUndefined();
      });
    });
  });
});
