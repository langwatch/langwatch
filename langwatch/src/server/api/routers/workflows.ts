import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import type { PrismaClient, WorkflowVersion } from "@prisma/client";
import { type Session } from "next-auth";
import type { Workflow } from "../../../optimization_studio/types/dsl";
import type { Unpacked } from "../../../utils/types";

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
          dsl: {
            ...input.dsl,
            workflow_id: workflow.id,
          },
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
        include: { currentVersion: true },
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
      const workflow = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { currentVersionId: true, latestVersionId: true },
      });

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      const versions = await ctx.prisma.workflowVersion.findMany({
        where: { workflowId: input.workflowId, projectId: input.projectId },
        select: {
          id: true,
          version: true,
          autoSaved: true,
          commitMessage: true,
          updatedAt: true,
          parent: {
            select: {
              id: true,
              version: true,
              commitMessage: true,
            },
          },
          author: {
            select: {
              name: true,
              image: true,
            },
          },
        },
        orderBy: { createdAt: "desc" },
      });

      const versionsWithTags = versions as unknown as (Omit<
        Unpacked<typeof versions>,
        "parent"
      > & {
        isCurrentVersion?: boolean;
        isLatestVersion?: boolean;
        parent?: {
          id: string;
          version: string;
          commitMessage: string;
        };
      })[];
      for (const version of versionsWithTags) {
        if (version.id === workflow?.currentVersionId) {
          version.isCurrentVersion = true;
        } else {
          delete version.parent;
        }
        if (version.id === workflow?.latestVersionId) {
          version.isLatestVersion = true;
        }
      }

      return versionsWithTags;
    }),

  restoreVersion: protectedProcedure
    .input(z.object({ projectId: z.string(), versionId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.prisma.workflowVersion.findUnique({
        where: { id: input.versionId, projectId: input.projectId },
      });

      if (!version || !version.dsl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow version not found",
        });
      }

      const workflow = await ctx.prisma.workflow.findUnique({
        where: { id: version.workflowId, projectId: input.projectId },
      });

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      const dsl = version.dsl as unknown as Workflow;

      await ctx.prisma.workflow.update({
        where: { id: workflow.id, projectId: input.projectId },
        data: {
          name: dsl.name,
          icon: dsl.icon,
          description: dsl.description,
          currentVersionId: version.id,
        },
      });

      return version;
    }),

  autosave: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        dsl: workflowJsonSchema,
        setAsLatestVersion: z.boolean(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ ctx, input }) => {
      const updatedVersion = await saveOrCommitWorkflowVersion({
        ctx,
        input,
        autoSaved: true,
        commitMessage: "Autosaved",
        setAsLatestVersion: input.setAsLatestVersion,
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
  setAsLatestVersion = true,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  input: {
    projectId: string;
    workflowId: string;
    dsl: z.infer<typeof workflowJsonSchema>;
  };
  autoSaved: boolean;
  commitMessage: string;
  setAsLatestVersion?: boolean;
}): Promise<WorkflowVersion> => {
  const workflow = await ctx.prisma.workflow.findUnique({
    where: {
      id: input.workflowId,
      projectId: input.projectId,
      archivedAt: null,
    },
    include: { latestVersion: true, currentVersion: true },
  });
  const autoSavedVersion = await ctx.prisma.workflowVersion.findFirst({
    where: {
      workflowId: input.workflowId,
      projectId: input.projectId,
      autoSaved: true,
    },
    orderBy: { createdAt: "desc" },
  });

  if (!workflow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow not found",
    });
  }

  const latestVersion = workflow.latestVersion;

  const [versionMajor, versionMinor] = (latestVersion?.version ?? "1.0").split(
    "."
  );
  const nextVersion = `${versionMajor}.${parseInt(versionMinor ?? "0") + 1}`;

  const dslWithoutStates = {
    ...input.dsl,
    state: {},
  };
  const data = {
    commitMessage,
    authorId: ctx.session.user.id,
    projectId: input.projectId,
    workflowId: input.workflowId,
    autoSaved,
    dsl: dslWithoutStates as object,
  };

  let updatedVersion: WorkflowVersion;
  if (autoSavedVersion) {
    updatedVersion = await ctx.prisma.workflowVersion.update({
      where: { id: autoSavedVersion.id, projectId: input.projectId },
      data: {
        ...data,
        ...(workflow.currentVersionId !== autoSavedVersion.id && {
          parentId: workflow.currentVersionId,
        }),
      },
    });
  } else {
    updatedVersion = await ctx.prisma.workflowVersion.create({
      data: {
        id: nanoid(),
        parentId: latestVersion?.id,
        version: autoSaved ? nextVersion : input.dsl.version,
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
      currentVersionId: updatedVersion.id,
      latestVersionId: setAsLatestVersion
        ? updatedVersion.id
        : latestVersion?.id,
    },
  });

  return updatedVersion;
};
