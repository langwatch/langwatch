/**
 * Copying the evaluator behind a monitor, and the workflow behind that, into
 * another project.
 *
 * Owned by the Evaluator feature and supplied by the process; a monitor copy
 * needs it because an evaluator-backed monitor would otherwise dangle a
 * cross-project reference. The actor is named because the copied workflow's
 * first saved version is recorded against whoever asked for the copy.
 */
export abstract class MonitorReplicationRepository {
  abstract copyEvaluatorToProject(
    input: Readonly<{
      evaluatorId: string;
      sourceProjectId: string;
      targetProjectId: string;
      actor: Readonly<{ id: string }>;
    }>,
  ): Promise<Readonly<{ id: string; workflowId: string | null }>>;

  /** Removes a workflow the copy above created, when the monitor insert fails. */
  abstract deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}
