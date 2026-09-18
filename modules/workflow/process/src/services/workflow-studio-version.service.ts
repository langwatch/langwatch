/** Save workflow graph as version: prepare → write → update agent mappings. See
 * modules/workflow/specs/workflow-service.feature. */
import { createLogger } from "@langwatch/observability";
import type { StudioWorkflow, WorkflowVersion } from "@langwatch/workflow-contract";

import type { WorkflowAgentMapping, WorkflowStudioDsl } from "../app/workflow.app.ts";
import type { WorkflowService } from "./workflow.service.ts";

const logger = createLogger("langwatch:workflows:auto-compute");

export type WorkflowStudioVersionServiceOptions = {
  workflows: WorkflowService;
  studioDsl: WorkflowStudioDsl;
  agentMappings: WorkflowAgentMapping;
};

export type SaveStudioWorkflowVersionInput = {
  projectId: string;
  workflowId: string;
  dsl: StudioWorkflow;
  autoSaved: boolean;
  commitMessage: string;
  authorId: string;
  setAsLatestVersion?: boolean;
};

export class WorkflowStudioVersionService {
  static create(options: WorkflowStudioVersionServiceOptions): WorkflowStudioVersionService {
    return new WorkflowStudioVersionService(options);
  }

  private constructor(private readonly options: WorkflowStudioVersionServiceOptions) {}

  /** Prepares a graph the way saving one does, without writing anything. */
  prepareDsl(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow> {
    return this.options.studioDsl.prepare(input);
  }

  async saveOrCommit(input: SaveStudioWorkflowVersionInput): Promise<WorkflowVersion> {
    const preparedDsl = await this.options.studioDsl.prepare({
      projectId: input.projectId,
      dsl: input.dsl,
    });

    const version = await this.options.workflows.saveVersion({
      projectId: input.projectId,
      workflowId: input.workflowId,
      // Serialised rather than handed over: the stored column is JSON, and the
      // prepared graph shares node objects with the caller's own.
      dsl: JSON.parse(JSON.stringify(preparedDsl)),
      autoSaved: input.autoSaved,
      commitMessage: input.commitMessage,
      authorId: input.authorId,
      setAsLatestVersion: input.setAsLatestVersion ?? true,
    });

    // Fire-and-forget: the recompute handles its own errors internally, but the
    // outer .catch guards against synchronous throws (e.g. invalid args) that
    // would otherwise surface as an unhandled promise rejection.
    this.options.agentMappings
      .recompute({
        projectId: input.projectId,
        workflowId: input.workflowId,
        dsl: input.dsl,
      })
      .catch((err: unknown) => {
        logger.error(
          { err, workflowId: input.workflowId, projectId: input.projectId },
          "autoComputeAgentMappings dispatch failed",
        );
      });

    return version;
  }
}
