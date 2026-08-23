import type {
  AgentHistoryEntry,
  AgentWithFields,
} from "@langwatch/agents-contract";
import {
  AgentService,
  PrismaAgentAdapter,
  type AgentsAuditLogPort,
  type AgentsDatabase,
  type AgentsWorkflowPort,
} from "@langwatch/agents-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Workflow } from "~/optimization_studio/types/dsl";
import { workflowAgentFields } from "~/server/agents/agent-fields";
import type { Session } from "~/server/auth";

export type AgentsRuntimeContext = {
  prisma: PrismaClient;
  session: Session | null;
};

export class AgentsFeature {
  static create(context: AgentsRuntimeContext): AgentService {
    const { prisma } = context;
    return PrismaAgentAdapter.create({
      database: prisma as unknown as AgentsDatabase,
      workflows: AgentsFeature.workflowPort(context),
      auditLog: AgentsFeature.auditLogPort(prisma),
    });
  }

  private static workflowPort(
    context: AgentsRuntimeContext,
  ): AgentsWorkflowPort {
    const { prisma } = context;
    return {
      async fields({ projectId, workflowIds }) {
        const workflows = await prisma.workflow.findMany({
          where: {
            id: { in: workflowIds },
            projectId,
            archivedAt: null,
          },
          include: { currentVersion: true },
        });
        return Object.fromEntries(
          workflows.map((workflow) => [
            workflow.id,
            workflowAgentFields(
              workflow.currentVersion?.dsl as Workflow | undefined,
            ),
          ]),
        );
      },
      async related({ projectId, workflowId }) {
        return prisma.workflow.findFirst({
          where: { id: workflowId, projectId, archivedAt: null },
          select: { id: true, name: true },
        });
      },
      async copy({ workflowId, sourceProjectId, targetProjectId }) {
        return AgentsFeature.copyWorkflow(context, {
          workflowId,
          sourceProjectId,
          targetProjectId,
        });
      },
      async archive({ workflowId, projectId }) {
        return prisma.workflow.update({
          where: { id: workflowId, projectId },
          data: { archivedAt: new Date() },
          select: { id: true },
        });
      },
      remove: ({ workflowId, projectId }) =>
        AgentsFeature.removeWorkflow(prisma, workflowId, projectId),
    };
  }

  private static auditLogPort(prisma: PrismaClient): AgentsAuditLogPort {
    return {
      async history({ agentId, projectId, limit }) {
        const logs = await prisma.auditLog.findMany({
          where: {
            projectId,
            action: { startsWith: "agents." },
            OR: [
              { args: { path: ["id"], equals: agentId } },
              { args: { path: ["agentId"], equals: agentId } },
              { args: { path: ["newAgentId"], equals: agentId } },
            ],
          },
          orderBy: { createdAt: "desc" },
          take: limit,
        });
        const userIds = [
          ...new Set(
            logs
              .map((log) => log.userId)
              .filter((id): id is string => Boolean(id)),
          ),
        ];
        const users = await prisma.user.findMany({
          where: { id: { in: userIds } },
          select: { id: true, name: true, email: true },
        });
        const usersById = new Map(users.map((user) => [user.id, user]));
        return logs.map(
          (log): AgentHistoryEntry => ({
            id: log.id,
            action: log.action,
            createdAt: log.createdAt,
            args: log.args,
            user: log.userId ? (usersById.get(log.userId) ?? null) : null,
          }),
        );
      },
    };
  }

  private static async copyWorkflow(
    context: AgentsRuntimeContext,
    input: {
      workflowId: string;
      sourceProjectId: string;
      targetProjectId: string;
    },
  ): Promise<{ workflowId: string }> {
    if (!context.session) {
      throw new Error(
        "An authenticated session is required to copy a workflow agent.",
      );
    }
    const { prisma } = context;
    const workflow = await prisma.workflow.findFirst({
      where: {
        id: input.workflowId,
        projectId: input.sourceProjectId,
        archivedAt: null,
      },
      include: { latestVersion: true },
    });
    if (!workflow?.latestVersion?.dsl) {
      throw new Error("Workflow version not found.");
    }
    // This app-owned adapter still delegates to legacy workflow orchestration.
    // Load it only when copying so the tRPC context can compose RequestApp
    // without creating a module cycle back through the workflow router.
    const { copyWorkflowWithDatasets, saveOrCommitWorkflowVersion } =
      await import("~/server/api/routers/workflows");
    const copied = await copyWorkflowWithDatasets({
      ctx: { prisma, session: context.session },
      workflow: {
        id: workflow.id,
        name: workflow.name,
        icon: workflow.icon,
        description: workflow.description,
        isEvaluator: workflow.isEvaluator,
        isComponent: workflow.isComponent,
        latestVersion: { dsl: workflow.latestVersion.dsl },
      },
      targetProjectId: input.targetProjectId,
      sourceProjectId: input.sourceProjectId,
      copiedFromWorkflowId: input.workflowId,
    });
    await saveOrCommitWorkflowVersion({
      ctx: { prisma, session: context.session },
      input: {
        projectId: input.targetProjectId,
        workflowId: copied.workflowId,
        dsl: copied.dsl,
      },
      autoSaved: false,
      commitMessage: `Copied from ${workflow.name}`,
    });
    return { workflowId: copied.workflowId };
  }

  private static async removeWorkflow(
    prisma: PrismaClient,
    workflowId: string,
    projectId: string,
  ): Promise<void> {
    await prisma.workflow.update({
      where: { id: workflowId, projectId },
      data: { currentVersionId: null, latestVersionId: null },
    });
    await prisma.workflowVersion.updateMany({
      where: { workflowId, projectId },
      data: { parentId: null },
    });
    await prisma.workflowVersion.deleteMany({
      where: { workflowId, projectId },
    });
    await prisma.workflow.delete({ where: { id: workflowId, projectId } });
  }
}

/** Temporary view for app code that still expects Prisma's `_count` shape. */
export class LegacyAgentPresenter {
  static withCopyCount<T extends AgentWithFields>(agent: T) {
    return {
      ...agent,
      _count: { copiedAgents: agent.copyCount ?? 0 },
    };
  }
}
