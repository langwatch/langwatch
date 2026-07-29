import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { EventSubscriberContext } from "~/server/event-sourcing/subscribers/eventSubscriber.types";
import {
  createMockNurturing,
  createMockProjectService,
} from "../../../shared/__tests__/support/nurtureFixtures";
import { CIO_SYNC_DEBOUNCE_TTL_MS } from "../../../shared/nurtureSync";
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

function createContext(tenantId = "project-1"): EventSubscriberContext {
  return { tenantId, aggregateId: "run-1" };
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

  describe("deduplication", () => {
    /** @scenario 'Simulation sync reactor uses project-scoped job ID for debouncing' */
    it("keys the dedup window on cio-sim-sync-{tenantId}", () => {
      const subscriber = createCustomerIoSimulationSyncSubscriber(createDeps());
      const dedup = subscriber.options?.deduplication;
      if (!dedup || dedup === "aggregate") {
        throw new Error("expected a custom deduplication config");
      }

      expect(dedup.makeId(createEvent({ tenantId: "project-42" }))).toBe(
        "cio-sim-sync-project-42",
      );
    });

    /** @scenario 'Subsequent simulation runs update org-wide count and timestamp with debouncing' */
    it("debounces over the shared Customer.io window", () => {
      const subscriber = createCustomerIoSimulationSyncSubscriber(createDeps());
      const dedup = subscriber.options?.deduplication;
      if (!dedup || dedup === "aggregate") {
        throw new Error("expected a custom deduplication config");
      }

      expect(dedup.ttlMs).toBe(CIO_SYNC_DEBOUNCE_TTL_MS);
      expect(dedup.extend).toBeUndefined();
      expect(dedup.replace).toBeUndefined();
    });
  });

  describe("event types", () => {
    it("subscribes to the terminal simulation event only", () => {
      const subscriber = createCustomerIoSimulationSyncSubscriber(createDeps());

      expect(subscriber.eventTypes).toEqual(["lw.simulation_run.finished"]);
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
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

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
        const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

        await subscriber.handle(createEvent(), createContext());

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

        await subscriber.handle(createEvent(), createContext());

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

        await subscriber.handle(createEvent(), createContext());

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

        await subscriber.handle(createEvent(), createContext());

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

      await subscriber.handle(createEvent(), createContext());

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
      expect(deps.nurturing.trackEvent).not.toHaveBeenCalled();
    });
  });

  describe("given the simulation is not in a finished state", () => {
    /** @scenario 'Simulation tracking is independent of scenario template creation' */
    it("does not call nurturing methods for started events", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await subscriber.handle(
        createEvent({ type: "lw.simulation_run.started" }),
        createContext(),
      );

      expect(deps.nurturing.identifyUser).not.toHaveBeenCalled();
    });

    it("does not call nurturing methods for message_snapshot events", async () => {
      const deps = createDeps();
      const subscriber = createCustomerIoSimulationSyncSubscriber(deps);

      await subscriber.handle(
        createEvent({ type: "lw.simulation_run.message_snapshot" }),
        createContext(),
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
        subscriber.handle(createEvent(), createContext()),
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
        subscriber.handle(createEvent(), createContext()),
      ).resolves.toBeUndefined();
    });
  });
});
