import type { ExperimentRunWorkflowVersion } from "@langwatch/experiment-contract";

import { ExperimentRunItemStore } from "../../eventing/experiment-run-item.store.ts";
import { ExperimentRunStateStore } from "../../eventing/experiment-run-state.store.ts";
import { ExperimentPeopleRepository } from "../experiment-people.repository.ts";
import { ExperimentRunAbortRepository } from "../experiment-run-abort.repository.ts";
import { ExperimentWorkflowVersionRepository } from "../experiment-workflow-version.repository.ts";
import type { ExperimentRepositories } from "../experiment.repositories.ts";
import { MemoryExperimentDspyRepository } from "./memory.experiment-dspy.repository.ts";
import { MemoryExperimentIdLookupRepository } from "./memory.experiment-id-lookup.repository.ts";
import { MemoryExperimentRunEventStreamRepository } from "./memory.experiment-run-event-stream.repository.ts";
import { MemoryExperimentRunFoldRepository } from "./memory.experiment-run-fold.repository.ts";
import { MemoryExperimentRunStateRepository } from "./memory.experiment-run-state.repository.ts";
import { MemoryExperimentRunRepository } from "./memory.experiment-run.repository.ts";
import { MemoryExperimentRepository } from "./memory.experiment.repository.ts";

/** People are written by the user module; with no writer here, no author id has a name. */
export class MemoryExperimentPeopleRepository extends ExperimentPeopleRepository {
  static create(): MemoryExperimentPeopleRepository {
    return new MemoryExperimentPeopleRepository();
  }

  private constructor() {
    super();
  }

  namesOf(
    _ids: readonly string[],
  ): Promise<readonly Readonly<{ id: string; name: string | null }>[]> {
    return Promise.resolve([]);
  }
}

/** The stop signal in this process's memory, for tests and a deployment without Redis. */
export class MemoryExperimentRunAbortRepository extends ExperimentRunAbortRepository {
  static create(): MemoryExperimentRunAbortRepository {
    return new MemoryExperimentRunAbortRepository();
  }

  private readonly aborted = new Set<string>();

  private constructor() {
    super();
  }

  requestAbort(runId: string): Promise<void> {
    this.aborted.add(runId);
    return Promise.resolve();
  }

  isAborted(runId: string): Promise<boolean> {
    return Promise.resolve(this.aborted.has(runId));
  }
}

/** Workflow versions are written by the workflow module; with no writer here, none is found. */
export class MemoryExperimentWorkflowVersionRepository extends ExperimentWorkflowVersionRepository {
  static create(): MemoryExperimentWorkflowVersionRepository {
    return new MemoryExperimentWorkflowVersionRepository();
  }

  private constructor() {
    super();
  }

  findByIds(_input: {
    projectId: string;
    versionIds: string[];
  }): Promise<Record<string, ExperimentRunWorkflowVersion>> {
    return Promise.resolve({});
  }
}

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
