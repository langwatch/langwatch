import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Protections } from "~/server/elasticsearch/protections";
import type { Trace } from "~/server/tracer/types";
import type { GetAllTracesForProjectInput } from "../types";
import { TraceService } from "../trace.service";

// ---------------------------------------------------------------------------
// Hoisted mocks
// ---------------------------------------------------------------------------
const {
  mockGetAllTracesForProjectCH,
  mockIsClickHouseEnabled,
  mockGetAllTracesForProjectES,
} = vi.hoisted(() => ({
  mockGetAllTracesForProjectCH: vi.fn(),
  mockIsClickHouseEnabled: vi.fn(),
  mockGetAllTracesForProjectES: vi.fn(),
}));

const mockClickHouseInstance = {
  isClickHouseEnabled: mockIsClickHouseEnabled,
  getAllTracesForProject: mockGetAllTracesForProjectCH,
};

const mockElasticInstance = {
  getAllTracesForProject: mockGetAllTracesForProjectES,
};

const mockEvalInstance = {
  isClickHouseEnabled: vi.fn().mockResolvedValue(false),
};

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
    describe("when ClickHouse is enabled", () => {
      beforeEach(() => {
        mockIsClickHouseEnabled.mockResolvedValue(true);
      });

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
    });
  });
});
