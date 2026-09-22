import { createLogger } from "@langwatch/observability";
import type { OrgAdminResolution } from "~/server/app-layer/projects/project.service";
import { onboardingExperimentProperties } from "~/server/onboarding/guided-onboarding.experiment";
import type { ProjectActiveDayTracker } from "~/server/onboarding/project-active-day";
import { trackServerEvent } from "~/server/posthog";
import { UNGRADED_RUN_STATUSES } from "~/server/scenarios/scenario-run-evaluators";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunFinishedEvent,
} from "../schemas/events";
import { isSimulationRunFinishedEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:scenario-run-milestones",
);

export interface ScenarioRunMilestonesSubscriberDeps {
  projects: {
    resolveOrgAdmin(projectId: string): Promise<OrgAdminResolution>;
  };
  trackActiveDay: ProjectActiveDayTracker;
}

/**
 * A run that worked against a connected agent: it finished with a verdict,
 * whichever way the judge decided. A run that ended in an error, a target it
 * could not reach or a timeout finishes with an ungraded status and is not
 * one. Pure and synchronous, so the pipeline can ask it before enqueue.
 */
export function isConnectedAgentRunSucceeded(
  event: SimulationProcessingEvent,
): boolean {
  if (!isSimulationRunFinishedEvent(event)) return false;
  const { target, status, results } = event.data;
  if (target?.type !== "connected") return false;
  const explicit = status?.toUpperCase();
  if (explicit && UNGRADED_RUN_STATUSES.has(explicit)) return false;
  if (explicit === "SUCCESS" || explicit === "FAILED" || explicit === "FAILURE")
    return true;
  return results?.verdict === "success" || results?.verdict === "failure";
}

/**
 * The product milestones of a finished scenario run, tracked against the
 * organization admin the way the first trace is: `scenario_run_succeeded`
 * for a run that worked against a connected agent, and the project's active
 * day when it is the first signal of the day.
 */
export function createScenarioRunMilestonesSubscriber(
  deps: ScenarioRunMilestonesSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],
    when: (event) => isConnectedAgentRunSucceeded(event),

    async handler(event: SimulationProcessingEvent): Promise<void> {
      if (!isConnectedAgentRunSucceeded(event)) return;
      await trackScenarioRunSucceeded(
        deps,
        event as SimulationRunFinishedEvent,
      );
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
    const { userId, onboardingVariant } =
      await deps.projects.resolveOrgAdmin(projectId);
    if (!userId) {
      logger.warn(
        { projectId, scenarioRunId },
        "No admin user found for project, scenario_run_succeeded not tracked",
      );
      return;
    }

    trackServerEvent({
      userId,
      event: "scenario_run_succeeded",
      projectId,
      properties: {
        scenario_id: scenarioId ?? null,
        run_id: scenarioRunId,
        connected_agent: true,
        ...onboardingExperimentProperties(onboardingVariant),
      },
    });
  } catch (error) {
    logger.error(
      { projectId, scenarioRunId, error },
      "Failed to track scenario_run_succeeded, the milestone is discarded",
    );
  }

  await deps.trackActiveDay({
    projectId,
    source: "scenario_run",
    occurredAt: event.occurredAt,
  });
}
