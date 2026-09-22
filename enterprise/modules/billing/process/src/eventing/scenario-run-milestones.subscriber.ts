import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import { onboardingExperimentProperties } from "@langwatch/onboarding-contract";
import {
  SIMULATION_RUN_EVENT_TYPES,
  type SimulationProcessingEvent,
  type SimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";

import type { PostHogChannel } from "../channels/posthog.channel.ts";
import { isConnectedAgentRunSucceeded } from "../rules/scenario-run-milestones.rules.ts";
import type {
  ProjectActiveDayTrackerService,
  ProjectAdminResolution,
} from "../services/project-active-day-tracker.service.ts";

const logger = createLogger("langwatch:billing:scenario-run-milestones");

export interface ScenarioRunMilestonesSubscriberDeps {
  /** The peer read on OrganizationApi, composed and injected at boot. */
  resolveOrgAdmin: (projectId: string) => Promise<ProjectAdminResolution | null>;
  posthog: PostHogChannel;
  activeDayTracker: ProjectActiveDayTrackerService;
}

/**
 * A finished run's milestones, tracked against the admin the way the first
 * trace is: `scenario_run_succeeded` against a connected agent, plus the
 * project's active day when this is the first signal of the day.
 */
export function createScenarioRunMilestonesSubscriber(
  deps: ScenarioRunMilestonesSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    when: (event) => isConnectedAgentRunSucceeded(event),

    async handler(event: SimulationProcessingEvent): Promise<void> {
      if (!isConnectedAgentRunSucceeded(event)) return;
      await trackScenarioRunSucceeded(deps, event);
    },
  };
}

async function trackScenarioRunSucceeded(
  deps: ScenarioRunMilestonesSubscriberDeps,
  event: SimulationRunFinishedEvent,
): Promise<void> {
  const projectId = String(event.tenantId);
  const { scenarioRunId, scenarioId } = event.data;

  try {
    const admin = await deps.resolveOrgAdmin(projectId);
    if (!admin?.userId) {
      logger.warn(
        { projectId, scenarioRunId },
        "No admin user found for project, scenario_run_succeeded not tracked",
      );
      return;
    }

    deps.posthog.track({
      userId: admin.userId,
      event: "scenario_run_succeeded",
      properties: {
        scenario_id: scenarioId ?? null,
        run_id: scenarioRunId,
        connected_agent: true,
        ...onboardingExperimentProperties(admin.onboardingVariant),
      },
    });
  } catch (error) {
    logger.error(
      { projectId, scenarioRunId, error },
      "Failed to track scenario_run_succeeded, the milestone is discarded",
    );
  }

  await deps.activeDayTracker.track({
    projectId,
    source: "scenario_run",
    occurredAt: event.occurredAt,
  });
}
