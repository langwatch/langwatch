import { ExperimentRunItemStore } from "../../eventing/experiment-run-item.store.ts";
import { ExperimentRunStateStore } from "../../eventing/experiment-run-state.store.ts";
import type { ExperimentRepositories } from "../experiment.repositories.ts";
import { MemoryExperimentDspyRepository } from "./memory.experiment-dspy.repository.ts";
import { MemoryExperimentIdLookupRepository } from "./memory.experiment-id-lookup.repository.ts";
import { MemoryExperimentPeopleRepository } from "./memory.experiment-people.repository.ts";
import { MemoryExperimentRunAbortRepository } from "./memory.experiment-run-abort.repository.ts";
import { MemoryExperimentRunEventStreamRepository } from "./memory.experiment-run-event-stream.repository.ts";
import { MemoryExperimentRunFoldRepository } from "./memory.experiment-run-fold.repository.ts";
import { MemoryExperimentRunStateRepository } from "./memory.experiment-run-state.repository.ts";
import { MemoryExperimentRunRepository } from "./memory.experiment-run.repository.ts";
import { MemoryExperimentWorkflowVersionRepository } from "./memory.experiment-workflow-version.repository.ts";
import { MemoryExperimentRepository } from "./memory.experiment.repository.ts";

/** The "memory" tier: one process is the whole deployment, so its runs share this memory. */
export class MemoryExperimentRepositories {
  static readonly requires = [] as const;

  static create(): ExperimentRepositories {
    const folds = MemoryExperimentRunFoldRepository.create();
    const abort = MemoryExperimentRunAbortRepository.create();
    const stream = MemoryExperimentRunEventStreamRepository.create();

    return {
      experiments: MemoryExperimentRepository.create(),
      runHistory: MemoryExperimentRunRepository.create({
        workflowVersions: MemoryExperimentWorkflowVersionRepository.create(),
      }),
      dspySteps: MemoryExperimentDspyRepository.create(),
      people: MemoryExperimentPeopleRepository.create(),
      runProcessing: {
        open: ({ defaultRetentionDays }) => ({
          folds,
          abort,
          stream,
          idLookup: MemoryExperimentIdLookupRepository.create(),
          experimentRunStateFoldStore: ExperimentRunStateStore.create({
            repository: MemoryExperimentRunStateRepository.create(),
          }),
          // No analytical store in this tier: a run's result rows are folded, never kept.
          experimentRunItemAppendStore: ExperimentRunItemStore.create({
            clickhouse: null,
            defaultRetentionDays,
          }),
        }),
      },
    };
  }
}
