import type {
  ExperimentWorkflowCopyInput,
  ExperimentWorkflowVersionInput,
} from "@langwatch/experiment-contract";
import type { StudioWorkflow, WorkflowApi } from "@langwatch/workflow-contract";

type AuthoringWorkflows = Pick<
  WorkflowApi,
  "prepareStudioDsl" | "create" | "saveStudioVersion" | "copyStudioWorkflow"
>;

/**
 * The studio writes a wizard experiment drives, over the SAME workflow module
 * the Studio saves through: a new workflow carries the prepared first graph as
 * version one.
 */
export class ExperimentWorkflowAuthoringService {
  static create(workflows: AuthoringWorkflows): ExperimentWorkflowAuthoringService {
    return new ExperimentWorkflowAuthoringService(workflows);
  }

  private constructor(private readonly workflows: AuthoringWorkflows) {}

  async create(
    input: Readonly<{
      projectId: string;
      dsl: StudioWorkflow;
      commitMessage: string;
      autoSaved: boolean;
    }>,
    by: Readonly<{ id: string }>,
  ): Promise<Readonly<{ id: string }>> {
    const { projectId, dsl, commitMessage, autoSaved } = input;
    const prepared = await this.workflows.prepareStudioDsl({ projectId, dsl });
    const created = await this.workflows.create(
      { projectId, dsl: prepared, commitMessage, autoSaved },
      by,
    );
    return { id: created.workflow.id };
  }

  async saveVersion(
    input: ExperimentWorkflowVersionInput,
    by: Readonly<{ id: string }>,
  ): Promise<void> {
    await this.workflows.saveStudioVersion(input, by);
  }

  copyWithDatasets(
    input: ExperimentWorkflowCopyInput,
  ): Promise<Readonly<{ workflowId: string; dsl: StudioWorkflow }>> {
    return this.workflows.copyStudioWorkflow(input);
  }
}
