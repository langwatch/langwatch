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
    icon: z.string().optional(),
    version: z.string(),
  })
  .passthrough();

export const workflowRouter = createTRPCRouter({
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      return ctx.prisma.workflow.findMany({
        where: { projectId: input.projectId },
      });
    }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: input.workflowId, projectId: input.projectId },
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
          description: true,
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
        description: "autosaved",
      });

      return updatedVersion;
    }),

  commitVersion: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        description: z.string(),
        dsl: workflowJsonSchema,
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const newVersion = await saveOrCommitWorkflowVersion({
        ctx,
        input,
        autoSaved: false,
        description: input.description,
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
        where: { id: input.workflowId },
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
});

const saveOrCommitWorkflowVersion = async ({
  ctx,
  input,
  autoSaved,
  description,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  input: {
    projectId: string;
    workflowId: string;
    dsl: z.infer<typeof workflowJsonSchema>;
  };
  autoSaved: boolean;
  description: string;
}): Promise<WorkflowVersion> => {
  const workflow = await ctx.prisma.workflow.findUnique({
    where: { id: input.workflowId, projectId: input.projectId },
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
    description,
    authorId: ctx.session.user.id,
    projectId: input.projectId,
    workflowId: input.workflowId,
    autoSaved,
    dsl: input.dsl as object,
  };

  let updatedVersion: WorkflowVersion;
  if (latestVersion?.autoSaved) {
    updatedVersion = await ctx.prisma.workflowVersion.update({
      where: { id: latestVersion.id },
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
    where: { id: input.workflowId },
    data: {
      name: input.dsl.name,
      icon: input.dsl.icon,
      latestVersionId: updatedVersion.id,
    },
  });

  return updatedVersion;
};
