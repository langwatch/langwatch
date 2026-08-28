/**
 * Copying an evaluator from one project into another.
 *
 * Shared by `evaluators.copy` and `monitors.copy` so replicating from either
 * surface produces an identical, independently-editable evaluator in the target
 * project. The caller owns the permission checks; this assumes the source is
 * readable.
 *
 * Spec: specs/monitors/replicate-monitor-to-project.feature.
 */
import {
  evaluatorTypeSchema,
  type Evaluator,
  type EvaluatorService,
} from "@langwatch/evaluator-contract";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";

/**
 * Workflow replication, which the process owns: a workflow evaluator's backing
 * workflow is copied with the studio DSL and version history the Workflow
 * feature keeps, none of which the Evaluator feature reaches into.
 */
export type EvaluatorReplicationPorts = Readonly<{
  /**
   * Clones the workflow into the target project and answers the new workflow
   * id. Refuses a workflow with no saved version — an evaluator created
   * against one would be a structurally broken replica.
   */
  replicateEvaluatorWorkflow(
    input: Readonly<{ workflowId: string; sourceProjectId: string; targetProjectId: string }>,
  ): Promise<string>;
  /** Removes a workflow this replication created, when the evaluator insert fails. */
  deleteReplicatedWorkflow(
    input: Readonly<{ workflowId: string; projectId: string }>,
  ): Promise<void>;
}>;

/** One replication, from the source project into the target. */
export type EvaluatorCopyCommand = Readonly<{
  evaluators: EvaluatorService;
  evaluatorId: string;
  sourceProjectId: string;
  targetProjectId: string;
  newEvaluatorId?: string;
}>;

/**
 * Copies an evaluator, and the workflow backing it, between projects.
 * Constructed per request, because the workflow ports it delegates to resolve
 * their work from that request's context.
 */
export class EvaluatorReplicationApi {
  private constructor(private readonly ports: EvaluatorReplicationPorts) {}

  static create(ports: EvaluatorReplicationPorts): EvaluatorReplicationApi {
    return new EvaluatorReplicationApi(ports);
  }

  /**
   * Copies an evaluator (and its backing workflow, for workflow-type
   * evaluators) into another project and returns the created evaluator.
   */
  async copyToProject({
    evaluators,
    evaluatorId,
    sourceProjectId,
    targetProjectId,
    newEvaluatorId = `evaluator_${nanoid()}`,
  }: EvaluatorCopyCommand): Promise<Evaluator> {
    const source = await evaluators.tryGetById({ id: evaluatorId, projectId: sourceProjectId });

    if (!source) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Evaluator not found" });
    }

    const newWorkflowId = await this.copyWorkflowFor({
      source,
      sourceProjectId,
      targetProjectId,
    });

    try {
      return await evaluators.create({
        id: newEvaluatorId,
        projectId: targetProjectId,
        name: source.name,
        type: evaluatorTypeSchema.parse(source.type),
        config: source.config === null ? {} : (source.config as Record<string, unknown>),
        workflowId: newWorkflowId ?? undefined,
        copiedFromEvaluatorId: source.id,
      });
    } catch (createError) {
      if (newWorkflowId) {
        await this.ports
          .deleteReplicatedWorkflow({ workflowId: newWorkflowId, projectId: targetProjectId })
          .catch(() => undefined);
      }

      throw createError;
    }
  }

  /**
   * The new workflow id for a workflow evaluator, or null for every other
   * type. Throws when a workflow evaluator names no workflow at all — the same
   * refusal the process makes for a workflow that has never been saved.
   */
  private async copyWorkflowFor({
    source,
    sourceProjectId,
    targetProjectId,
  }: Readonly<{
    source: Evaluator;
    sourceProjectId: string;
    targetProjectId: string;
  }>): Promise<string | null> {
    if (source.type !== "workflow") {
      return null;
    }

    if (!source.workflowId) {
      throw new TRPCError({
        code: "BAD_REQUEST",
        message: "Cannot replicate a workflow evaluator without a saved workflow version",
      });
    }

    return this.ports.replicateEvaluatorWorkflow({
      workflowId: source.workflowId,
      sourceProjectId,
      targetProjectId,
    });
  }
}
