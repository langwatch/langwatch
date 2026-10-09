/**
 * @vitest-environment node
 *
 * scenario_run_succeeded: one per run that worked against a connected agent,
 * tracked against the organization admin, and the project's active day with
 * it.
 *
 * @see specs/analytics/posthog-guided-onboarding.feature
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SimulationProcessingEvent } from "../../schemas/events";
import {
  createScenarioRunMilestonesSubscriber,
  isConnectedAgentRunSucceeded,
  type ScenarioRunMilestonesSubscriberDeps,
} from "../scenarioRunMilestones.subscriber";

const { trackServerEvent } = vi.hoisted(() => ({ trackServerEvent: vi.fn() }));

vi.mock("~/server/posthog", () => ({ trackServerEvent }));

vi.mock("@langwatch/observability", () => ({
  createLogger: () => ({
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  }),
}));

const OCCURRED_AT = Date.UTC(2026, 8, 13, 10, 0, 0);

function finishedEvent(
  data: Record<string, unknown> = {},
): SimulationProcessingEvent {
  return {
    id: "event-1",
    aggregateId: "run-1",
    aggregateType: "simulation_run",
    tenantId: "project-1",
    createdAt: OCCURRED_AT,
    occurredAt: OCCURRED_AT,
    type: "lw.simulation_run.finished",
    version: "2026-08-06",
    data: {
      scenarioRunId: "run-1",
      scenarioId: "scenario-1",
      target: { type: "connected", referenceId: "agent-1" },
      results: { verdict: "success" },
      status: "SUCCESS",
      ...data,
    },
    metadata: {},
  } as unknown as SimulationProcessingEvent;
}

function createDeps(): ScenarioRunMilestonesSubscriberDeps & {
  trackActiveDay: ReturnType<typeof vi.fn>;
} {
  return {
    projects: {
      resolveOrgAdmin: vi.fn().mockResolvedValue({
        userId: "admin-1",
        organizationId: "org-1",
        firstMessage: true,
        onboardingVariant: "classic",
        organizationCreatedAt: new Date(OCCURRED_AT),
      }),
    },
    trackActiveDay: vi.fn().mockResolvedValue(undefined),
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

      expect(trackServerEvent).toHaveBeenCalledWith({
        userId: "admin-1",
        event: "scenario_run_succeeded",
        projectId: "project-1",
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

      expect(deps.trackActiveDay).toHaveBeenCalledWith({
        projectId: "project-1",
        source: "scenario_run",
        occurredAt: OCCURRED_AT,
      });
    });
  });

  describe("when the judge failed the agent", () => {
    /** @scenario "a scenario run whose verdict is failed still counts as succeeded" */
    it("still tracks scenario_run_succeeded", async () => {
      const deps = createDeps();
      const subscriber = createScenarioRunMilestonesSubscriber(deps);
      const event = finishedEvent({
        results: { verdict: "failure" },
        status: "FAILED",
      });

      expect(subscriber.when?.(event, context)).toBe(true);
      await subscriber.handler(event, context);

      expect(trackServerEvent).toHaveBeenCalledWith(
        expect.objectContaining({ event: "scenario_run_succeeded" }),
      );
    });

    it("counts a verdict of failure with no explicit status", () => {
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({ results: { verdict: "failure" }, status: undefined }),
        ),
      ).toBe(true);
    });
  });

  describe("when the run ended in an error", () => {
    /** @scenario "a scenario run that ended in an error is not tracked as succeeded" */
    it("tracks nothing, and marks no active day", async () => {
      const deps = createDeps();
      const subscriber = createScenarioRunMilestonesSubscriber(deps);
      const event = finishedEvent({
        results: { verdict: "inconclusive", error: "target unreachable" },
        status: "ERROR",
      });

      expect(subscriber.when?.(event, context)).toBe(false);
      await subscriber.handler(event, context);

      expect(trackServerEvent).not.toHaveBeenCalled();
      expect(deps.trackActiveDay).not.toHaveBeenCalled();
    });

    it("counts neither a cancelled run nor an inconclusive one without a status", () => {
      expect(
        isConnectedAgentRunSucceeded(finishedEvent({ status: "CANCELLED" })),
      ).toBe(false);
      expect(
        isConnectedAgentRunSucceeded(
          finishedEvent({
            results: { verdict: "inconclusive" },
            status: undefined,
          }),
        ),
      ).toBe(false);
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

      expect(trackServerEvent).not.toHaveBeenCalled();
      expect(deps.trackActiveDay).not.toHaveBeenCalled();
    });
  });

  describe("when the project has no admin", () => {
    it("tracks nothing", async () => {
      const deps = createDeps();
      (
        deps.projects.resolveOrgAdmin as ReturnType<typeof vi.fn>
      ).mockResolvedValue({
        userId: null,
        organizationId: null,
        firstMessage: false,
        onboardingVariant: null,
        organizationCreatedAt: null,
      });
      const subscriber = createScenarioRunMilestonesSubscriber(deps);

      await subscriber.handler(finishedEvent(), context);

      expect(trackServerEvent).not.toHaveBeenCalled();
    });
  });
});
