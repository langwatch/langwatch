import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { nanoid } from "nanoid";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import type { Prisma, PrismaClient, WorkflowVersion } from "@prisma/client";
import { type Session } from "next-auth";
import {
  workflowJsonSchema,
  type Workflow,
} from "../../../optimization_studio/types/dsl";
import type { Unpacked } from "../../../utils/types";
import { migrateDSLVersion } from "../../../optimization_studio/types/migrate";
import { createPatch } from "diff";
import { generateText } from "ai";
import { getVercelAIModel } from "../../modelProviders/utils";
import {
  clearDsl,
  hasDSLChanged,
  recursiveAlphabeticallySortedKeys,
} from "../../../optimization_studio/utils/dslUtils";

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

      if (workflow.currentVersion) {
        workflow.currentVersion.dsl = migrateDSLVersion(
          workflow.currentVersion.dsl as unknown as Workflow
        ) as any;
      }

      return workflow;
    }),

  getVersions: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        returnDSL: z
          .union([z.boolean(), z.literal("previousVersion")])
          .optional(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_VIEW))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: {
          currentVersionId: true,
          latestVersionId: true,
          publishedId: true,
        },
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
          dsl: input.returnDSL === true ? true : false,
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
        isPublishedVersion?: boolean;
        isPreviousVersion?: boolean;
        parent?: {
          id: string;
          version: string;
          commitMessage: string;
        };
      })[];
      let previousVersionId: string | undefined;
      for (const version of versionsWithTags) {
        if (version.id === workflow?.currentVersionId) {
          version.isCurrentVersion = true;
          previousVersionId = version.parent?.id;
        } else {
          delete version.parent;
        }
        if (version.id === workflow?.latestVersionId) {
          version.isLatestVersion = true;
        }
        if (version.id === workflow?.publishedId) {
          version.isPublishedVersion = true;
        }
      }
      for (const version of versionsWithTags) {
        if (version.id === previousVersionId) {
          version.isPreviousVersion = true;
          if (input.returnDSL === "previousVersion") {
            version.dsl = (
              await ctx.prisma.workflowVersion.findFirst({
                where: { id: version.id, projectId: input.projectId },
                select: { dsl: true },
              })
            )?.dsl as Prisma.JsonValue;
          }
        }
      }

      return versionsWithTags.map((version) => ({
        ...version,
        dsl: version.dsl as unknown as Workflow | undefined,
      }));
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

      const dsl = migrateDSLVersion(version.dsl as unknown as Workflow);

      await ctx.prisma.workflow.update({
        where: { id: workflow.id, projectId: input.projectId },
        data: {
          name: dsl.name,
          icon: dsl.icon,
          description: dsl.description,
          currentVersionId: version.id,
        },
      });

      return { ...version, dsl };
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

  generateCommitMessage: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        prevDsl: workflowJsonSchema,
        newDsl: workflowJsonSchema,
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.WORKFLOWS_MANAGE))
    .mutation(async ({ input }) => {
      const prevDsl_ = JSON.stringify(
        recursiveAlphabeticallySortedKeys(clearDsl(input.prevDsl)),
        null,
        2
      );
      const newDsl_ = JSON.stringify(
        recursiveAlphabeticallySortedKeys(clearDsl(input.newDsl)),
        null,
        2
      );
      if (prevDsl_ === newDsl_) {
        return "no changes";
      }

      const diff = createPatch(
        "workflow.json",
        prevDsl_,
        newDsl_,
        "Previous Version",
        "New Version"
      );

      const commitMessage = await generateText({
        model: await getVercelAIModel(input.projectId),
        messages: [
          {
            role: "system",
            content: `
You are a diff generator for the LLM Workflow builder from LangWatch Optimization Studio.
Generate very short, concise commit messages for the changes in the diff. From 1 to 5 words max, all lowercase.
If changing the model, just say the short new model name, like "gpt-4o", nothing else.
For other changes:
- Ignore renames and position changes unless it's the only thing that changed.
- Explain not only the keys that changed, but the content inside them, for example do not say just "updated prompt", \
but the actual change that was made inside the fields with as few words as possible, like "avoid word <example>".
- By the way, always refer to the prompt as "prompt", not "instructions".
- When changing the evaluator, it's not just the name the changes, it means the workflow is actually now using a different evaluator.
            `,
          },
          {
            role: "user",
            content: `
Original File:
\`\`\`json
${prevDsl_}
\`\`\`

Diff:
\`\`\`diff
${diff}
\`\`\`
            `,
          },
        ],
        tools: {
          commitMessage: {
            type: "function",
            parameters: z.object({
              message: z.string(),
            }),
          },
        },
        toolChoice: {
          type: "tool",
          toolName: "commitMessage",
        },
      });

      const result = commitMessage.toolCalls[0]?.args.message;

      // TODO: save call costs to user account

      return result;
    }),
});

export const saveOrCommitWorkflowVersion = async ({
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

  const [versionMajor] = (latestVersion?.version ?? "0.0").split(".");
  const nextVersion = `${parseInt(versionMajor ?? "0") + 1}`;

  const dslWithoutStates = JSON.parse(
    JSON.stringify({
      ...input.dsl,
      state: {},
    })
  );
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
