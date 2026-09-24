import type { SubscriberSpec } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  SIMULATION_RUN_EVENT_TYPES,
  UNGRADED_RUN_STATUSES,
  isSimulationRunFinishedEvent,
} from "@langwatch/scenario-contract";
import type {
  RunEvaluators,
  ScenarioEvaluationsJobPayload,
  SimulationProcessingEvent,
  SimulationRunFinishedEventData,
} from "@langwatch/scenario-contract";
import { extractSuiteId } from "@langwatch/suite-contract";
import { nowInstant } from "@langwatch/time";

const logger = createLogger("langwatch:simulation-processing:scenario-evaluations");

export interface ScenarioEvaluationsSubscriberDeps {
  /** The attachments the run's suite and plan carry, and the suite id. */
  loadRunAttachments: (params: {
    projectId: string;
    scenarioId: string;
    planId: string | null;
  }) => Promise<RunEvaluators>;
  /** Queues the evaluation job for the run. */
  enqueue: (payload: ScenarioEvaluationsJobPayload) => Promise<void>;
}

/**
 * The scenario id a finished run should be evaluated under, or `null`:
 * its results already carry evaluations, its status has no conversation to
 * grade, or it names no scenario.
 */
function pickScenarioIdToEvaluate(params: {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string | undefined;
  status: SimulationRunFinishedEventData["status"];
  results: SimulationRunFinishedEventData["results"];
}): string | null {
  const { tenantId, scenarioRunId, scenarioId, status, results } = params;

  if (results?.evaluations) {
    logger.debug(
      { tenantId, scenarioRunId },
      "Run finished with its own evaluations, not evaluated again",
    );
    return null;
  }
  if (status && UNGRADED_RUN_STATUSES.has(status)) return null;
  if (!scenarioId) {
    logger.warn(
      { tenantId, scenarioRunId },
      "Finished event names no scenario, the run is not evaluated",
    );
    return null;
  }
  return scenarioId;
}

/** The first attempt of the job that grades one finished run. */
function jobPayloadOf({
  tenantId,
  scenarioRunId,
  scenarioId,
  evaluators,
  traceIds,
}: {
  tenantId: string;
  scenarioRunId: string;
  scenarioId: string;
  evaluators: RunEvaluators;
  traceIds: string[] | undefined;
}): ScenarioEvaluationsJobPayload {
  return {
    tenantId,
    scenarioRunId,
    scenarioId,
    suiteId: evaluators.suiteId,
    planId: evaluators.planId,
    attachments: evaluators.attachments,
    ...(evaluators.fieldValues && { fieldValues: evaluators.fieldValues }),
    ...(evaluators.definitions && { definitions: evaluators.definitions }),
    traceIds: traceIds ?? [],
    attempt: 1,
    occurredAt: nowInstant().epochMilliseconds,
  };
}

/**
 * On RunFinished, queues evaluation job when suite/plan has evaluators; data from event.
 * Throws on queue failure for retry. See scenario-evaluators.feature and -pending.feature.
 */
export function createScenarioEvaluationsSubscriber(
  deps: ScenarioEvaluationsSubscriberDeps,
): SubscriberSpec<SimulationProcessingEvent> {
  return {
    events: [SIMULATION_RUN_EVENT_TYPES.FINISHED],

    async handler(event: SimulationProcessingEvent): Promise<void> {
      if (!isSimulationRunFinishedEvent(event)) return;

      const tenantId = String(event.tenantId);
      const scenarioRunId = event.aggregateId;
      const { scenarioId, scenarioSetId, status, results } = event.data;

      const evaluatedScenarioId = pickScenarioIdToEvaluate({
        tenantId,
        scenarioRunId,
        scenarioId,
        status,
        results,
      });
      if (!evaluatedScenarioId) return;

      const planId = scenarioSetId ? extractSuiteId(scenarioSetId) : null;
      const evaluators =
        event.data.evaluators ??
        (await deps.loadRunAttachments({
          projectId: tenantId,
          scenarioId: evaluatedScenarioId,
          planId,
        }));
      if (evaluators.attachments.length === 0) return;

      logger.debug(
        {
          tenantId,
          scenarioRunId,
          suiteId: evaluators.suiteId,
          planId: evaluators.planId,
          attachmentCount: evaluators.attachments.length,
        },
        "Queueing scenario evaluations for finished run",
      );
      await deps.enqueue(
        jobPayloadOf({
          tenantId,
          scenarioRunId,
          scenarioId: evaluatedScenarioId,
          evaluators,
          traceIds: event.data.traceIds,
        }),
      );
    },
  };
}
