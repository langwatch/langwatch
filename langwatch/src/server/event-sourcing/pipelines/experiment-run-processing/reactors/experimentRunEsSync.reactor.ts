import type { ProjectService } from "~/server/app-layer/projects/project.service";
import { createLogger } from "../../../../../utils/logger/server";
import type { BatchEvaluationRepository } from "../../../../evaluations-v3/repositories/batchEvaluation.repository";
import type { ReactorContext, ReactorDefinition } from "../../../reactors/reactor.types";
import type { ExperimentRunStateData } from "../projections/experimentRunState.foldProjection";
import type { ExperimentRunProcessingEvent } from "../schemas/events";
import { EXPERIMENT_RUN_EVENT_TYPES } from "../schemas/constants";

const logger = createLogger(
  "langwatch:experiment-run-processing:es-sync-reactor",
);

export interface ExperimentRunEsSyncReactorDeps {
  project: ProjectService;
  repository: BatchEvaluationRepository;
}

/**
 * Creates a reactor that syncs experiment run state to Elasticsearch
 * (BATCH_EVALUATION_INDEX) after each fold completion.
 *
 * This reactor replaces the direct ES writes in the orchestrator and
 * log_results when featureEventSourcingEvaluationIngestion is ON.
 *
 * When the flag is OFF, returns early (direct ES writes handle it).
 */
export function createExperimentRunEsSyncReactor(
  deps: ExperimentRunEsSyncReactorDeps,
): ReactorDefinition<ExperimentRunProcessingEvent, ExperimentRunStateData> {
  return {
    name: "experimentRunEsSync",

    async handle(
      event: ExperimentRunProcessingEvent,
      context: ReactorContext<ExperimentRunStateData>,
    ): Promise<void> {
      const { tenantId, foldState } = context;

      // Feature flag check — skip if not enabled
      const enabled = await deps.project.isFeatureEnabled(
        tenantId,
        "featureEventSourcingEvaluationIngestion",
      );
      if (!enabled) return;

      const { repository } = deps;
      const experimentId = foldState.ExperimentId;
      const runId = foldState.RunId;

      if (!experimentId || !runId) {
        logger.debug(
          { tenantId },
          "Skipping ES sync — missing experimentId or runId",
        );
        return;
      }

      const MAX_RETRIES = 3;
      const BASE_DELAY_MS = 1000;
      let lastError: unknown;

      for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
        try {
          switch (event.type) {
            case EXPERIMENT_RUN_EVENT_TYPES.STARTED: {
              let targets: Parameters<typeof repository.create>[0]["targets"] = [];
              try {
                targets = JSON.parse(foldState.Targets);
              } catch {
                // Targets may not be valid JSON
              }

              await repository.create({
                projectId: tenantId,
                experimentId,
                runId,
                workflowVersionId: foldState.WorkflowVersionId,
                total: foldState.Total,
                targets,
              });
              break;
            }

            case EXPERIMENT_RUN_EVENT_TYPES.TARGET_RESULT: {
              await repository.upsertResults({
                projectId: tenantId,
                experimentId,
                runId,
                dataset: [
                  {
                    index: event.data.index,
                    target_id: event.data.targetId,
                    entry: event.data.entry as Record<string, unknown>,
                    predicted: event.data.predicted ?? undefined,
                    cost: event.data.cost ?? null,
                    duration: event.data.duration ?? null,
                    error: event.data.error ?? null,
                    trace_id: event.data.traceId ?? null,
                  },
                ],
                progress: foldState.Progress,
              });
              break;
            }

            case EXPERIMENT_RUN_EVENT_TYPES.EVALUATOR_RESULT: {
              await repository.upsertResults({
                projectId: tenantId,
                experimentId,
                runId,
                evaluations: [
                  {
                    evaluator: event.data.evaluatorId,
                    name: event.data.evaluatorName ?? null,
                    target_id: event.data.targetId,
                    index: event.data.index,
                    status: event.data.status,
                    score: typeof event.data.score === 'number' ? event.data.score : null,
                    label: event.data.label ?? null,
                    passed: event.data.passed ?? null,
                    details: event.data.details ?? null,
                    cost: event.data.cost ?? null,
                  },
                ],
              });
              break;
            }

            case EXPERIMENT_RUN_EVENT_TYPES.COMPLETED: {
              await repository.markComplete({
                projectId: tenantId,
                experimentId,
                runId,
                finishedAt: event.data.finishedAt ?? undefined,
                stoppedAt: event.data.stoppedAt ?? undefined,
              });
              break;
            }
          }

          logger.debug(
            { tenantId, runId, eventType: event.type },
            "Synced experiment run event to ES",
          );
          return; // Success — exit retry loop
        } catch (error) {
          lastError = error;
          if (attempt < MAX_RETRIES) {
            const delayMs = BASE_DELAY_MS * Math.pow(2, attempt - 1);
            logger.warn(
              {
                tenantId,
                runId,
                eventType: event.type,
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
          runId,
          eventType: event.type,
          error: lastError instanceof Error ? lastError.message : String(lastError),
        },
        `Failed to sync experiment run to ES after ${MAX_RETRIES} attempts`,
      );
      throw lastError;
    },
  };
}
