import { type PrismaClient, Prisma } from "@prisma/client";
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

  const source = await ctx.prisma.evaluator.findFirst({
    where: {
      id: evaluatorId,
      projectId: sourceProjectId,
      archivedAt: null,
    },
    include: {
      workflow: { include: { latestVersion: true } },
    },
  });

  if (!source) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Evaluator not found" });
  }

  let newWorkflowId: string | null = null;
  if (
    source.type === "workflow" &&
    source.workflowId &&
    source.workflow?.latestVersion?.dsl
  ) {
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
    newWorkflowId = workflowId;
    try {
      await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: targetProjectId,
          workflowId,
          dsl,
        },
        autoSaved: false,
        commitMessage: "Copied from " + source.workflow.name,
      });
    } catch (saveError) {
      await ctx.prisma.workflow
        .delete({ where: { id: newWorkflowId } })
        .catch(() => {});
      throw saveError;
    }
  }

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
        .delete({ where: { id: newWorkflowId } })
        .catch(() => {});
    }
    throw createError;
  }
}
