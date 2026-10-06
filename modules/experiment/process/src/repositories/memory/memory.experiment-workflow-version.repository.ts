import type { ExperimentRunWorkflowVersion } from "@langwatch/experiment-contract";

import { ExperimentWorkflowVersionRepository } from "../experiment-workflow-version.repository.ts";

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
