import { describe, expect, it, vi, beforeEach } from "vitest";
import { EventExplorerService } from "../event-explorer.service";
import type {
  EventExplorerRepository,
  RawEventRow,
  AggregateSearchResult,
} from "../repositories/event-explorer.repository";

vi.mock("~/server/event-sourcing/pipelineRegistry", () => ({
  getProjectionMetadata: vi.fn(() => [
    { projectionName: "traceMetrics", aggregateType: "Trace" },
    { projectionName: "experimentRun", aggregateType: "Experiment" },
  ]),
  getDejaViewProjections: vi.fn(() => [
    {
      projectionName: "traceMetrics",
      eventTypes: ["TraceIngested", "TraceUpdated"],
      init: () => ({ count: 0 }),
      apply: (state: { count: number }, _event: unknown) => ({
        count: state.count + 1,
      }),
    },
  ]),
}));

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

describe("EventExplorerService", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("discoverAggregates()", () => {
    describe("when projection names match registry entries", () => {
      it("queries repo with matching aggregate types", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        await service.discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({
            aggregateTypes: ["Trace"],
          }),
        );
      });
    });

    describe("when no projection names match", () => {
      it("returns empty projections array", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        const result = await service.discoverAggregates({
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
        const service = new EventExplorerService(repo);

        const result = await service.discoverAggregates({
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
        const service = new EventExplorerService(repo);

        await service.discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-06-15",
          tenantIds: [],
        });

        const call = (repo.findAggregates as ReturnType<typeof vi.fn>).mock.calls[0]![0];
        expect(call.sinceMs).toBe(new Date("2024-06-15").getTime());
      });
    });

    describe("when tenantIds are provided", () => {
      it("passes them through to repo", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        await service.discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: ["t1", "t2"],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantIds: ["t1", "t2"],
          }),
        );
      });
    });

    describe("when tenantIds are empty", () => {
      it("passes undefined to repo", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        await service.discoverAggregates({
          projectionNames: ["traceMetrics"],
          since: "2024-01-01",
          tenantIds: [],
        });

        expect(repo.findAggregates).toHaveBeenCalledWith(
          expect.objectContaining({
            tenantIds: undefined,
          }),
        );
      });
    });
  });

  describe("searchAggregates()", () => {
    describe("when tenantIds is empty", () => {
      it("passes undefined to repo", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        await service.searchAggregates({ query: "trace_abc", tenantIds: [] });

        expect(repo.searchAggregates).toHaveBeenCalledWith({
          query: "trace_abc",
          tenantIds: undefined,
        });
      });
    });

    describe("when tenantIds has values", () => {
      it("passes them through to repo", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        await service.searchAggregates({ query: "trace_abc", tenantIds: ["t1"] });

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
        const service = new EventExplorerService(repo);

        const result = await service.getAggregateEvents({
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
        const service = new EventExplorerService(repo);

        const result = await service.getAggregateEvents({
          aggregateId: "a1",
          tenantId: "t1",
          limit: 10,
        });

        expect(result[0]!.payload).toBe("not-json");
      });
    });
  });

  describe("computeProjectionState()", () => {
    describe("when projection not found in registry", () => {
      it("returns null state", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        const result = await service.computeProjectionState({
          aggregateId: "a1",
          tenantId: "t1",
          projectionName: "nonexistent",
          eventIndex: 0,
        });

        expect(result.state).toBeNull();
        expect(result.appliedEventCount).toBe(0);
      });
    });

    describe("when dejaView projection not found", () => {
      it("returns null state with event count", async () => {
        const rows: RawEventRow[] = [
          { eventId: "e1", eventType: "ExperimentStarted", eventTimestamp: "1700000000000", payload: "{}" },
        ];
        const repo = createMockRepo({
          findEventsByAggregate: vi.fn().mockResolvedValue(rows),
        });
        const service = new EventExplorerService(repo);

        // experimentRun is in projection metadata but NOT in dejaView projections
        const result = await service.computeProjectionState({
          aggregateId: "a1",
          tenantId: "t1",
          projectionName: "experimentRun",
          eventIndex: 0,
        });

        expect(result.state).toBeNull();
        expect(result.appliedEventCount).toBe(1);
        expect(result.aggregateType).toBe("Experiment");
      });
    });

    describe("when events match projection eventTypes", () => {
      it("folds them via apply function", async () => {
        const rows: RawEventRow[] = [
          { eventId: "e1", eventType: "TraceIngested", eventTimestamp: "1700000000000", payload: "{}" },
          { eventId: "e2", eventType: "TraceUpdated", eventTimestamp: "1700000001000", payload: "{}" },
        ];
        const repo = createMockRepo({
          findEventsByAggregate: vi.fn().mockResolvedValue(rows),
        });
        const service = new EventExplorerService(repo);

        const result = await service.computeProjectionState({
          aggregateId: "a1",
          tenantId: "t1",
          projectionName: "traceMetrics",
          eventIndex: 1,
        });

        expect(result.state).toEqual({ count: 2 });
        expect(result.appliedEventCount).toBe(2);
      });
    });

    describe("when events don't match projection eventTypes", () => {
      it("skips them", async () => {
        const rows: RawEventRow[] = [
          { eventId: "e1", eventType: "UnrelatedEvent", eventTimestamp: "1700000000000", payload: "{}" },
        ];
        const repo = createMockRepo({
          findEventsByAggregate: vi.fn().mockResolvedValue(rows),
        });
        const service = new EventExplorerService(repo);

        const result = await service.computeProjectionState({
          aggregateId: "a1",
          tenantId: "t1",
          projectionName: "traceMetrics",
          eventIndex: 0,
        });

        expect(result.state).toEqual({ count: 0 }); // init() returns {count:0}, no apply called
        expect(result.appliedEventCount).toBe(0);
      });
    });

    describe("when apply throws for an event", () => {
      it("skips that event and continues", async () => {
        const { getDejaViewProjections } = await vi.importMock<
          typeof import("~/server/event-sourcing/pipelineRegistry")
        >("~/server/event-sourcing/pipelineRegistry");
        (getDejaViewProjections as ReturnType<typeof vi.fn>).mockReturnValue([
          {
            projectionName: "traceMetrics",
            eventTypes: ["TraceIngested"],
            init: () => ({ count: 0 }),
            apply: (state: { count: number }, _event: unknown) => {
              if (state.count === 0) throw new Error("bad event");
              return { count: state.count + 1 };
            },
          },
        ]);

        const rows: RawEventRow[] = [
          { eventId: "e1", eventType: "TraceIngested", eventTimestamp: "1700000000000", payload: "{}" },
          { eventId: "e2", eventType: "TraceIngested", eventTimestamp: "1700000001000", payload: "{}" },
        ];
        const repo = createMockRepo({
          findEventsByAggregate: vi.fn().mockResolvedValue(rows),
        });
        const service = new EventExplorerService(repo);

        const result = await service.computeProjectionState({
          aggregateId: "a1",
          tenantId: "t1",
          projectionName: "traceMetrics",
          eventIndex: 1,
        });

        // First event throws (count===0), second event also throws (count still 0)
        expect(result.appliedEventCount).toBe(0);
      });
    });

    describe("when eventIndex limits events", () => {
      it("only processes events up to that index", async () => {
        const repo = createMockRepo();
        const service = new EventExplorerService(repo);

        await service.computeProjectionState({
          aggregateId: "a1",
          tenantId: "t1",
          projectionName: "traceMetrics",
          eventIndex: 5,
        });

        expect(repo.findEventsByAggregate).toHaveBeenCalledWith(
          expect.objectContaining({ limit: 6 }), // eventIndex + 1
        );
      });
    });
  });
});
