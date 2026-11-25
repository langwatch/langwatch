import type { buildExperimentRunProcessingPipeline } from "../eventing/experiment-run-processing.pipeline.ts";
import type { ExperimentIdLookupRepository } from "./experiment-id-lookup.repository.ts";
import type { ExperimentRunAbortRepository } from "./experiment-run-abort.repository.ts";
import type { ExperimentRunActivityRepository } from "./experiment-run-activity.repository.ts";
import type { ExperimentRunEventStreamRepository } from "./experiment-run-event-stream.repository.ts";
import type { ExperimentRunFoldRepository } from "./experiment-run-fold.repository.ts";

type PipelineStores = Pick<
  Parameters<typeof buildExperimentRunProcessingPipeline>[0],
  "experimentRunStateFoldStore" | "experimentRunItemAppendStore"
>;

/** What a run keeps beside its events: folds, stop signal, activity, frames, stores, id lookup. */
export interface ExperimentRunRepositories extends PipelineStores {
  readonly folds: ExperimentRunFoldRepository;
  readonly abort: ExperimentRunAbortRepository;
  /** The runs executing now, which a run's default concurrency is shared between. */
  readonly activity: ExperimentRunActivityRepository;
  readonly idLookup: ExperimentIdLookupRepository;
  /** The channel a run's frames reach the process streaming it on. */
  readonly stream: ExperimentRunEventStreamRepository;
}

/** A run's stores, opened once the platform's retention fallback, a peer's answer, is known. */
export type ExperimentRunProcessingStores = Readonly<{
  open(input: { defaultRetentionDays: () => number }): ExperimentRunRepositories;
}>;
