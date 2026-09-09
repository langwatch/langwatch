import type { ExperimentRunWorkflowVersion } from "@langwatch/experiment-contract";

/**
 * The workflow-version metadata a run listing shows beside each experiment.
 *
 * It lives in Postgres while the runs themselves live in ClickHouse, so the
 * ClickHouse repository asks for it through here rather than holding a second
 * client of its own.
 */
export abstract class ExperimentWorkflowVersionPort {
  /** Keyed by version id; ids with no row are absent rather than null. */
  abstract findByIds(input: {
    projectId: string;
    versionIds: string[];
  }): Promise<Record<string, ExperimentRunWorkflowVersion>>;
}
