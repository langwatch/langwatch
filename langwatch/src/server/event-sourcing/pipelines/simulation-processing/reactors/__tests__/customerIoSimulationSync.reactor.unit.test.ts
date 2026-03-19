import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NurturingService } from "../../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../../app-layer/projects/project.service";
import type { ReactorContext } from "../../../../reactors/reactor.types";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  createCustomerIoSimulationSyncReactor,
  type CustomerIoSimulationSyncReactorDeps,
} from "../customerIoSimulationSync.reactor";

// Suppress logger output
vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
}));

function createFoldState(
  overrides: Partial<SimulationRunStateData> = {},
): SimulationRunStateData {
  return {
    ScenarioRunId: "run-1",
    ScenarioId: "scenario-1",
    BatchRunId: "batch-1",
    ScenarioSetId: "set-1",
    Status: "SUCCESS",
    Name: "Test simulation",
    Description: null,
    Metadata: null,
    Messages: [],
    TraceIds: [],
    Verdict: "success",
    Reasoning: null,
    MetCriteria: [],
    UnmetCriteria: [],
    Error: null,
    DurationMs: 1500,
    StartedAt: Date.now() - 1500,
    QueuedAt: null,
    CreatedAt: Date.now() - 2000,
    UpdatedAt: Date.now(),
    FinishedAt: Date.now(),
    ArchivedAt: null,
    LastSnapshotOccurredAt: 0,
    ...overrides,
  };
}

function createEvent(
  overrides: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: Date.now(),
    occurredAt: Date.now(),
    type: "lw.simulation_run.finished",
    version: "2026-02-01",
    data: {
      scenarioRunId: "run-1",
      results: { verdict: "success" },
      durationMs: 1500,
    },
    metadata: {},
    ...overrides,
  } as unknown as SimulationProcessingEvent;
}

function createContext(
  foldState: SimulationRunStateData,
  tenantId = "project-1",
): ReactorContext<SimulationRunStateData> {
  return {
    tenantId,
    aggregateId: "run-1",
    foldState,
  };
}

function createMockNurturing(): NurturingService {
  return {
    identifyUser: vi.fn().mockResolvedValue(undefined),
    trackEvent: vi.fn().mockResolvedValue(undefined),
    groupUser: vi.fn().mockResolvedValue(undefined),
    batch: vi.fn().mockResolvedValue(undefined),
  } as unknown as NurturingService;
}

function createMockProjectService(
  overrides: Partial<{ resolveOrgAdmin: ReturnType<typeof vi.fn> }> = {},
): ProjectService {
  return {
    resolveOrgAdmin: vi.fn().mockResolvedValue({
      userId: "user-1",
      organizationId: "org-1",
      firstMessage: false,
    }),
    ...overrides,
  } as unknown as ProjectService;
}

function createDeps(
  overrides: Partial<CustomerIoSimulationSyncReactorDeps> = {},
): CustomerIoSimulationSyncReactorDeps {
  return {
    projects: createMockProjectService(),
    nurturing: createMockNurturing(),
    simulationCountFn: vi.fn().mockResolvedValue(0),
    ...overrides,
  };
}

describe("customerIoSimulationSync reactor", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("makeJobId", () => {
    it("returns cio-sim-sync-{tenantId}", () => {
      const deps = createDeps();
      const reactor = createCustomerIoSimulationSyncReactor(deps);
      const event = createEvent({ tenantId: "project-42" });

      const jobId = reactor.options!.makeJobId!({
        event,
        foldState: createFoldState(),
      });

      expect(jobId).toBe("cio-sim-sync-project-42");
    });
  });

  describe("given an organization with no prior simulation runs across any project", () => {
    describe("when the first simulation is processed", () => {
      it("identifies user with has_simulations true and org-wide simulation_count 1", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(0),
        });
        const reactor = createCustomerIoSimulationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            has_simulations: true,
            simulation_count: 1,
            first_simulation_at: expect.any(String),
          }),
        });
      });

      it("tracks first_simulation_ran event with project_id", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(0),
        });
        const reactor = createCustomerIoSimulationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(deps.nurturing.trackEvent).toHaveBeenCalledWith({
          userId: "user-1",
          event: "first_simulation_ran",
          properties: expect.objectContaining({
            project_id: "project-1",
          }),
        });
      });
    });
  });

  describe("given an organization that already has simulation runs", () => {
    describe("when a new simulation is processed", () => {
      it("identifies user with updated org-wide simulation_count and last_simulation_at", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(5),
        });
        const reactor = createCustomerIoSimulationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            simulation_count: 6,
            last_simulation_at: expect.any(String),
          }),
        });
      });

      it("does not track first_simulation_ran event", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(5),
        });
        const reactor = createCustomerIoSimulationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the simulation count query fails", () => {
    describe("when simulationCountFn returns null", () => {
      it("skips nurturing sync to avoid false milestones", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(null),
        });
        const reactor = createCustomerIoSimulationSyncReactor(deps);

        await reactor.handle(
          createEvent(),
          createContext(createFoldState()),
        );

        expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
        expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
      });
    });
  });

  describe("given the project is not found", () => {
    it("does not call nurturing methods", async () => {
      const deps = createDeps({
        projects: createMockProjectService({
          resolveOrgAdmin: vi.fn().mockResolvedValue({
            userId: null,
            organizationId: null,
            firstMessage: false,
          }),
        }),
      });
      const reactor = createCustomerIoSimulationSyncReactor(deps);

      await reactor.handle(
        createEvent(),
        createContext(createFoldState()),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the simulation is not in a finished state", () => {
    it("does not call nurturing methods for started events", async () => {
      const deps = createDeps();
      const reactor = createCustomerIoSimulationSyncReactor(deps);

      await reactor.handle(
        createEvent({ type: "lw.simulation_run.started" } as any),
        createContext(createFoldState({ Status: "IN_PROGRESS" })),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });

    it("does not call nurturing methods for message_snapshot events", async () => {
      const deps = createDeps();
      const reactor = createCustomerIoSimulationSyncReactor(deps);

      await reactor.handle(
        createEvent({ type: "lw.simulation_run.message_snapshot" } as any),
        createContext(createFoldState({ Status: "IN_PROGRESS" })),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const reactor = createCustomerIoSimulationSyncReactor(deps);

      await expect(
        reactor.handle(createEvent(), createContext(createFoldState())),
      ).resolves.toBeUndefined();
    });
  });

  describe("given resolveOrgAdmin throws", () => {
    it("does not propagate the error", async () => {
      const deps = createDeps({
        projects: createMockProjectService({
          resolveOrgAdmin: vi.fn().mockRejectedValue(new Error("DB down")),
        }),
      });
      const reactor = createCustomerIoSimulationSyncReactor(deps);

      await expect(
        reactor.handle(createEvent(), createContext(createFoldState())),
      ).resolves.toBeUndefined();
    });
  });
});
