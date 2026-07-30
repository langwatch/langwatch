import type { BuiltPipeline, Registry } from "@langwatch/event-sourcing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventExplorerService } from "../event-explorer.service";
import type {
  EventExplorerRepository,
  RawEventRow,
} from "../repositories/event-explorer.repository";

/** Two pipelines, one fold each — a projection name resolves through the
 * registry to the aggregate type of the pipeline that declares it. */
const registry = {
  all: () => [
    {
      aggregateType: "Trace",
      pipeline: {
        name: "Trace",
        folds: { traceMetrics: {} },
        maps: {},
      } as unknown as BuiltPipeline,
    },
    {
      aggregateType: "Experiment",
      pipeline: {
        name: "Experiment",
        folds: {},
        maps: { experimentRun: {} },
      } as unknown as BuiltPipeline,
    },
  ],
} as unknown as Registry;

function createMockRepo(
  overrides: Partial<Record<keyof EventExplorerRepository, unknown>> = {},
): EventExplorerRepository {
  return {
    findAggregates: vi.fn().mockResolvedValue([]),
    searchAggregates: vi.fn().mockResolvedValue([]),
    findEventsByAggregate: vi.fn().mockResolvedValue([]),
    ...overrides,
  } as unknown as EventExplorerRepository;
}

function createService(repo: EventExplorerRepository): EventExplorerService {
  return new EventExplorerService(repo, registry);
}

describe("EventExplorerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("discoverAggregates()", () => {
    describe("when projection names match registered folds", () => {
      it("queries repo with matching aggregate types", async () => {
        const repo = createMockRepo();

        await createService(repo).discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({ aggregateTypes: ["Trace"] }),
        );
      });
    });

    describe("when a projection name matches a registered map", () => {
      it("resolves it to the declaring pipeline's aggregate type", async () => {
        const repo = createMockRepo();

        await createService(repo).discoverAggregates({
          projectionNames: ["experimentRun"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({ aggregateTypes: ["Experiment"] }),
        );
      });
    });

    describe("when no projection names match", () => {
      it("returns empty projections array", async () => {
        const repo = createMockRepo();

        const result = await createService(repo).discoverAggregates({
          projectionNames: ["nonexistent"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(result.projections).toEqual([]);
        expect(repo.findAggregates).not.toHaveBeenCalled();
      });
    });

    describe("when repo returns counts for multiple tenants", () => {
      it("groups by projection and sums aggregate counts", async () => {
        const repo = createMockRepo({
          findAggregates: vi.fn().mockResolvedValue([
            { aggregateType: "Trace", tenantId: "t1", aggregateCount: 10 },
            { aggregateType: "Trace", tenantId: "t2", aggregateCount: 20 },
          ]),
        });

        const result = await createService(repo).discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(result.projections).toHaveLength(1);
        expect(result.projections[0]!.aggregateCount).toBe(30);
        expect(result.projections[0]!.tenantBreakdown).toHaveLength(2);
      });
    });

    describe("when since is a date string", () => {
      it("converts to milliseconds for repo query", async () => {
        const repo = createMockRepo();

        await createService(repo).discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-06-15",
          tenantIds: [],
        });

        const call = (repo.findAggregates as ReturnType<typeof vi.fn>).mock
          .calls[0]![0];
        expect(call.sinceMs).toBe(new Date("2024-06-15").getTime());
      });
    });

    describe("when tenantIds are provided", () => {
      it("passes them through to repo", async () => {
        const repo = createMockRepo();

        await createService(repo).discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: ["t1", "t2"],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({ tenantIds: ["t1", "t2"] }),
        );
      });
    });

    describe("when tenantIds are empty", () => {
      it("passes undefined to repo", async () => {
        const repo = createMockRepo();

        await createService(repo).discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({ tenantIds: undefined }),
        );
      });
    });
  });

  describe("searchAggregates()", () => {
    describe("when tenantIds is empty", () => {
      it("passes undefined to repo", async () => {
        const repo = createMockRepo();

        await createService(repo).searchAggregates({
          query: "trace_abc",
          tenantIds: [],
        });

        expect(repo.searchAggregates).toHaveBeenCalledWith({
          query: "trace_abc",
          tenantIds: undefined,
        });
      });
    });

    describe("when tenantIds has values", () => {
      it("passes them through to repo", async () => {
        const repo = createMockRepo();

        await createService(repo).searchAggregates({
          query: "trace_abc",
          tenantIds: ["t1"],
        });

        expect(repo.searchAggregates).toHaveBeenCalledWith({
          query: "trace_abc",
          tenantIds: ["t1"],
        });
      });
    });
  });

  describe("getAggregateEvents()", () => {
    describe("when payload is valid JSON string", () => {
      it("parses it to object", async () => {
        const rows: RawEventRow[] = [
          {
            eventId: "e1",
            eventType: "TraceIngested",
            eventTimestamp: "1700000000000",
            payload: '{"key":"value"}',
          },
        ];
        const repo = createMockRepo({
          findEventsByAggregate: vi.fn().mockResolvedValue(rows),
        });

        const result = await createService(repo).getAggregateEvents({
          aggregateId: "a1",
          tenantId: "t1",
          limit: 10,
        });

        expect(result[0]!.payload).toEqual({ key: "value" });
      });
    });

    describe("when payload is invalid JSON", () => {
      it("returns raw string as payload", async () => {
        const rows: RawEventRow[] = [
          {
            eventId: "e1",
            eventType: "TraceIngested",
            eventTimestamp: "1700000000000",
            payload: "not-json",
          },
        ];
        const repo = createMockRepo({
          findEventsByAggregate: vi.fn().mockResolvedValue(rows),
        });

        const result = await createService(repo).getAggregateEvents({
          aggregateId: "a1",
          tenantId: "t1",
          limit: 10,
        });

        expect(result[0]!.payload).toBe("not-json");
      });
    });
  });
});
