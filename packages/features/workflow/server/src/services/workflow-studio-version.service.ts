/**
 * Saving a Studio graph as a version: what the studio's autosave and its
 * commit button both do.
 *
 * Three steps, always in this order, and the order is the rule. The graph is
 * prepared first, so no version is ever written with an LLM node that has no
 * model — the persistence chokepoint that lets execution read a node's own
 * config and nothing else. Then the version is written. Then the agents bound
 * to this workflow have their scenario mappings recomputed, outside the save
 * and best effort, because a stale mapping is a nuisance and a failed save is
 * lost work.
 *
 * The first and third steps are the host's — its model cascade, its agent rows
 * — and arrive as ports. The sequence is the feature's.
 *
 * Spec: packages/features/workflow/specs/workflow-service.feature.
 */
import { createLogger } from "@langwatch/observability";
import type {
  StudioWorkflow,
  WorkflowService,
  WorkflowVersion,
} from "@langwatch/workflow-contract";
import type { WorkflowAgentMappingPort, WorkflowStudioDslPort } from "../ports/workflow.port";

const logger = createLogger("langwatch:workflows:auto-compute");

export type WorkflowStudioVersionServiceOptions = {
  workflows: WorkflowService;
  studioDsl: WorkflowStudioDslPort;
  agentMappings: WorkflowAgentMappingPort;
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
