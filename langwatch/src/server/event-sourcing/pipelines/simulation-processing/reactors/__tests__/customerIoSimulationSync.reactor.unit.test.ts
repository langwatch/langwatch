import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { NurturingService } from "../../../../../../../ee/billing/nurturing/nurturing.service";
import type { ProjectService } from "../../../../../app-layer/projects/project.service";
import type { TriggerContext } from "../../../../pipeline/processManagerDefinition";
import type { SimulationRunStateData } from "../../projections/simulationRunState.foldProjection";
import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  type CustomerIoSimulationSyncSubscriberDeps,
  createCustomerIoSimulationSyncSubscriber,
} from "../customerIoSimulationSync.reactor";

// Suppress logger output
vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

vi.mock("~/utils/posthogErrorCapture", () => ({
  captureException: vi.fn(),
  toError: vi.fn((e) => e instanceof Error ? e : new Error(String(e))),
}));

function createState(
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
    TotalCost: null,
    RoleCosts: {},
    RoleLatencies: {},
    TraceMetrics: {},
    StartedAt: Date.now() - 1500,
    QueuedAt: null,
    CreatedAt: Date.now() - 2000,
    UpdatedAt: Date.now(),
    FinishedAt: Date.now(),
    ArchivedAt: null,
    CancellationRequestedAt: null,
    LastSnapshotOccurredAt: 0,
    LastEventOccurredAt: 0,
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
  state: SimulationRunStateData,
  tenantId = "project-1",
): TriggerContext<SimulationRunStateData> {
  return {
    tenantId,
    aggregateId: "run-1",
    state,
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
  overrides: Partial<CustomerIoSimulationSyncSubscriberDeps> = {},
): CustomerIoSimulationSyncSubscriberDeps {
  return {
    projects: createMockProjectService(),
    nurturing: createMockNurturing(),
    simulationCountFn: vi.fn().mockResolvedValue(1),
    ...overrides,
  };
}

describe("customerIoSimulationSync subscriber", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-03-15T12:00:00Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("dedupId", () => {
    /** @scenario 'Simulation sync reactor uses project-scoped job ID for debouncing' */
    it("scopes the collapse identity to the tenant", () => {
      const deps = createDeps();
      const { spec } = createCustomerIoSimulationSyncSubscriber(deps);
      const event = createEvent({ tenantId: "project-42" });

      expect(spec.dedupId!(event)).toBe("project-42");
    });
  });

  describe("given an organization with no prior simulation runs across any project", () => {
    describe("when the first simulation is processed", () => {
      /** @scenario 'First simulation run identifies user with has_simulations true' */
      /** @scenario 'First simulation fires immediately without debouncing' */
      it("identifies user with has_simulations true and org-wide simulation_count 1", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(1),
        });
        const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

        await spec.handler(
          createEvent(),
          createContext(createState()),
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

      /** @scenario 'First simulation run fires first_simulation_ran event' */
      it("tracks first_simulation_ran event with project_id", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(1),
        });
        const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

        await spec.handler(
          createEvent(),
          createContext(createState()),
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
      /** @scenario 'Subsequent simulation runs update org-wide count and timestamp with debouncing' */
      it("identifies user with updated org-wide simulation_count and last_simulation_at", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(6),
        });
        const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

        await spec.handler(
          createEvent(),
          createContext(createState()),
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
          simulationCountFn: vi.fn().mockResolvedValue(6),
        });
        const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

        await spec.handler(
          createEvent(),
          createContext(createState()),
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
        const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

        await spec.handler(
          createEvent(),
          createContext(createState()),
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
      const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

      await spec.handler(
        createEvent(),
        createContext(createState()),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the simulation is not in a finished state", () => {
    /** @scenario 'Simulation tracking is independent of scenario template creation' */
    it("subscribes only to FINISHED events, so started and message_snapshot events never reach the handler", () => {
      const deps = createDeps();
      const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

      expect(spec.events).toEqual([SIMULATION_RUN_EVENT_TYPES.FINISHED]);
      expect(spec.events).not.toContain(SIMULATION_RUN_EVENT_TYPES.STARTED);
      expect(spec.events).not.toContain(
        SIMULATION_RUN_EVENT_TYPES.MESSAGE_SNAPSHOT,
      );
    });
  });

  describe("given the nurturing service throws", () => {
    it("does not propagate the error", async () => {
      const nurturing = createMockNurturing();
      vi.mocked(nurturing.identifyUser).mockRejectedValue(
        new Error("CIO down"),
      );
      const deps = createDeps({ nurturing });
      const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

      await expect(
        spec.handler(createEvent(), createContext(createState())),
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
      const { spec } = createCustomerIoSimulationSyncSubscriber(deps);

      await expect(
        spec.handler(createEvent(), createContext(createState())),
      ).resolves.toBeUndefined();
    });
  });
});
