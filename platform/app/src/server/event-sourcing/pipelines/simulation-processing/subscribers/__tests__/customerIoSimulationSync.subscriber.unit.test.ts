import { describe, expect, it, vi } from "vitest";
import type { ProjectService } from "~/server/app-layer/projects/project.service";
import { CIO_SYNC_DEBOUNCE_TTL_MS } from "../customerIoSimulationSync.subscriber";
import type { NurturingService } from "../../../../../../../ee/billing/nurturing/nurturing.service";

import { SIMULATION_RUN_EVENT_TYPES } from "../../schemas/constants";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  type CustomerIoSimulationSyncSubscriberDeps,
  createCustomerIoSimulationSyncSubscriber,
} from "../customerIoSimulationSync.subscriber";

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
  toError: vi.fn((e) => (e instanceof Error ? e : new Error(String(e)))),
}));

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
    version: "2026-08-06",
    data: {
      scenarioRunId: "run-1",
      results: { verdict: "success" },
      durationMs: 1500,
    },
    metadata: {},
    ...overrides,
  } as unknown as SimulationProcessingEvent;
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

const CONTEXT = {
  tenantId: "project-1",
  aggregateId: "run-1",
  state: undefined,
};

describe("customerIoSimulationSync subscriber", () => {
  describe("delivery wiring", () => {
    it("attaches to the simulationRunState fold and only fires on finished events", () => {
      const subscriber = createCustomerIoSimulationSyncSubscriber(createDeps());

      expect(subscriber.fold).toBe("simulationRunState");
      expect(subscriber.events).toEqual([SIMULATION_RUN_EVENT_TYPES.FINISHED]);
    });

    /** @scenario 'Simulation sync subscriber uses project-scoped dedup ID for debouncing' */
    it("dedups per tenant with the CIO debounce TTL", () => {
      const subscriber = createCustomerIoSimulationSyncSubscriber(createDeps());
      const event = createEvent({ tenantId: "project-42" });

      expect(subscriber.dedupId?.(event)).toBe("cio-sim-sync-project-42");
      expect(subscriber.ttl).toBe(CIO_SYNC_DEBOUNCE_TTL_MS);
    });
  });

  describe("given an organization with no prior simulation runs across any project", () => {
    describe("when the first simulation is processed", () => {
      /** @scenario 'First simulation run identifies user with has_simulations true' */
      it("identifies user with has_simulations true and org-wide simulation_count 1", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(1),
        });
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handler(createEvent(), CONTEXT);

        expect(deps.nurturing.identifyUser).toHaveBeenCalledWith({
          userId: "user-1",
          traits: expect.objectContaining({
            has_simulations: true,
            simulation_count: 1,
            first_simulation_at: expect.any(String),
          }),
        });
      });

      /** @scenario 'First simulation fires immediately without debouncing' */
      it("calls Customer.io within the handler, without waiting on a timer", async () => {
        // The debounce is declarative — dedupId + ttl, applied by the
        // dispatcher — so the handler itself must never defer. Fake timers
        // are installed and deliberately never advanced: anything the
        // handler parked on a timer would leave these calls unmade.
        vi.useFakeTimers();
        try {
          const deps = createDeps({
            simulationCountFn: vi.fn().mockResolvedValue(1),
          });
          const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

          await subscriber.handler(createEvent(), CONTEXT);

          expect(deps.nurturing.identifyUser).toHaveBeenCalledTimes(1);
          expect(deps.nurturing.trackEvent).toHaveBeenCalledTimes(1);
        } finally {
          vi.useRealTimers();
        }
      });

      /** @scenario 'First simulation run fires first_simulation_ran event' */
      it("tracks first_simulation_ran event with project_id", async () => {
        const deps = createDeps({
          simulationCountFn: vi.fn().mockResolvedValue(1),
        });
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handler(createEvent(), CONTEXT);

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
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handler(createEvent(), CONTEXT);

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
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handler(createEvent(), CONTEXT);

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
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handler(createEvent(), CONTEXT);

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
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await subscriber.handler(createEvent(), CONTEXT);

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the event is not a finished event", () => {
    /** @scenario 'Simulation tracking is independent of scenario template creation' */
    it("does not call nurturing methods for started events", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await subscriber.handler(
        createEvent({ type: "lw.simulation_run.started" }),
        CONTEXT,
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });

    it("does not call nurturing methods for message_snapshot events", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await subscriber.handler(
        createEvent({ type: "lw.simulation_run.message_snapshot" }),
        CONTEXT,
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
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await expect(
        subscriber.handler(createEvent(), CONTEXT),
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
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await expect(
        subscriber.handler(createEvent(), CONTEXT),
      ).resolves.toBeUndefined();
    });
  });
});
