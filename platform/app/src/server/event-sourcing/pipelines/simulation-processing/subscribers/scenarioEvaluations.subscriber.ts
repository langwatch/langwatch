import { createLogger } from "@langwatch/observability";
import type { ScenarioEvaluationsJobPayload } from "~/server/scenarios/evaluations/types";
import type { EvaluatorAttachment } from "~/server/scenarios/evaluator-attachments";
import { ScenarioRunStatus } from "~/server/scenarios/scenario-event.enums";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import type { SubscriberSpec } from "../../../pipeline/processManagerDefinition";
import { SIMULATION_RUN_EVENT_TYPES } from "../schemas/constants";
import type { SimulationProcessingEvent } from "../schemas/events";
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
  }): Promise<{ suiteId: string | null; attachments: EvaluatorAttachment[] }>;
  /** Queues the evaluation job for the run. */
  enqueue(payload: ScenarioEvaluationsJobPayload): Promise<void>;
}

/** The statuses a finished run can hold without a conversation to grade. */
const UNGRADED_STATUSES: ReadonlySet<string> = new Set([
  ScenarioRunStatus.ERROR,
  ScenarioRunStatus.CANCELLED,
]);

/**
 * On RunFinished, queues the evaluation job for the run when its suite or
 * its plan attaches evaluators.
 *
 * A run whose finished results already carry evaluations was graded by the
 * code that ran it, and is stored as sent. A run that errored or was
 * cancelled has no conversation to grade. The plan is read off the set id
 * the run was filed under; the suite is the scenario's own test suite.
 *
 * Throws when the queue refuses the job, so the subscriber is retried.
 *
 * @see specs/scenarios/scenario-evaluators.feature
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

      if (results?.evaluations) {
        logger.debug(
          { tenantId, scenarioRunId },
          "Run finished with its own evaluations, not evaluated again",
        );
        return;
      }
      if (status && UNGRADED_STATUSES.has(status)) return;
      if (!scenarioId) {
        logger.warn(
          { tenantId, scenarioRunId },
          "Finished event names no scenario, the run is not evaluated",
        );
        return;
      }

      const planId = scenarioSetId ? extractSuiteId(scenarioSetId) : null;
      const { suiteId, attachments } = await deps.loadRunAttachments({
        projectId: tenantId,
        scenarioId,
        planId,
      });
      if (attachments.length === 0) return;

      logger.debug(
        {
          tenantId,
          scenarioRunId,
          suiteId,
          planId,
          attachmentCount: attachments.length,
        },
        "Queueing scenario evaluations for finished run",
      );
      await deps.enqueue({
        tenantId,
        scenarioRunId,
        scenarioId,
        suiteId,
        planId,
        traceIds: event.data.traceIds ?? [],
        attempt: 1,
        occurredAt: Date.now(),
      });
    },
  };
}
