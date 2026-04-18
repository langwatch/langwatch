import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/elasticsearch/protections";
import type { Trace } from "~/server/tracer/types";
import type { GetAllTracesForProjectInput } from "../types";
import {
  AmbiguousTraceIdPrefixError,
  TraceService,
} from "../trace.service";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetAllTracesForProjectCH,
  mockGetAllTracesForProjectES,
  mockGetTracesWithSpansCH,
  mockResolveTraceIdByPrefixCH,
} = vi.hoisted(() => ({
  mockGetAllTracesForProjectCH: vi.fn(),
  mockGetAllTracesForProjectES: vi.fn(),
  mockGetTracesWithSpansCH: vi.fn(),
  mockResolveTraceIdByPrefixCH: vi.fn(),
}));

const mockClickHouseInstance = {
  getAllTracesForProject: mockGetAllTracesForProjectCH,
  getTracesWithSpans: mockGetTracesWithSpansCH,
  resolveTraceIdByPrefix: mockResolveTraceIdByPrefixCH,
};

const mockElasticInstance = {
  getAllTracesForProject: mockGetAllTracesForProjectES,
};

const mockEvalInstance = {};

vi.mock("../clickhouse-trace.service", () => ({
  ClickHouseTraceService: Object.assign(vi.fn(), {
    create: () => mockClickHouseInstance,
  }),
}));

vi.mock("../elasticsearch-trace.service", () => ({
  ElasticsearchTraceService: Object.assign(vi.fn(), {
    create: () => mockElasticInstance,
  }),
}));

vi.mock("~/server/evaluations/evaluation.service", () => ({
  EvaluationService: Object.assign(vi.fn(), {
    create: () => mockEvalInstance,
  }),
}));

vi.mock("~/server/db", () => ({
  prisma: {},
}));

vi.mock("langwatch", () => ({
  getLangWatchTracer: () => ({
    withActiveSpan: (
      _name: string,
      _opts: unknown,
      fn: (span: { setAttribute: () => void }) => Promise<unknown>
    ) => fn({ setAttribute: () => {} }),
  }),
}));

describe("TraceService", () => {
  const mockPrisma = {} as never;
  let service: TraceService;

  const protections: Protections = {
    canSeeCosts: true,
    canSeePiiData: true,
    canSeeTopics: true,
  } as Protections;

  const input = {
    projectId: "proj_123",
    startDate: Date.now() - 86400000,
    endDate: Date.now(),
    pageSize: 10,
    pageOffset: 0,
  } as GetAllTracesForProjectInput;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TraceService(mockPrisma);
  });

  describe("getAllTracesForProject()", () => {
    it("passes options to the ClickHouse service", async () => {
      const options = { includeSpans: true };
      mockGetAllTracesForProjectCH.mockResolvedValue({
        groups: [],
        totalHits: 0,
        traceChecks: {},
      });

      await service.getAllTracesForProject(input, protections, options);

      expect(mockGetAllTracesForProjectCH).toHaveBeenCalledWith(
        input,
        protections,
        options,
      );
    });

    it("passes empty options when none provided", async () => {
      mockGetAllTracesForProjectCH.mockResolvedValue({
        groups: [],
        totalHits: 0,
        traceChecks: {},
      });

      await service.getAllTracesForProject(input, protections);

      expect(mockGetAllTracesForProjectCH).toHaveBeenCalledWith(
        input,
        protections,
        {},
      );
    });

    it("throws when ClickHouse returns null", async () => {
      mockGetAllTracesForProjectCH.mockResolvedValue(null);

      await expect(
        service.getAllTracesForProject(input, protections),
      ).rejects.toThrow(
        "ClickHouse is enabled but returned null for getAllTracesForProject",
      );
    });
  });

  describe("getById()", () => {
    const projectId = "proj_123";
    const fullId = "63dc535cea6335c506bc81ef3543a07d";
    const prefix20 = fullId.slice(0, 20);
    const sampleTrace = { trace_id: fullId, spans: [] } as unknown as Trace;

    describe("when an exact trace ID match exists", () => {
      it("returns the trace without attempting prefix resolution", async () => {
        mockGetTracesWithSpansCH.mockResolvedValue([sampleTrace]);

        const result = await service.getById(projectId, fullId, protections);

        expect(result).toBe(sampleTrace);
        expect(mockResolveTraceIdByPrefixCH).not.toHaveBeenCalled();
      });
    });

    describe("when the input is a prefix shorter than a full ID", () => {
      it("resolves to the full trace when exactly one match exists", async () => {
        mockGetTracesWithSpansCH
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([sampleTrace]);
        mockResolveTraceIdByPrefixCH.mockResolvedValue([fullId]);

        const result = await service.getById(projectId, prefix20, protections);

        expect(result).toBe(sampleTrace);
        expect(mockResolveTraceIdByPrefixCH).toHaveBeenCalledWith(
          projectId,
          prefix20,
          2,
        );
        // Second fetch uses the resolved full ID
        expect(mockGetTracesWithSpansCH).toHaveBeenNthCalledWith(
          2,
          projectId,
          [fullId],
          protections,
        );
      });

      it("throws AmbiguousTraceIdPrefixError when the prefix matches multiple traces", async () => {
        mockGetTracesWithSpansCH.mockResolvedValue([]);
        mockResolveTraceIdByPrefixCH.mockResolvedValue([
          fullId,
          "63dc535cea6335c506bc99990000ffff",
        ]);

        await expect(
          service.getById(projectId, prefix20, protections),
        ).rejects.toBeInstanceOf(AmbiguousTraceIdPrefixError);
      });

      it("returns undefined when the prefix matches no traces", async () => {
        mockGetTracesWithSpansCH.mockResolvedValue([]);
        mockResolveTraceIdByPrefixCH.mockResolvedValue([]);

        const result = await service.getById(projectId, prefix20, protections);

        expect(result).toBeUndefined();
      });
    });

    describe("when the input is too short to be a meaningful prefix", () => {
      it("returns undefined without querying by prefix", async () => {
        mockGetTracesWithSpansCH.mockResolvedValue([]);

        const result = await service.getById(projectId, "abc", protections);

        expect(result).toBeUndefined();
        expect(mockResolveTraceIdByPrefixCH).not.toHaveBeenCalled();
      });
    });
  });
});
