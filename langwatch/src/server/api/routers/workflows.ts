import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import type { PrismaClient, WorkflowVersion } from "@prisma/client";
import { type Session } from "next-auth";

const workflowJsonSchema = z
  .object({
    spec_version: z.string(),
    name: z.string(),
    icon: z.string(),
    description: z.string(),
    version: z
      .string()
      .regex(
        /^\d+\.\d+$/,
        "Version must be in the format 'number.number' (e.g. 1.0)"
      ),
  })
  .passthrough();

export const workflowRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dsl: workflowJsonSchema,
        commitMessage: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.create({
        data: {
          id: `workflow_${nanoid()}`,
          projectId: input.projectId,
          name: input.dsl.name,
          icon: input.dsl.icon,
          description: input.dsl.description,
        },
      });

      const version = await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: input.projectId,
          workflowId: workflow.id,
          dsl: input.dsl,
        },
        autoSaved: false,
        commitMessage: input.commitMessage,
      });

      return { workflow, version };
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.workflow.findMany({
        where: { projectId: input.projectId, archivedAt: null },
      });
    }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        include: { latestVersion: true },
      });

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      return workflow;
    }),

  getVersions: protectedProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.workflowVersion.findMany({
        where: { workflowId: input.workflowId, projectId: input.projectId },
        select: {
          id: true,
          version: true,
          commitMessage: true,
          authorId: true,
          parentId: true,
          createdAt: true,
          updatedAt: true,
          autoSaved: true,
        },
        orderBy: { createdAt: "desc" },
      });
    }),

  getVersionById: protectedProcedure
    .input(z.object({ projectId: z.string(), versionId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const version = await ctx.prisma.workflowVersion.findUnique({
        where: { id: input.versionId, projectId: input.projectId },
      });

      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow version not found",
        });
      }

      return version;
    }),

  autosave: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        dsl: workflowJsonSchema,
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const updatedVersion = await saveOrCommitWorkflowVersion({
        ctx,
        input,
        autoSaved: true,
        commitMessage: "autosaved",
      });

      return updatedVersion;
    }),

  commitVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        commitMessage: z.string(),
        dsl: workflowJsonSchema,
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const newVersion = await saveOrCommitWorkflowVersion({
        ctx,
        input,
        autoSaved: false,
        commitMessage: input.commitMessage,
      });

      return newVersion;
    }),

  publish: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        versionId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.prisma.workflowVersion.findUnique({
        where: {
          id: input.versionId,
          workflowId: input.workflowId,
          projectId: input.projectId,
        },
      });

      if (!version) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow version not found",
        });
      }

      return ctx.prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          publishedId: input.versionId,
          publishedById: ctx.session.user.id,
        },
      });
    }),

  unpublish: protectedProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          publishedId: null,
          publishedById: null,
        },
      });
    }),

  archive: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        unarchive: z.boolean().optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          archivedAt: input.unarchive ? null : new Date(),
        },
      });
    }),
});

const saveOrCommitWorkflowVersion = async ({
  ctx,
  input,
  autoSaved,
  commitMessage,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  input: {
    projectId: string;
    workflowId: string;
    dsl: z.infer<typeof workflowJsonSchema>;
  };
  autoSaved: boolean;
  commitMessage: string;
}): Promise<WorkflowVersion> => {
  const workflow = await ctx.prisma.workflow.findUnique({
    where: {
      id: input.workflowId,
      projectId: input.projectId,
      archivedAt: null,
    },
    include: { latestVersion: true },
  });

  if (!workflow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow not found",
    });
  }

  const latestVersion = workflow.latestVersion;

  const data = {
    version: input.dsl.version,
    commitMessage,
    authorId: ctx.session.user.id,
    projectId: input.projectId,
    workflowId: input.workflowId,
    autoSaved,
    dsl: input.dsl as object,
  };

  let updatedVersion: WorkflowVersion;
  if (latestVersion?.autoSaved) {
    updatedVersion = await ctx.prisma.workflowVersion.update({
      where: { id: latestVersion.id, projectId: input.projectId },
      data,
    });
  } else {
    updatedVersion = await ctx.prisma.workflowVersion.create({
      data: {
        id: nanoid(),
        parentId: latestVersion?.id,
        ...data,
      },
    });
  }

  await ctx.prisma.workflow.update({
    where: { id: input.workflowId, projectId: input.projectId },
    data: {
      name: input.dsl.name,
      icon: input.dsl.icon,
      description: input.dsl.description,
      latestVersionId: updatedVersion.id,
    },
  });

  return updatedVersion;
};
