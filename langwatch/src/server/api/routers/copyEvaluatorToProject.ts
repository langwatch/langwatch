import { Prisma, type PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";
import type { Session } from "~/server/auth";
import { EvaluatorService } from "../../evaluators/evaluator.service";
import { enforceLicenseLimit } from "../../license-enforcement";
import {
  copyWorkflowWithDatasets,
  saveOrCommitWorkflowVersion,
} from "./workflows";

type CopyEvaluatorCtx = { prisma: PrismaClient; session: Session };

type SourceEvaluator = NonNullable<
  Awaited<ReturnType<typeof loadSourceEvaluator>>
>;

/** Loads the source evaluator (with its workflow), or throws NOT_FOUND. */
async function loadSourceEvaluator(
  ctx: CopyEvaluatorCtx,
  evaluatorId: string,
  sourceProjectId: string,
) {
  const source = await ctx.prisma.evaluator.findFirst({
    where: { id: evaluatorId, projectId: sourceProjectId, archivedAt: null },
    include: { workflow: { include: { latestVersion: true } } },
  });
  if (!source) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Evaluator not found" });
  }
  return source;
}

/**
 * Clones a workflow evaluator's backing workflow into the target project and
 * returns the new workflow id. Returns null for non-workflow evaluators. Throws
 * if a workflow evaluator has no saved version to copy — creating the evaluator
 * without a workflow would leave a structurally broken replica.
 */
async function copyWorkflowForEvaluator(
  ctx: CopyEvaluatorCtx,
  source: SourceEvaluator,
  targetProjectId: string,
  sourceProjectId: string,
): Promise<string | null> {
  if (source.type !== "workflow") return null;

  if (!source.workflowId || !source.workflow?.latestVersion?.dsl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message:
        "Cannot replicate a workflow evaluator without a saved workflow version",
    });
  }

  const { workflowId, dsl } = await copyWorkflowWithDatasets({
    ctx,
    workflow: {
      id: source.workflow.id,
      name: source.workflow.name,
      icon: source.workflow.icon,
      description: source.workflow.description,
      isEvaluator: source.workflow.isEvaluator,
      isComponent: source.workflow.isComponent,
      latestVersion: source.workflow.latestVersion,
    },
    targetProjectId,
    sourceProjectId,
    copiedFromWorkflowId: source.workflowId,
  });

  try {
    await saveOrCommitWorkflowVersion({
      ctx,
      input: { projectId: targetProjectId, workflowId, dsl },
      autoSaved: false,
      commitMessage: "Copied from " + source.workflow.name,
    });
  } catch (saveError) {
    // deleteMany (not delete) so the multitenancy guard accepts the projectId
    // scope — a bare { id } delete is rejected and the rollback silently no-ops.
    await ctx.prisma.workflow
      .deleteMany({ where: { id: workflowId, projectId: targetProjectId } })
      .catch(() => undefined);
    throw saveError;
  }

  return workflowId;
}

/**
 * Copies an evaluator (and its backing workflow, for workflow-type evaluators)
 * from one project into another and returns the created evaluator.
 *
 * Shared by `evaluators.copy` and `monitors.copy` so replicating from either
 * surface produces an identical, independently-editable evaluator in the target
 * project. The caller owns the permission checks; this helper enforces the
 * target project's evaluator license limit and assumes the source is readable.
 */
export async function copyEvaluatorToProject({
  ctx,
  evaluatorId,
  sourceProjectId,
  targetProjectId,
  newEvaluatorId = `evaluator_${nanoid()}`,
}: {
  ctx: CopyEvaluatorCtx;
  evaluatorId: string;
  sourceProjectId: string;
  targetProjectId: string;
  newEvaluatorId?: string;
}) {
  await enforceLicenseLimit(ctx, targetProjectId, "evaluators");

  const source = await loadSourceEvaluator(ctx, evaluatorId, sourceProjectId);
  const newWorkflowId = await copyWorkflowForEvaluator(
    ctx,
    source,
    targetProjectId,
    sourceProjectId,
  );

  const evaluatorService = EvaluatorService.create(ctx.prisma);
  try {
    return await evaluatorService.create({
      id: newEvaluatorId,
      projectId: targetProjectId,
      name: source.name,
      type: source.type,
      config: (source.config === null
        ? Prisma.JsonNull
        : source.config) as Prisma.InputJsonValue,
      workflowId: newWorkflowId ?? undefined,
      copiedFromEvaluatorId: source.id,
    });
  } catch (createError) {
    if (newWorkflowId) {
      await ctx.prisma.workflow
        .deleteMany({
          where: { id: newWorkflowId, projectId: targetProjectId },
        })
        .catch(() => undefined);
    }
    throw createError;
  }
}
