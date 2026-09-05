import { createLogger } from "@langwatch/observability";
import type { ScenarioEvaluationsJobPayload } from "~/server/scenarios/evaluations/types";
import type { RunEvaluators } from "~/server/scenarios/scenario-run-evaluators";
import { UNGRADED_RUN_STATUSES } from "~/server/scenarios/scenario-run-evaluators";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type {
  SimulationProcessingEvent,
  SimulationRunFinishedEventData,
} from "../schemas/events";
import { isSimulationRunFinishedEvent } from "../schemas/typeGuards";

const logger = createLogger(
  "langwatch:simulation-processing:scenario-evaluations",
);

export interface ScenarioEvaluationsSubscriberDeps {
  /** The attachments the run's suite and plan carry, and the suite id. */
  loadRunAttachments(params: {
    projectId: string;
    scenarioId: string;
    planId: string | null;
  }): Promise<RunEvaluators>;
  /** Queues the evaluation job for the run. */
  enqueue(payload: ScenarioEvaluationsJobPayload): Promise<void>;
}

/**
 * The scenario id a finished run should be evaluated under, or `null` when
 * it should not be evaluated at all: its own results already carry
 * evaluations, its status has no conversation to grade, or it names no
 * scenario.
 */
function scenarioIdToEvaluate(params: {
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

/**
 * On RunFinished, queues the evaluation job for the run when its suite or
 * its plan attaches evaluators.
 *
 * The attachments come off the event, where the queue command pinned them
 * when the run was scheduled, so the run is graded with what it was queued
 * with and the job payload carries the same set to every retry. An event
 * without them is a run scheduled before they were recorded: the suite and
 * the plan are read now instead.
 *
 * A run whose finished results already carry evaluations was graded by the
 * code that ran it, and is stored as sent. A run that errored or was
 * cancelled has no conversation to grade. The plan is read off the set id
 * the run was filed under; the suite is the scenario's own test suite.
 *
 * Throws when the queue refuses the job, so the subscriber is retried.
 *
 * @see specs/scenarios/scenario-evaluators.feature
 * @see specs/scenarios/scenario-evaluation-pending.feature
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

      const evaluatedScenarioId = scenarioIdToEvaluate({
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
      await deps.enqueue({
        tenantId,
        scenarioRunId,
        scenarioId: evaluatedScenarioId,
        suiteId: evaluators.suiteId,
        planId: evaluators.planId,
        attachments: evaluators.attachments,
        traceIds: event.data.traceIds ?? [],
        attempt: 1,
        occurredAt: Date.now(),
      });
    },
  };
}
