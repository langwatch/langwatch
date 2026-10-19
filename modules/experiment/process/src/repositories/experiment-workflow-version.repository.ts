import type { ExperimentRunWorkflowVersion } from "@langwatch/experiment-contract";

/**
 * The workflow-version metadata a run listing shows beside each experiment.
 * Lives in Postgres while runs live in ClickHouse, so the ClickHouse
 * repository asks for it through here rather than holding a second client.
 */
export abstract class ExperimentWorkflowVersionRepository {
  /** Keyed by version id; ids with no row are absent rather than null. */
  abstract findByIds(input: {
    projectId: string;
    versionIds: string[];
  }): Promise<Record<string, ExperimentRunWorkflowVersion>>;
}
