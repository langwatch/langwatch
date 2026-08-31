import { TRPCError } from "@trpc/server";
import type { TRPCContext } from "~/server/api/trpc.context";
import type { Session } from "~/server/auth";

/**
 * Replicating the workflow behind a workflow evaluator, which stays
 * process-owned: the studio DSL, its dataset references and its version
 * history all belong to the Workflow feature, and neither the Evaluator nor
 * the Monitor package reaches into them.
 *
 * Both `evaluators.copy` and `monitors.copy` bind these, so a replica made
 * from either surface is the same self-contained evaluator in the target
 * project rather than a dangling cross-project reference.
 */

/** The authenticated request context these ports resolve their work from. */
type AuthenticatedContext = TRPCContext & { session: Session };

/**
 * Clones the evaluator's workflow into the target project and answers the new
 * workflow id. Refuses a workflow with no saved version: creating the
 * evaluator against one would leave a structurally broken replica.
 */
export async function replicateEvaluatorWorkflow(
  ctx: AuthenticatedContext,
  {
    workflowId,
    sourceProjectId,
    targetProjectId,
  }: { workflowId: string; sourceProjectId: string; targetProjectId: string },
): Promise<string> {
  const workflow = await ctx.prisma.workflow.findFirst({
    where: { id: workflowId, projectId: sourceProjectId, archivedAt: null },
    include: { latestVersion: true },
  });

  if (!workflow?.latestVersion?.dsl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Cannot replicate a workflow evaluator without a saved workflow version",
    });
  }

  const { workflowId: newWorkflowId, dsl } = await ctx.app.workflows.copyStudioWorkflow({
    workflow: {
      id: workflow.id,
      name: workflow.name,
      icon: workflow.icon,
      description: workflow.description,
      isEvaluator: workflow.isEvaluator,
      isComponent: workflow.isComponent,
      latestVersion: workflow.latestVersion,
    },
    targetProjectId,
    sourceProjectId,
    copiedFromWorkflowId: workflowId,
  });

  try {
    await ctx.app.workflows.saveStudioVersion(
      {
        projectId: targetProjectId,
        workflowId: newWorkflowId,
        dsl,
        autoSaved: false,
        commitMessage: "Copied from " + workflow.name,
      },
      ctx.actor(),
    );
  } catch (saveError) {
    // deleteMany (not delete) so the multitenancy guard accepts the projectId
    // scope — a bare { id } delete is rejected and the rollback silently no-ops.
    await deleteReplicatedWorkflow(ctx, {
      workflowId: newWorkflowId,
      projectId: targetProjectId,
    }).catch(() => undefined);
    throw saveError;
  }

  return newWorkflowId;
}

/** Removes a workflow a replication created, when the evaluator insert fails. */
export async function deleteReplicatedWorkflow(
  ctx: AuthenticatedContext,
  { workflowId, projectId }: { workflowId: string; projectId: string },
): Promise<void> {
  await ctx.prisma.workflow.deleteMany({ where: { id: workflowId, projectId } });
}
