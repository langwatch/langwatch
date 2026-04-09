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

function parseTargets(raw: string | null | undefined): unknown[] {
  if (!raw) return [];
  try {
    return JSON.parse(raw) as unknown[];
  } catch (error) {
    logger.warn(
      { error: error instanceof Error ? error.message : String(error) },
      "Failed to parse targets JSON — defaulting to empty array",
    );
    return [];
  }
}

export interface ExperimentRunEsSyncReactorDeps {
  project: ProjectService;
  repository: BatchEvaluationRepository;
}

/**
 * Creates a reactor that previously synced experiment run state to Elasticsearch.
 * Now a no-op — ES writes are fully disabled, ClickHouse is the sole data store.
 */
export function createExperimentRunEsSyncReactor(
  deps: ExperimentRunEsSyncReactorDeps,
): ReactorDefinition<ExperimentRunProcessingEvent, ExperimentRunStateData> {
  return {
    name: "experimentRunEsSync",
    options: { runIn: ["web", "worker"] },

    async handle(
      _event: ExperimentRunProcessingEvent,
      _context: ReactorContext<ExperimentRunStateData>,
    ): Promise<void> {
      // ES writes are fully disabled — ClickHouse is the sole data store.
      return;
    },
  };
}
