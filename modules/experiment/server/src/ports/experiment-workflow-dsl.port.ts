/**
 * The committed studio workflow a workflow target runs, once per dataset row.
 *
 * Two narrow reads rather than one "load the workflow" call: the run
 * distinguishes a workflow that does not exist from one that exists with no
 * committed version, and says so differently. Both live in Postgres beside the
 * Workflow feature, which this package may not reach into.
 */
export abstract class ExperimentWorkflowDslPort {
  /** The workflow, or null when the project has none by that id. */
  abstract tryFindWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string; publishedId: string | null } | null>;
  /** The version's raw DSL, or null when the project has no such version. */
  abstract tryFindVersionDsl(input: {
    projectId: string;
    workflowId: string;
    versionId: string;
  }): Promise<unknown | null>;
  /**
   * The workflow a "evaluate this workflow" call names, excluding archived
   * ones — a run of a workflow the customer has archived is a run of something
   * that is not there any more.
   */
  abstract tryFindEvaluableWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<{ id: string; name: string } | null>;
  /**
   * The version such a call evaluates: the one it named, else the latest
   * manual commit, else the latest autosave — so a workflow that was only ever
   * autosaved is still evaluable.
   */
  abstract tryFindEvaluableVersion(input: {
    projectId: string;
    workflowId: string;
    versionId?: string;
  }): Promise<{ id: string; version: string; dsl: unknown } | null>;
}
