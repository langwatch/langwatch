import type { buildExperimentRunProcessingPipeline } from "../eventing/experiment-run-processing.pipeline.ts";
import type { ExperimentIdLookupRepository } from "./experiment-id-lookup.repository.ts";
import type { ExperimentRunAbortRepository } from "./experiment-run-abort.repository.ts";
import type { ExperimentRunFoldRepository } from "./experiment-run-fold.repository.ts";

type PipelineStores = Pick<
  Parameters<typeof buildExperimentRunProcessingPipeline>[0],
  "experimentRunStateFoldStore" | "experimentRunItemAppendStore"
>;

/** What a run keeps beside its events: the folds, the stop signal, the stores and the id lookup. */
export interface ExperimentRunRepositories extends PipelineStores {
  readonly folds: ExperimentRunFoldRepository;
  readonly abort: ExperimentRunAbortRepository;
  readonly idLookup: ExperimentIdLookupRepository;
}
