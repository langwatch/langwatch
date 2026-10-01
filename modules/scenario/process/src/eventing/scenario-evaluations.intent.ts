import type { IntentExecutor } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  isFinalAttempt,
  isSimulationRunFinishedEvent,
  loadRunAttachments,
  runScenarioEvaluations,
  TraceDataPendingError,
  type RunScenarioEvaluationsDeps,
  type SimulationProcessingEvent,
} from "@langwatch/scenario-contract";
import { nowInstant } from "@langwatch/time";
import { z } from "zod";

const logger = createLogger("langwatch:simulation-processing:scenario-evaluations");

/** Ids only: the executor reads everything else from the run's own events. */
export const gradeRunIntentSchema = z.object({
  tenantId: z.string(),
  scenarioRunId: z.string(),
  scenarioId: z.string(),
  planId: z.string().nullable(),
});
type GradeRunIntent = z.infer<typeof gradeRunIntentSchema>;

export interface ScenarioGradingDeps {
  evaluations: RunScenarioEvaluationsDeps;
  /** The run's own events, where its finished event pinned the evaluators. */
  loadPriorEvents: (params: {
    tenantId: string;
    scenarioRunId: string;
  }) => Promise<readonly SimulationProcessingEvent[]>;
}

/**
 * The `grade` intent executor: grades the run against the evaluators its
 * finished event pinned, or those its suite and plan attach now when it
 * pinned none. A trace still arriving throws, so the outbox retries.
 */
export function createGradeRunHandler(deps: ScenarioGradingDeps): IntentExecutor<GradeRunIntent> {
  return async (intent, context) => {
    const { tenantId, scenarioRunId, scenarioId, planId } = intent;
    const finished = (await deps.loadPriorEvents({ tenantId, scenarioRunId }))
      .filter(isSimulationRunFinishedEvent)
      .at(-1);
    const evaluators =
      finished?.data.evaluators ??
      (await loadRunAttachments({
        deps: deps.evaluations,
        projectId: tenantId,
        scenarioId,
        planId,
      }));
    if (evaluators.attachments.length === 0) return;

    try {
      await runScenarioEvaluations({
        deps: deps.evaluations,
        payload: {
          tenantId,
          scenarioRunId,
          scenarioId,
          suiteId: evaluators.suiteId,
          planId: evaluators.planId,
          attachments: evaluators.attachments,
          ...(evaluators.fieldValues && { fieldValues: evaluators.fieldValues }),
          ...(evaluators.definitions && { definitions: evaluators.definitions }),
          traceIds: finished?.data.traceIds ?? [],
          attempt: context.attempt,
          occurredAt: nowInstant().epochMilliseconds,
        },
        isFinalAttempt: isFinalAttempt(context.attempt),
      });
    } catch (error) {
      if (error instanceof TraceDataPendingError) {
        logger.info(
          { tenantId, scenarioRunId, attempt: context.attempt, details: error.message },
          "Trace data not there yet, scenario evaluations retried",
        );
      }
      throw error;
    }
  };
}
