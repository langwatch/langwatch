import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import { NotFoundError } from "@langwatch/handled-error";
import { createLogger } from "@langwatch/observability";
import type { Prisma, PrismaClient, WorkflowVersion } from "@prisma/client";
import type { JsonValue } from "@prisma/client/runtime/library";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { createPatch } from "diff";
import { nanoid } from "nanoid";
import { z } from "zod";
import { fireWorkflowCreatedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import type { Session } from "~/server/auth";
import { captureException } from "~/utils/posthogErrorCapture";
import {
  type Workflow,
  workflowJsonSchema,
} from "../../../optimization_studio/types/dsl";
import { migrateDSLVersion } from "../../../optimization_studio/types/migrate";
import {
  clearDsl,
  recursiveAlphabeticallySortedKeys,
} from "../../../optimization_studio/utils/dslUtils";
import { mergeLocalConfigsIntoDsl } from "../../../optimization_studio/utils/mergeLocalConfigs";
import type { Unpacked } from "../../../utils/types";
import { DatasetService } from "../../datasets/dataset.service";
import { pMapLimited } from "../../event-sourcing/replay/pMapLimited";
import { wrapAiCall } from "../../modelProviders/aiCallFailedError";
import { featureByKey } from "../../modelProviders/featureRegistry";
import { getVercelAIModel } from "../../modelProviders/utils";
import { autoComputeAgentMappings } from "../../workflows/auto-compute-agent-mappings";
import { materializeNodeLlmConfigs } from "../../workflows/materializeNodeLlmConfigs";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const autoComputeLogger = createLogger("langwatch:workflows:auto-compute");

// Each related project (a workflow's copy source, or one of its copies)
// needs its own RBAC check; cap concurrency so a workflow with many copies
// can't exhaust the DB connection pool.
async function resolveVisibleProjectsForWorkflows({
  ctx,
  workflows,
  projectId,
}: {
  ctx: Parameters<typeof hasProjectPermission>[0];
  workflows: {
    copiedFrom: { projectId: string } | null;
    copiedWorkflows: { projectId: string }[];
  }[];
  projectId: string;
}): Promise<Map<string, boolean>> {
  const relatedProjectIds = [
    ...new Set(
      workflows.flatMap((workflow) => [
        ...(workflow.copiedFrom ? [workflow.copiedFrom.projectId] : []),
        ...workflow.copiedWorkflows.map((copy) => copy.projectId),
      ]),
    ),
  ];
  const visibleProjects = new Map<string, boolean>();
  await pMapLimited({
    items: relatedProjectIds,
    concurrency: 5,
    fn: async (relatedProjectId) => {
      const isVisible =
        relatedProjectId === projectId ||
        (await hasProjectPermission(ctx, relatedProjectId, "workflows:view"));
      visibleProjects.set(relatedProjectId, isVisible);
    },
  });
  return visibleProjects;
}

// Hides the copy-source/copy-count details of a related workflow the caller
// cannot see into, per the visibility map from
// `resolveVisibleProjectsForWorkflows`.
function shapeWorkflowWithCopyVisibility<
  T extends {
    copiedFromWorkflowId: string | null;
    copiedFrom: { projectId: string } | null;
    copiedWorkflows: { projectId: string }[];
  },
>(workflow: T, visibleProjects: Map<string, boolean>) {
  const { copiedWorkflows, ...rest } = workflow;
  const canSeeSource =
    rest.copiedFrom && visibleProjects.get(rest.copiedFrom.projectId);
  return {
    ...rest,
    copiedFromWorkflowId: canSeeSource ? rest.copiedFromWorkflowId : null,
    copiedFrom: canSeeSource ? rest.copiedFrom : null,
    _count: {
      copiedWorkflows: copiedWorkflows.filter((copy) =>
        visibleProjects.get(copy.projectId),
      ).length,
    },
  };
}

// Query copies through the relation to avoid projectId requirement in
// findMany.
async function fetchWorkflowCopyProjects({
  ctx,
  workflowId,
  projectId,
}: {
  ctx: { prisma: PrismaClient };
  workflowId: string;
  projectId: string;
}) {
  const workflowWithCopies = await ctx.prisma.workflow.findUnique({
    where: {
      id: workflowId,
      projectId,
    },
    select: {
      id: true,
      copiedWorkflows: {
        where: {
          archivedAt: null,
        },
        select: {
          id: true,
          name: true,
          projectId: true,
          project: {
            select: {
              id: true,
              name: true,
              team: {
                select: {
                  id: true,
                  name: true,
                  organization: {
                    select: {
                      id: true,
                      name: true,
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
  });

  if (!workflowWithCopies) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow not found",
    });
  }

  return workflowWithCopies.copiedWorkflows;
}

async function shapeWorkflowCopyWithPermission({
  ctx,
  copy,
}: {
  ctx: Parameters<typeof hasProjectPermission>[0];
  copy: Unpacked<Awaited<ReturnType<typeof fetchWorkflowCopyProjects>>>;
}) {
  const hasPermission = await hasProjectPermission(
    ctx,
    copy.projectId,
    "workflows:update",
  );
  return {
    id: copy.id,
    name: copy.name,
    projectId: copy.projectId,
    projectName: copy.project.name,
    teamName: copy.project.team.name,
    organizationName: copy.project.team.organization.name,
    fullPath: `${copy.project.team.organization.name} / ${copy.project.team.name} / ${copy.project.name}`,
    hasPermission,
  };
}

type TaggedWorkflowVersion = {
  id: string;
  dsl?: Prisma.JsonValue;
  isCurrentVersion?: boolean;
  isLatestVersion?: boolean;
  isPublishedVersion?: boolean;
  isPreviousVersion?: boolean;
  parent?: { id: string; version: string; commitMessage: string };
  [key: string]: unknown;
};

// Marks each version current/latest/published relative to the workflow row,
// and remembers the current version's parent id (the "previous version") —
// `parent` is otherwise dropped from every non-current row below.
function tagWorkflowVersions({
  versions,
  workflow,
}: {
  versions: TaggedWorkflowVersion[];
  workflow: {
    currentVersionId: string | null;
    latestVersionId: string | null;
    publishedId: string | null;
  };
}): { previousVersionId: string | undefined } {
  let previousVersionId: string | undefined;
  for (const version of versions) {
    if (version.id === workflow.currentVersionId) {
      version.isCurrentVersion = true;
      previousVersionId = version.parent?.id;
    } else {
      delete version.parent;
    }
    if (version.id === workflow.latestVersionId) {
      version.isLatestVersion = true;
    }
    if (version.id === workflow.publishedId) {
      version.isPublishedVersion = true;
    }
  }
  return { previousVersionId };
}

// Tags the previous version and, when the caller asked for it specifically
// (`returnDSL: "previousVersion"`), fetches its DSL — the bulk `findMany`
// above only selects `dsl` when `returnDSL === true` for every row.
async function attachPreviousVersionDsl({
  ctx,
  versions,
  previousVersionId,
  projectId,
  returnDSL,
}: {
  ctx: { prisma: PrismaClient };
  versions: TaggedWorkflowVersion[];
  previousVersionId: string | undefined;
  projectId: string;
  returnDSL: boolean | "previousVersion" | undefined;
}): Promise<void> {
  for (const version of versions) {
    if (version.id === previousVersionId) {
      version.isPreviousVersion = true;
      if (returnDSL === "previousVersion") {
        version.dsl = (
          await ctx.prisma.workflowVersion.findFirst({
            where: { id: version.id, projectId },
            select: { dsl: true },
          })
        )?.dsl as Prisma.JsonValue;
      }
    }
  }
}

type WorkflowCopyForPush = {
  id: string;
  projectId: string;
  name: string;
};

// Fetches the source workflow with its live copies, validates it has a
// latest version and at least one copy to push to, and narrows to the
// caller-selected subset (if any). Throws when nothing is left to push to.
async function resolveWorkflowPushSource({
  ctx,
  input,
}: {
  ctx: { prisma: PrismaClient };
  input: { workflowId: string; projectId: string; copyIds?: string[] };
}): Promise<{
  workflow: { copiedWorkflows: WorkflowCopyForPush[] };
  dsl: Workflow;
  copiesToPush: WorkflowCopyForPush[];
}> {
  // Get the workflow (source) and check if it has copies
  const workflow = await ctx.prisma.workflow.findUnique({
    where: {
      id: input.workflowId,
      projectId: input.projectId,
      archivedAt: null,
    },
    include: {
      latestVersion: true,
      copiedWorkflows: {
        where: {
          archivedAt: null,
        },
        include: {
          latestVersion: true,
        },
      },
    },
  });

  if (!workflow) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow not found",
    });
  }

  if (!workflow.latestVersion?.dsl) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This workflow has no latest version to push",
    });
  }

  if (workflow.copiedWorkflows.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "This workflow has no copies to push to",
    });
  }

  // Filter copies if copyIds is provided
  const copiesToPush = input.copyIds
    ? workflow.copiedWorkflows.filter((copy) =>
        input.copyIds!.includes(copy.id),
      )
    : workflow.copiedWorkflows;

  if (copiesToPush.length === 0) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "No valid copies selected to push to",
    });
  }

  // Deep clone DSL to ensure mutability
  const dsl = JSON.parse(
    JSON.stringify(workflow.latestVersion.dsl),
  ) as Workflow;

  return { workflow, dsl, copiesToPush };
}

// Pushes the source DSL to one copy as a new version, computed off THAT
// copy's own latest version number (not the source's) since each copy
// maintains its own version history independently. Returns null (rather
// than throwing) when the caller lacks permission on the copy's project, so
// the caller can skip it and keep pushing to the rest.
async function pushWorkflowVersionToCopy({
  ctx,
  copy,
  dsl,
}: {
  ctx: { prisma: PrismaClient } & Parameters<typeof hasProjectPermission>[0];
  copy: WorkflowCopyForPush;
  dsl: Workflow;
}): Promise<{
  copyId: string;
  copyName: string;
  version: Awaited<ReturnType<typeof saveOrCommitWorkflowVersion>>;
} | null> {
  const hasCopyPermission = await hasProjectPermission(
    ctx,
    copy.projectId,
    "workflows:update",
  );
  if (!hasCopyPermission) return null;

  // Fetch the copy's latest version to get its current version number
  const copyWithLatestVersion = await ctx.prisma.workflow.findUnique({
    where: {
      id: copy.id,
      projectId: copy.projectId,
    },
    include: {
      latestVersion: true,
    },
  });

  if (!copyWithLatestVersion) return null;

  const copyLatestVersion = copyWithLatestVersion.latestVersion;
  const [versionMajor] = (copyLatestVersion?.version ?? "0.0").split(".");
  const nextVersion = `${parseInt(versionMajor ?? "0") + 1}`;

  // Update the workflow_id to match the copy
  const copyDsl = JSON.parse(JSON.stringify(dsl)) as Workflow;
  copyDsl.workflow_id = copy.id;

  // Create a new version in the copy with the source's latest DSL
  const version = await saveOrCommitWorkflowVersion({
    ctx,
    input: {
      projectId: copy.projectId,
      workflowId: copy.id,
      dsl: {
        ...copyDsl,
        version: nextVersion,
      },
    },
    autoSaved: false,
    commitMessage: "Updated from source workflow",
  });

  return { copyId: copy.id, copyName: copy.name, version };
}

export const workflowRouter = createTRPCRouter({
  // Returns which NLP engine is active for the current project. Used by the
  // Studio UI reads this to hide the (now-defunct) Optimize button.
  // Optimization was DSPy-only and the Go engine never included DSPy, so
  // with nlpgo the only engine the button is always hidden. Kept as a
  // procedure (rather than a UI constant) so the studio handlers and the
  // UI agree on one source of truth.
  engineMode: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(() => {
      return {
        engineMode: "go" as const,
        optimizeEnabled: false,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dsl: workflowJsonSchema,
        commitMessage: z.string(),
        publish: z.boolean().optional(), // Auto-publish the first version (useful for evaluator workflows)
      }),
    )
    .use(checkProjectPermission("workflows:create"))
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

      // Auto-publish the first version if requested
      if (input.publish) {
        await ctx.prisma.workflow.update({
          where: { id: workflow.id, projectId: input.projectId },
          data: {
            publishedId: version.id,
            publishedById: ctx.session.user.id,
          },
        });
      }

      void ctx.prisma.workflow
        .count({
          where: { projectId: input.projectId, archivedAt: null },
        })
        .then((count) => {
          fireWorkflowCreatedNurturing({
            userId: ctx.session.user.id,
            workflowCount: count,
            workflowId: workflow.id,
            projectId: input.projectId,
          });
        })
        .catch(captureException);

      return { workflow, version };
    }),

  copy: protectedProcedure
    .input(
      z.object({
        workflowId: z.string(),
        projectId: z.string(),
        sourceProjectId: z.string(),
        copyDatasets: z.boolean().optional(),
      }),
    )
    .use(checkProjectPermission("workflows:create"))
    .mutation(async ({ ctx, input }) => {
      // Check that the user has at least workflows:create permission on the source project
      const hasSourcePermission = await hasProjectPermission(
        ctx,
        input.sourceProjectId,
        "workflows:create",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to create workflows in the source project",
        });
      }

      const workflow = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.sourceProjectId,
        },
        include: {
          latestVersion: true,
        },
      });

      if (!workflow?.latestVersion?.dsl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      const { workflowId, dsl } = await copyWorkflowWithDatasets({
        ctx,
        workflow,
        targetProjectId: input.projectId,
        sourceProjectId: input.sourceProjectId,
        copyDatasets: input.copyDatasets,
        copiedFromWorkflowId: input.workflowId,
      });

      const newWorkflow = await ctx.prisma.workflow.findFirst({
        where: {
          id: workflowId,
          projectId: input.projectId,
        },
      });

      if (!newWorkflow) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create workflow",
        });
      }

      const version = await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: input.projectId,
          workflowId,
          dsl,
        },
        autoSaved: false,
        commitMessage: "Copied from " + workflow.name,
      });

      return { workflow: newWorkflow, version };
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ ctx, input }) => {
      const workflows = await ctx.prisma.workflow.findMany({
        where: { projectId: input.projectId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: {
          id: true,
          projectId: true,
          name: true,
          icon: true,
          description: true,
          createdAt: true,
          updatedAt: true,
          latestVersionId: true,
          currentVersionId: true,
          publishedId: true,
          publishedById: true,
          archivedAt: true,
          isEvaluator: true,
          isComponent: true,
          copiedFromWorkflowId: true,
          copiedFrom: {
            select: {
              id: true,
              name: true,
              projectId: true,
              project: {
                select: {
                  id: true,
                  name: true,
                  team: {
                    select: {
                      id: true,
                      name: true,
                      organization: {
                        select: {
                          id: true,
                          name: true,
                        },
                      },
                    },
                  },
                },
              },
            },
          },
          copiedWorkflows: {
            where: { archivedAt: null },
            select: { projectId: true },
          },
        },
      });

      const visibleProjects = await resolveVisibleProjectsForWorkflows({
        ctx,
        workflows,
        projectId: input.projectId,
      });

      return workflows.map((workflow) =>
        shapeWorkflowWithCopyVisibility(workflow, visibleProjects),
      );
    }),

  getCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ ctx, input }) => {
      // Find the workflow by ID and projectId (Prisma requires projectId in where clause)
      const workflow = await ctx.prisma.workflow.findFirst({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
      });

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      // Verify the user has view permission on the workflow's project
      const hasPermission = await hasProjectPermission(
        ctx,
        workflow.projectId,
        "workflows:view",
      );

      if (!hasPermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You do not have permission to view this workflow",
        });
      }

      const copies = await fetchWorkflowCopyProjects({
        ctx,
        workflowId: input.workflowId,
        projectId: input.projectId,
      });

      // Filter copies based on user's workflows:update permission
      const copiesWithPermissions = await Promise.all(
        copies.map((copy) => shapeWorkflowCopyWithPermission({ ctx, copy })),
      );

      // Only return copies where user has permission
      const filteredCopies = copiesWithPermissions.filter(
        (copy) => copy.hasPermission,
      );

      // If no copies found but copies exist, it means user doesn't have permission on any of them
      if (filteredCopies.length === 0 && copies.length > 0) {
        // Return empty array - the UI will show "No copies found"
        // This is expected if user doesn't have workflows:update permission on copy projects
        return [];
      }

      return filteredCopies;
    }),

  getById: protectedProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.string() }))
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ ctx, input }) => {
      const workflow = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        include: { currentVersion: true },
      });

      // Handled, like the same failure already is in `runWorkflow.ts`. As a
      // bare `TRPCError` this crossed the boundary as prose, so the client had
      // no code to key copy off: the studio's error card fell back to the
      // caller's generic headline, printed the humanised slug underneath it,
      // and — because an unrecognised code is not something the reader can be
      // told how to fix — offered them an error id for a workflow that had
      // simply been deleted.
      if (!workflow) {
        throw new NotFoundError(
          "workflow_not_found",
          "Workflow",
          input.workflowId,
        );
      }

      if (workflow.currentVersion) {
        workflow.currentVersion.dsl = migrateDSLVersion(
          workflow.currentVersion.dsl as unknown as Workflow,
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
      }),
    )
    .use(checkProjectPermission("workflows:view"))
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

      const versionsWithTags = versions as unknown as TaggedWorkflowVersion[];
      const { previousVersionId } = tagWorkflowVersions({
        versions: versionsWithTags,
        workflow,
      });
      await attachPreviousVersionDsl({
        ctx,
        versions: versionsWithTags,
        previousVersionId,
        projectId: input.projectId,
        returnDSL: input.returnDSL,
      });

      return versionsWithTags.map((version) => ({
        ...version,
        dsl: version.dsl as unknown as Workflow | undefined,
      }));
    }),

  restoreVersion: protectedProcedure
    .input(z.object({ projectId: z.string(), versionId: z.string() }))
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      const version = await ctx.prisma.workflowVersion.findUnique({
        where: { id: input.versionId, projectId: input.projectId },
      });

      if (!version?.dsl) {
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
      }),
    )
    .use(checkProjectPermission("workflows:update"))
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
      }),
    )
    .use(checkProjectPermission("workflows:update"))
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
      }),
    )
    .use(checkProjectPermission("workflows:update"))
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
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      return ctx.prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          publishedId: null,
          publishedById: null,
        },
      });
    }),

  syncFromSource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      // Get the workflow and check if it has a source
      const workflow = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        include: {
          latestVersion: true,
          copiedFrom: {
            include: {
              latestVersion: true,
            },
          },
        },
      });

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      if (!workflow.copiedFromWorkflowId || !workflow.copiedFrom) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "This workflow is not a copy and has no source to sync from",
        });
      }

      // Check if source workflow is archived
      if (workflow.copiedFrom.archivedAt) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source workflow has been archived",
        });
      }

      const sourceWorkflow = workflow.copiedFrom;

      if (!sourceWorkflow?.latestVersion?.dsl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Source workflow or its latest version not found",
        });
      }

      // Check that the user has at least workflows:view permission on the source project
      const hasSourcePermission = await hasProjectPermission(
        ctx,
        sourceWorkflow.projectId,
        "workflows:view",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to view workflows in the source project",
        });
      }

      // Calculate next version based on THIS copy's latest version (not the source's version)
      const copyLatestVersion = workflow.latestVersion;
      const [versionMajor] = (copyLatestVersion?.version ?? "0.0").split(".");
      const nextVersion = `${parseInt(versionMajor ?? "0") + 1}`;

      // Deep clone DSL to ensure mutability
      const dsl = JSON.parse(
        JSON.stringify(sourceWorkflow.latestVersion.dsl),
      ) as Workflow;

      // Update the workflow_id to match the copied workflow
      dsl.workflow_id = workflow.id;

      // Create a new version with the source workflow's latest DSL
      const version = await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: {
            ...dsl,
            version: nextVersion,
          },
        },
        autoSaved: false,
        commitMessage: "Updated from source workflow",
      });

      return { workflow, version };
    }),

  pushToCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        copyIds: z.array(z.string()).optional(), // Optional: if provided, only push to selected copies
      }),
    )
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ ctx, input }) => {
      const { workflow, dsl, copiesToPush } = await resolveWorkflowPushSource({
        ctx,
        input,
      });

      const results = [];
      for (const copy of copiesToPush) {
        const pushed = await pushWorkflowVersionToCopy({ ctx, copy, dsl });
        // Skip copies where the user doesn't have permission.
        if (pushed) results.push(pushed);
      }

      if (results.length === 0) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message:
            "You do not have permission to update any of the copied workflows",
        });
      }

      return {
        pushedTo: results.length,
        totalCopies: workflow.copiedWorkflows.length,
        selectedCopies: copiesToPush.length,
        results,
      };
    }),

  /**
   * Gets entities related to a workflow for cascade archive warning.
   * Returns linked evaluators, agents, and monitors that would be affected.
   */
  getRelatedEntities: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
      }),
    )
    .use(checkProjectPermission("workflows:view"))
    .query(async ({ ctx, input }) => {
      // Find evaluators linked to this workflow
      const evaluators = await ctx.prisma.evaluator.findMany({
        where: {
          workflowId: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, name: true },
      });

      // Find agents linked to this workflow
      const agents = await ctx.prisma.agent.findMany({
        where: {
          workflowId: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, name: true },
      });

      // Find monitors linked to those evaluators
      const evaluatorIds = evaluators.map((e) => e.id);
      const monitors =
        evaluatorIds.length > 0
          ? await ctx.prisma.monitor.findMany({
              where: {
                evaluatorId: { in: evaluatorIds },
                projectId: input.projectId,
              },
              select: { id: true, name: true, evaluatorId: true },
            })
          : [];

      return { evaluators, agents, monitors };
    }),

  /**
   * Archives a workflow and all related entities in a transaction.
   * - Archives linked evaluators
   * - Archives linked agents
   * - Deletes monitors linked to evaluators (hard delete)
   */
  cascadeArchive: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        unarchive: z.boolean().optional(),
      }),
    )
    .use(checkProjectPermission("workflows:delete"))
    .mutation(async ({ ctx, input }) => {
      const now = input.unarchive ? null : new Date();

      return ctx.prisma.$transaction(async (tx) => {
        // 1. Find all evaluators linked to this workflow
        const evaluators = await tx.evaluator.findMany({
          where: {
            workflowId: input.workflowId,
            projectId: input.projectId,
            archivedAt: null,
          },
          select: { id: true },
        });
        const evaluatorIds = evaluators.map((e) => e.id);

        // 2. Delete monitors linked to those evaluators (hard delete)
        const deletedMonitors =
          evaluatorIds.length > 0
            ? await tx.monitor.deleteMany({
                where: {
                  evaluatorId: { in: evaluatorIds },
                  projectId: input.projectId,
                },
              })
            : { count: 0 };

        // 3. Archive evaluators linked to this workflow
        const archivedEvaluators = await tx.evaluator.updateMany({
          where: {
            workflowId: input.workflowId,
            projectId: input.projectId,
          },
          data: { archivedAt: now },
        });

        // 4. Archive agents linked to this workflow
        const archivedAgents = await tx.agent.updateMany({
          where: {
            workflowId: input.workflowId,
            projectId: input.projectId,
          },
          data: { archivedAt: now },
        });

        // 5. Archive the workflow itself
        const workflow = await tx.workflow.update({
          where: { id: input.workflowId, projectId: input.projectId },
          data: { archivedAt: now },
        });

        return {
          workflow,
          archivedEvaluatorsCount: archivedEvaluators.count,
          archivedAgentsCount: archivedAgents.count,
          deletedMonitorsCount: deletedMonitors.count,
        };
      });
    }),

  archive: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        unarchive: z.boolean().optional(),
      }),
    )
    .use(checkProjectPermission("workflows:delete"))
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
      }),
    )
    .use(checkProjectPermission("workflows:update"))
    .mutation(async ({ input }) => {
      const prevDsl_ = JSON.stringify(
        recursiveAlphabeticallySortedKeys(clearDsl(input.prevDsl)),
        null,
        2,
      );
      const newDsl_ = JSON.stringify(
        recursiveAlphabeticallySortedKeys(clearDsl(input.newDsl)),
        null,
        2,
      );
      if (prevDsl_ === newDsl_) {
        return "no changes";
      }

      const diff = createPatch(
        "workflow.json",
        prevDsl_,
        newDsl_,
        "Previous Version",
        "New Version",
      );

      // ModelNotConfiguredError passes through untouched (its own
      // toast surface); every other provider/SDK failure surfaces as
      // AiCallFailedError so the frontend can render the "double-check
      // your model configuration" hint toast instead of a raw 500.
      const commitFeature = featureByKey("workflows.commit_message");
      if (!commitFeature) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "workflows.commit_message feature is not registered",
        });
      }
      const commitMessage = await wrapAiCall(commitFeature, async () =>
        generateText({
          model: await getVercelAIModel({
            projectId: input.projectId,
            featureKey: "workflows.commit_message",
          }),
          providerOptions: {
            openai: {
              reasoningEffort: "low",
            } satisfies OpenAIResponsesProviderOptions,
          },
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
- Do not use the word "edge", the user doesn't know the internal structure of the DSL, understand what is going on instead.
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
        }),
      );

      // A commit message is one short string: a plain-text completion, not a
      // function-tool round-trip. Function tools combined with reasoning_effort
      // are rejected on /v1/chat/completions for the gpt-5 family (the provider
      // asks for /v1/responses), and these model calls go through the
      // OpenAI-compatible chat-completions proxy. Generating text directly
      // sidesteps that incompatibility and behaves the same across providers.

      // TODO: save call costs to user account

      return commitMessage.text.trim();
    }),
});

// Type guard for a dataset reference embedded in a workflow DSL node.
const isDatasetRef = (
  value: unknown,
): value is { id?: string; name?: string } => {
  if (!value || typeof value !== "object") return false;
  const obj = value as Record<string, unknown>;
  return (
    (obj.id === undefined || typeof obj.id === "string") &&
    (obj.name === undefined || typeof obj.name === "string")
  );
};

// Copies (or, via `datasetIdMap`, reuses a copy already made for this DSL)
// the dataset one reference points at, and repoints the reference in place
// at the new project-local dataset.
async function copyWorkflowDatasetRef({
  datasetRef,
  datasetIdMap,
  datasetService,
  sourceProjectId,
  targetProjectId,
}: {
  datasetRef: { id?: string; name?: string };
  datasetIdMap: Map<string, { id: string; name: string }>;
  datasetService: DatasetService;
  sourceProjectId: string;
  targetProjectId: string;
}): Promise<void> {
  if (!datasetRef.id) return;

  const cached = datasetIdMap.get(datasetRef.id);
  if (cached) {
    datasetRef.id = cached.id;
    datasetRef.name = cached.name;
    return;
  }

  // Create new dataset in target project using service
  const newDataset = await datasetService.copyDataset({
    sourceDatasetId: datasetRef.id,
    sourceProjectId,
    targetProjectId,
  });

  datasetIdMap.set(datasetRef.id, {
    id: newDataset.id,
    name: newDataset.name,
  });

  datasetRef.id = newDataset.id;
  datasetRef.name = newDataset.name;
}

// Repoints one node's dataset references (its Entry dataset, and any
// Demonstrations parameters) at their target-project copies.
async function copyWorkflowNodeDatasetRefs({
  node,
  datasetIdMap,
  datasetService,
  sourceProjectId,
  targetProjectId,
}: {
  node: Unpacked<Workflow["nodes"]>;
  datasetIdMap: Map<string, { id: string; name: string }>;
  datasetService: DatasetService;
  sourceProjectId: string;
  targetProjectId: string;
}): Promise<void> {
  const refOpts = {
    datasetIdMap,
    datasetService,
    sourceProjectId,
    targetProjectId,
  };

  // Check Entry node dataset
  if (node.data && "dataset" in node.data && node.data.dataset) {
    await copyWorkflowDatasetRef({ datasetRef: node.data.dataset, ...refOpts });
  }

  // Check parameters for Demonstrations
  if (node.data && "parameters" in node.data && node.data.parameters) {
    for (const param of node.data.parameters) {
      if (
        param.type === "dataset" &&
        param.value != null &&
        isDatasetRef(param.value)
      ) {
        await copyWorkflowDatasetRef({ datasetRef: param.value, ...refOpts });
      }
    }
  }
}

// Traverses the DSL's nodes for dataset references (Entry node datasets,
// Demonstrations parameters) and repoints each at its target-project copy.
// Mutates `dsl` in place.
async function copyWorkflowDatasetReferences({
  dsl,
  datasetService,
  sourceProjectId,
  targetProjectId,
}: {
  dsl: Workflow;
  datasetService: DatasetService;
  sourceProjectId: string;
  targetProjectId: string;
}): Promise<void> {
  const datasetIdMap = new Map<string, { id: string; name: string }>();

  for (const node of dsl.nodes) {
    await copyWorkflowNodeDatasetRefs({
      node,
      datasetIdMap,
      datasetService,
      sourceProjectId,
      targetProjectId,
    });
  }
}

/**
 * Copies a workflow with optional dataset copying.
 * This is a shared utility used by both workflow and experiment copy operations.
 */
export const copyWorkflowWithDatasets = async ({
  ctx,
  workflow,
  targetProjectId,
  sourceProjectId,
  copyDatasets,
  copiedFromWorkflowId,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  workflow: {
    id: string;
    name: string;
    icon: string | null;
    description: string | null;
    isEvaluator?: boolean;
    isComponent?: boolean;
    latestVersion: { dsl: JsonValue } | null;
  };
  targetProjectId: string;
  sourceProjectId: string;
  copyDatasets?: boolean;
  copiedFromWorkflowId?: string;
}): Promise<{ workflowId: string; dsl: Workflow }> => {
  if (!workflow.latestVersion?.dsl) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow version not found",
    });
  }

  // Deep clone DSL to ensure mutability
  const dsl = JSON.parse(
    JSON.stringify(workflow.latestVersion.dsl),
  ) as Workflow;

  if (copyDatasets) {
    await copyWorkflowDatasetReferences({
      dsl,
      datasetService: DatasetService.create(ctx.prisma),
      sourceProjectId,
      targetProjectId,
    });
  }

  // Create new workflow
  const newWorkflow = await ctx.prisma.workflow.create({
    data: {
      id: `workflow_${nanoid()}`,
      projectId: targetProjectId,
      name: workflow.name,
      icon: workflow.icon ?? "",
      description: workflow.description ?? "",
      isEvaluator: workflow.isEvaluator ?? false,
      isComponent: workflow.isComponent ?? false,
      copiedFromWorkflowId: copiedFromWorkflowId ?? workflow.id,
    },
  });

  // Update DSL with new workflow ID
  dsl.workflow_id = newWorkflow.id;
  dsl.version = "1";
  dsl.experiment_id = "";
  dsl.state = {};

  return { workflowId: newWorkflow.id, dsl };
};

type SaveWorkflowVersionInput = {
  projectId: string;
  workflowId: string;
  dsl: z.infer<typeof workflowJsonSchema>;
};

async function loadWorkflowForVersionSave({
  ctx,
  input,
}: {
  ctx: { prisma: PrismaClient };
  input: SaveWorkflowVersionInput;
}) {
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

  return { workflow, autoSavedVersion, latestVersion, nextVersion };
}

// Cast required: input.dsl.nodes is z.array(z.any()) from the Zod schema,
// while mergeLocalConfigsIntoDsl expects Node<Component>[]. The Zod schema
// uses z.any() for nodes because the DSL node types are too polymorphic
// for a single Zod discriminated union.
async function buildWorkflowVersionDsl({
  ctx,
  input,
}: {
  ctx: { prisma: PrismaClient };
  input: SaveWorkflowVersionInput;
}): Promise<object> {
  const dslWithMergedConfigs = {
    ...input.dsl,
    nodes: mergeLocalConfigsIntoDsl(input.dsl.nodes as any) as any,
    state: {},
  };
  await materializeNodeLlmConfigs({
    prisma: ctx.prisma,
    projectId: input.projectId,
    dsl: dslWithMergedConfigs,
  });
  return JSON.parse(JSON.stringify(dslWithMergedConfigs));
}

async function upsertWorkflowVersionRow({
  ctx,
  input,
  autoSaved,
  data,
  workflow,
  autoSavedVersion,
  latestVersion,
  nextVersion,
}: {
  ctx: { prisma: PrismaClient };
  input: SaveWorkflowVersionInput;
  autoSaved: boolean;
  data: {
    commitMessage: string;
    authorId: string;
    projectId: string;
    workflowId: string;
    autoSaved: boolean;
    dsl: object;
  };
  workflow: { currentVersionId: string | null };
  autoSavedVersion: WorkflowVersion | null;
  latestVersion: WorkflowVersion | null;
  nextVersion: string;
}): Promise<WorkflowVersion> {
  if (autoSavedVersion) {
    return ctx.prisma.workflowVersion.update({
      where: { id: autoSavedVersion.id, projectId: input.projectId },
      data: {
        ...data,
        ...(workflow.currentVersionId !== autoSavedVersion.id && {
          parentId: workflow.currentVersionId,
        }),
      },
    });
  }
  return ctx.prisma.workflowVersion.create({
    data: {
      id: nanoid(),
      parentId: latestVersion?.id,
      version: autoSaved ? nextVersion : input.dsl.version,
      ...data,
    },
  });
}

export const saveOrCommitWorkflowVersion = async ({
  ctx,
  input,
  autoSaved,
  commitMessage,
  setAsLatestVersion = true,
}: {
  ctx: { prisma: PrismaClient; session: Session };
  input: SaveWorkflowVersionInput;
  autoSaved: boolean;
  commitMessage: string;
  setAsLatestVersion?: boolean;
}): Promise<WorkflowVersion> => {
  const { workflow, autoSavedVersion, latestVersion, nextVersion } =
    await loadWorkflowForVersionSave({ ctx, input });

  const dslWithoutStates = await buildWorkflowVersionDsl({ ctx, input });

  const data = {
    commitMessage,
    authorId: ctx.session.user.id,
    projectId: input.projectId,
    workflowId: input.workflowId,
    autoSaved,
    dsl: dslWithoutStates,
  };

  const updatedVersion = await upsertWorkflowVersionRow({
    ctx,
    input,
    autoSaved,
    data,
    workflow,
    autoSavedVersion,
    latestVersion,
    nextVersion,
  });

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

  // Fire-and-forget: auto-compute handles its own errors internally, but the
  // outer .catch guards against synchronous throws (e.g. invalid args) that
  // would otherwise surface as an unhandled promise rejection.
  autoComputeAgentMappings({
    prisma: ctx.prisma,
    workflowId: input.workflowId,
    projectId: input.projectId,
    dsl: input.dsl,
  }).catch((err) => {
    autoComputeLogger.error(
      { err, workflowId: input.workflowId, projectId: input.projectId },
      "autoComputeAgentMappings dispatch failed",
    );
  });

  return updatedVersion;
};
