/**
 * scenario_run_succeeded: one per run that worked against a connected agent,
 * tracked against the organization admin, and the project's active day with
 * it.
 * @see specs/features/customer-io-nurturing-integration.feature
 */
import { createTenantId } from "@langwatch/eventing";
import {
  SIMULATION_EVENT_VERSIONS,
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { MemoryPostHogChannel } from "../../channels/memory/memory.posthog.channel.ts";
import { MemoryProjectActiveDayRepository } from "../../repositories/memory/memory.project-active-day.repository.ts";
import { ProjectActiveDayTrackerService } from "../../services/project-active-day-tracker.service.ts";
import {
  createScenarioRunMilestonesSubscriber,
  type ScenarioRunMilestonesSubscriberDeps,
} from "../scenario-run-milestones.subscriber.ts";

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({ debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() }),
}));

const OCCURRED_AT = Date.UTC(2026, 8, 13, 10, 0, 0);

function finishedEvent(
  data: Partial<SimulationRunFinishedEvent["data"]> = {},
): SimulationRunFinishedEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: createTenantId("project-1"),
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type: SIMULATION_RUN_EVENT_TYPES.FINISHED,
    version: SIMULATION_EVENT_VERSIONS.FINISHED,
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      target: { type: "connected", referenceId: "agent-1" },
      results: { verdict: "success", metCriteria: [], unmetCriteria: [] },
      status: "SUCCESS",
      ...data,
    },
  };
}

function createDeps(
  resolution: { userId: string; organizationId: string } | null = {
    userId: "admin-1",
    organizationId: "org-1",
  },
): ScenarioRunMilestonesSubscriberDeps & { posthog: MemoryPostHogChannel } {
  const posthog = MemoryPostHogChannel.create();
  const activeDayTracker = ProjectActiveDayTrackerService.create({
    posthog,
    repository: MemoryProjectActiveDayRepository.create(),
    resolveOrgAdmin: async () =>
      resolution && {
        ...resolution,
        onboardingVariant: "classic",
        organizationCreatedAt: null,
      },
  });
  return {
    resolveOrgAdmin: async () =>
      resolution && { ...resolution, onboardingVariant: "classic", organizationCreatedAt: null },
    posthog,
    activeDayTracker,
  };
}

const context = { tenantId: "project-1", aggregateId: "run-1", state: null };

describe("createScenarioRunMilestonesSubscriber()", () => {
  beforeEach(() => vi.clearAllMocks());

  describe("when a run against a connected agent finishes with the verdict success", () => {
    /** @scenario "a scenario run that finished against a connected agent is tracked as succeeded" */
    it("tracks scenario_run_succeeded against the admin with the ids, connected_agent and the experiment property", async () => {
      const deps = createDeps();
      const subscriber = createScenarioRunMilestonesSubscriber(deps);
      const event = finishedEvent();

      expect(subscriber.when?.(event, context)).toBe(true);
      await subscriber.handler(event, context);

      expect(deps.posthog.tracked).toContainEqual({
        userId: "admin-1",
        event: "scenario_run_succeeded",
        properties: {
          scenario_id: "scenario-1",
          run_id: "run-1",
          connected_agent: true,
          "$feature/experiment_onboarding_langy_guided": "control",
        },
      });
    });

    it("marks the project's active day with the scenario run source", async () => {
      const deps = createDeps();
      const subscriber = createScenarioRunMilestonesSubscriber(deps);

      await subscriber.handler(finishedEvent(), context);

      expect(deps.posthog.tracked).toContainEqual(
        expect.objectContaining({
          event: "project_active_day",
          properties: expect.objectContaining({ source: "scenario_run" }),
        }),
      );
    });
  });

  describe("when the run ended in an error", () => {
    /** @scenario "a scenario run that ended in an error is not tracked as succeeded" */
    it("tracks nothing", async () => {
      const deps = createDeps();
      const subscriber = createScenarioRunMilestonesSubscriber(deps);
      const event = finishedEvent({
        results: {
          verdict: "inconclusive",
          metCriteria: [],
          unmetCriteria: [],
          error: "target unreachable",
        },
        status: "ERROR",
      });

      expect(subscriber.when?.(event, context)).toBe(false);
      await subscriber.handler(event, context);

      expect(deps.posthog.tracked).toHaveLength(0);
    });
  });

  describe("when the run was not against a connected agent", () => {
    /** @scenario "a scenario run against anything but a connected agent is not tracked as succeeded" */
    it("tracks nothing for a prompt target or a run without a target", async () => {
      const deps = createDeps();
      const subscriber = createScenarioRunMilestonesSubscriber(deps);

      await subscriber.handler(
        finishedEvent({ target: { type: "prompt", referenceId: "prompt-1" } }),
        context,
      );
      await subscriber.handler(finishedEvent({ target: undefined }), context);

      expect(deps.posthog.tracked).toHaveLength(0);
    });
  });

  describe("when the project has no admin", () => {
    it("tracks nothing", async () => {
      const deps = createDeps(null);
      const subscriber = createScenarioRunMilestonesSubscriber(deps);

      await subscriber.handler(finishedEvent(), context);

      expect(deps.posthog.tracked).toHaveLength(0);
    });
  });
});
