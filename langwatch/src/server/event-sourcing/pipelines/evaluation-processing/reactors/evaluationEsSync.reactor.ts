import { createLogger } from "../../../../../utils/logger/server";
import type { ElasticSearchEvaluation } from "../../../../tracer/types";
import type {
	ReactorContext,
	ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { EvaluationRunData } from "../projections/evaluationRun.foldProjection";
import type { EvaluationProcessingEvent } from "../schemas/events";
import { isEvaluationCompletedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:es-sync-reactor",
);

export interface EvaluationEsSyncReactorDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  esClient: (args: { projectId: string }) => Promise<{ update: (...args: any[]) => Promise<any> }>;
  traceIndex: { alias: string };
  traceIndexId: (args: { traceId: string; projectId: string }) => string;
}

/**
 * Creates a reactor that syncs evaluation state to Elasticsearch after a CompletedEvent.
 *
 * Evaluations are stored as nested documents inside trace documents in ES.
 * This reactor upserts the evaluation into the trace's `evaluations[]` array
 * using the same Painless script as the legacy `updateEvaluationStatusInES`.
 *
 * Only fires on CompletedEvent — intermediate states are not synced to ES.
 */
export function createEvaluationEsSyncReactor(
  deps: EvaluationEsSyncReactorDeps,
): ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData> {
  return {
    name: "evaluationEsSync",

    async handle(
      event: EvaluationProcessingEvent,
      context: ReactorContext<EvaluationRunData>,
    ): Promise<void> {
      if (!isEvaluationCompletedEvent(event)) return;

      const { tenantId, foldState } = context;

      if (!foldState.traceId) {
        logger.debug(
          { tenantId, evaluationId: foldState.evaluationId },
          "Skipping ES sync — no traceId",
        );
        return;
      }

      const evaluation: ElasticSearchEvaluation = {
        evaluation_id: foldState.evaluationId,
        evaluator_id: foldState.evaluatorId,
        type: foldState.evaluatorType,
        name: foldState.evaluatorName ?? foldState.evaluatorType,
        status: foldState.status,
        is_guardrail: foldState.isGuardrail,
        ...(foldState.score !== null && { score: foldState.score }),
        ...(foldState.passed !== null && { passed: foldState.passed }),
        ...(foldState.label !== null && { label: foldState.label }),
        ...(foldState.details !== null && { details: foldState.details }),
        ...(foldState.error && {
          error: { has_error: true, message: foldState.error, stacktrace: [] },
        }),
        timestamps: {
          ...(foldState.startedAt && { started_at: foldState.startedAt }),
          ...(foldState.completedAt && { finished_at: foldState.completedAt }),
          updated_at: Date.now(),
        },
      };

      // Random delay to avoid ES update collisions (matches legacy pattern)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.random() * 1000),
      );

      const traceId = foldState.traceId;

      const MAX_RETRIES = 3;
      const BASE_DELAY_MS = 1000;
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          const client = await deps.esClient({ projectId: tenantId });
          await client.update({
            index: deps.traceIndex.alias,
            id: deps.traceIndexId({ traceId, projectId: tenantId }),
            retry_on_conflict: 10,
            body: {
              script: {
                source: `
                if (ctx._source.evaluations == null) {
                  ctx._source.evaluations = [];
                }
                def newEvaluation = params.newEvaluation;
                def found = false;
                for (int i = 0; i < ctx._source.evaluations.size(); i++) {
                  if (ctx._source.evaluations[i].evaluation_id == newEvaluation.evaluation_id) {
                    ctx._source.evaluations[i] = newEvaluation;
                    found = true;
                    break;
                  }
                }
                if (!found) {
                  if (newEvaluation.timestamps == null) {
                    newEvaluation.timestamps = new HashMap();
                  }
                  newEvaluation.timestamps.inserted_at = System.currentTimeMillis();
                  ctx._source.evaluations.add(newEvaluation);
                }
              `,
                lang: "painless",
                params: { newEvaluation: evaluation },
              },
              upsert: {
                trace_id: traceId,
                project_id: tenantId,
                timestamps: {
                  inserted_at: Date.now(),
                  started_at: Date.now(),
                  updated_at: Date.now(),
                },
                evaluations: [evaluation],
              },
            },
            refresh: true,
          });

          logger.debug(
            { tenantId, traceId, evaluationId: foldState.evaluationId },
            "Synced evaluation to ES",
          );
          return; // Success — exit retry loop
        } catch (error) {
          lastError = error;
          if (attempt < MAX_RETRIES) {
            const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            logger.warn(
              {
                tenantId,
                traceId,
                evaluationId: foldState.evaluationId,
                attempt,
                maxRetries: MAX_RETRIES,
                delayMs,
                error: error instanceof Error ? error.message : String(error),
              },
              "ES sync failed, retrying",
            );
            await new Promise((resolve) => setTimeout(resolve, delayMs));
          }
        }
      }

      // All retries exhausted
      logger.error(
        {
          tenantId,
          traceId,
          evaluationId: foldState.evaluationId,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        },
        `Failed to sync evaluation to ES after ${MAX_RETRIES} attempts`,
      );
      throw lastError;
    },
  };
}
