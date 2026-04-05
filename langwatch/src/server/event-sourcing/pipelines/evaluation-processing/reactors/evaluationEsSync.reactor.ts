import type { PrismaClient } from "@prisma/client";
import { createLogger } from "../../../../../utils/logger/server";
import type { ElasticSearchEvaluation } from "../../../../tracer/types";
import type {
	ReactorContext,
	ReactorDefinition,
} from "../../../reactors/reactor.types";
import type { EvaluationRunData } from "../projections/evaluationRun.foldProjection";
import type { EvaluationProcessingEvent } from "../schemas/events";
import { isEvaluationCompletedEvent, isEvaluationReportedEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:evaluation-processing:es-sync-reactor",
);

export interface EvaluationEsSyncReactorDeps {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  esClient: (args: { projectId: string }) => Promise<{ update: (...args: any[]) => Promise<any> }>;
  traceIndex: { alias: string };
  traceIndexId: (args: { traceId: string; projectId: string }) => string;
  prisma: PrismaClient;
}

/**
 * Creates a reactor that syncs evaluation state to Elasticsearch.
 *
 * Evaluations are stored as nested documents inside trace documents in ES.
 * This reactor upserts the evaluation into the trace's `evaluations[]` array
 * using the same Painless script as the legacy `updateEvaluationStatusInES`.
 *
 * Fires on CompletedEvent and ReportedEvent — intermediate states are not synced.
 */
export function createEvaluationEsSyncReactor(
  deps: EvaluationEsSyncReactorDeps,
): ReactorDefinition<EvaluationProcessingEvent, EvaluationRunData> {
  return {
    name: "evaluationEsSync",

    async handle(
      _event: EvaluationProcessingEvent,
      _context: ReactorContext<EvaluationRunData>,
    ): Promise<void> {
      // ES writes are fully disabled — ClickHouse is the sole data store.
      return;
    },
  };
}
