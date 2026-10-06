import type {
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunPageInput,
  ExperimentRunWithItems,
  ExperimentRunWorkflowVersion,
} from "@langwatch/experiment-contract";

import { ExperimentRunRepository } from "../experiment-run.repository.ts";
import type { ExperimentWorkflowVersionRepository } from "../experiment-workflow-version.repository.ts";

/**
 * Run history is a ClickHouse aggregation over the rows a run's result projection writes,
 * which this tier keeps nowhere: it answers no runs rather than a half-built history.
 */
export class MemoryExperimentRunRepository extends ExperimentRunRepository {
  static create(input: {
    workflowVersions: ExperimentWorkflowVersionRepository;
  }): MemoryExperimentRunRepository {
    return new MemoryExperimentRunRepository(input.workflowVersions);
  }

  private constructor(private readonly workflowVersions: ExperimentWorkflowVersionRepository) {
    super();
  }

  findAll(): Promise<Record<string, ExperimentRun[]>> {
    return Promise.resolve({});
  }

  findAggregates(): Promise<Record<string, ExperimentRunAggregate>> {
    return Promise.resolve({});
  }

  listPage(_input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }> {
    return Promise.resolve({ runs: [], totalHits: 0 });
  }

  findRun(): Promise<ExperimentRunWithItems | null> {
    return Promise.resolve(null);
  }

  findWorkflowVersions(
    projectId: string,
    versionIds: string[],
  ): Promise<Record<string, ExperimentRunWorkflowVersion>> {
    return this.workflowVersions.findByIds({ projectId, versionIds });
  }
}
