import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { DatasetService } from "@langwatch/dataset-contract";
import { pMapLimited } from "@langwatch/eventing";
import { createLogger } from "@langwatch/observability";
import {
  workflowApiEngineModeInputSchema,
  workflowApiGetByIdInputSchema,
  workflowApiGetVersionsInputSchema,
} from "@langwatch/platform-api-contract";
import type { JsonValue } from "@prisma/client/runtime/client";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { createPatch } from "diff";
import { nanoid } from "nanoid";
import { z } from "zod";
import { fireWorkflowCreatedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import type { PrismaClient } from "~/generated/prisma/client";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import type { Session } from "~/server/auth";
import {
  WorkflowNotFoundError,
  WorkflowVersionNotFoundError,
  type WorkflowVersionHistoryEntry,
  type WorkflowService,
  type WorkflowVersion,
  type WorkflowWithVersion,
} from "@langwatch/workflow-contract";
import { captureException } from "~/utils/posthogErrorCapture";
import {
  parseStudioWorkflow,
  type StudioWorkflow,
  studioWorkflowSchema,
} from "@langwatch/workflow-contract";
import { migrateDSLVersion } from "@langwatch/workflow-contract";
import {
  clearDsl,
  mergeLocalConfigsIntoDsl,
  recursiveAlphabeticallySortedKeys,
} from "@langwatch/workflow-contract";
import { wrapAiCall } from "../../modelProviders/aiCallFailedError";
import { featureByKey, type ModelProviderService } from "@langwatch/model-provider-contract";
import { getVercelAIModel } from "../../modelProviders/utils";
import { autoComputeAgentMappings } from "../../workflows/auto-compute-agent-mappings";
import { materializeNodeLlmConfigs } from "../../workflows/materializeNodeLlmConfigs";
import { createTRPCRouter, protectedProcedure } from "../trpc";

const autoComputeLogger = createLogger("langwatch:workflows:auto-compute");

export const workflowRouter = createTRPCRouter({
  // Returns which NLP engine is active for the current project. Used by the
  // Studio UI reads this to hide the (now-defunct) Optimize button.
  // Optimization was DSPy-only and the Go engine never included DSPy, so
  // with nlpgo the only engine the button is always hidden. Kept as a
  // procedure (rather than a UI constant) so the studio handlers and the
  // UI agree on one source of truth.
  engineMode: protectedProcedure
    .input(workflowApiEngineModeInputSchema)
    .permission("workflows:view")
    .query(() => {
      return {
        engineMode: "go" as const,
        optimizeEnabled: false as const,
      };
    }),

  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dsl: studioWorkflowSchema,
        commitMessage: z.string(),
        publish: z.boolean().optional(), // Auto-publish the first version (useful for evaluator workflows)
      }),
    )
    .permission("workflows:create")
    .mutation(async ({ ctx, input }) => {
      const workflowId = `workflow_${nanoid()}`;
      const dsl = await prepareWorkflowDsl({
        projectId: input.projectId,
        modelProviders: ctx.app.modelProviders,
        dsl: { ...input.dsl, workflow_id: workflowId },
      });
      const { workflow, version } = await ctx.app.workflows.create({
        id: workflowId,
        projectId: input.projectId,
        dsl,
        commitMessage: input.commitMessage,
        publish: input.publish,
        authorId: ctx.session.user.id,
      });

      void ctx.app.workflows
        .list({ projectId: input.projectId })
        .then((workflows) => {
          fireWorkflowCreatedNurturing({
            userId: ctx.session.user.id,
            workflowCount: workflows.length,
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
    .permission("workflows:create")
    .mutation(async ({ ctx, input }) => {
      // Check that the user has at least workflows:create permission on the source project
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        input.sourceProjectId,
        "workflows:create",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You do not have permission to create workflows in the source project",
        });
      }

      const { workflow, version } = await ctx.app.workflows.copy({
        sourceWorkflowId: input.workflowId,
        targetProjectId: input.projectId,
        sourceProjectId: input.sourceProjectId,
        copyDatasets: input.copyDatasets,
        copiedFromWorkflowId: input.workflowId,
        authorId: ctx.session.user.id,
      });
      return { workflow, version };
    }),
  getAll: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .permission("workflows:view")
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

      const relatedProjectIds = [
        ...new Set(
          workflows.flatMap((workflow) => [
            ...(workflow.copiedFrom ? [workflow.copiedFrom.projectId] : []),
            ...workflow.copiedWorkflows.map((copy) => copy.projectId),
          ]),
        ),
      ];
      // Each related project needs its own RBAC check; cap concurrency so a
      // workflow with many copies can't exhaust the DB connection pool.
      const visibleProjects = new Map<string, boolean>();
      await pMapLimited({
        items: relatedProjectIds,
        concurrency: 5,
        fn: async (projectId) => {
          const isVisible =
            projectId === input.projectId ||
            (await probeProjectPermission(ctx, projectId, "workflows:view"));
          visibleProjects.set(projectId, isVisible);
        },
      });

      return workflows.map(({ copiedWorkflows, ...workflow }) => {
        const canSeeSource =
          workflow.copiedFrom && visibleProjects.get(workflow.copiedFrom.projectId);
        return {
          ...workflow,
          copiedFromWorkflowId: canSeeSource ? workflow.copiedFromWorkflowId : null,
          copiedFrom: canSeeSource ? workflow.copiedFrom : null,
          _count: {
            copiedWorkflows: copiedWorkflows.filter((copy) => visibleProjects.get(copy.projectId))
              .length,
          },
        };
      });
    }),

  getCopies: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
      }),
    )
    .permission("workflows:view")
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
      const hasPermission = await probeProjectPermission(ctx, workflow.projectId, "workflows:view");

      if (!hasPermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You do not have permission to view this workflow",
        });
      }

      // Query copies through the relation to avoid projectId requirement in findMany
      const workflowWithCopies = await ctx.prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
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

      const copies = workflowWithCopies.copiedWorkflows;

      // Filter copies based on user's workflows:update permission
      const copiesWithPermissions = await Promise.all(
        copies.map(async (copy) => {
          const hasPermission = await probeProjectPermission(
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
        }),
      );

      // Only return copies where user has permission
      const filteredCopies = copiesWithPermissions.filter((copy) => copy.hasPermission);

      // If no copies found but copies exist, it means user doesn't have permission on any of them
      if (filteredCopies.length === 0 && copies.length > 0) {
        // Return empty array - the UI will show "No copies found"
        // This is expected if user doesn't have workflows:update permission on copy projects
        return [];
      }

      return filteredCopies;
    }),

  getById: protectedProcedure
    .input(workflowApiGetByIdInputSchema)
    .permission("workflows:view")
    .query(async ({ ctx, input }): Promise<WorkflowWithVersion> => {
      let workflow;
      try {
        workflow = await ctx.app.workflows.getById({
          id: input.workflowId,
          projectId: input.projectId,
          includeVersion: true,
        });
      } catch (error) {
        if (error instanceof WorkflowNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }

      // Handled, like the same failure already is in `runWorkflow.ts`. As a
      // bare `TRPCError` this crossed the boundary as prose, so the client had
      // no code to key copy off: the studio's error card fell back to the
      // caller's generic headline, printed the humanised slug underneath it,
      // and — because an unrecognised code is not something the reader can be
      // told how to fix — offered them an error id for a workflow that had
      // simply been deleted.
      if (workflow.currentVersion) {
        workflow.currentVersion.dsl = migrateDSLVersion(workflow.currentVersion.dsl);
      }

      return workflow;
    }),

  getVersions: protectedProcedure
    .input(workflowApiGetVersionsInputSchema)
    .permission("workflows:view")
    .query(async ({ ctx, input }): Promise<WorkflowVersionHistoryEntry[]> => {
      try {
        return await ctx.app.workflows.getVersionHistory({
          workflowId: input.workflowId,
          projectId: input.projectId,
          mode:
            input.returnDSL === true
              ? "allDsl"
              : input.returnDSL === "previousVersion"
                ? "previousDsl"
                : "metadata",
        });
      } catch (error) {
        if (!(error instanceof WorkflowNotFoundError)) throw error;
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }
    }),

  restoreVersion: protectedProcedure
    .input(z.object({ projectId: z.string(), versionId: z.string() }))
    .permission("workflows:update")
    .mutation(async ({ ctx, input }) => {
      try {
        return await ctx.app.workflows.restoreVersion({
          versionId: input.versionId,
          projectId: input.projectId,
        });
      } catch (error) {
        if (
          !(error instanceof WorkflowVersionNotFoundError) &&
          !(error instanceof WorkflowNotFoundError)
        ) {
          throw error;
        }
        throw new TRPCError({
          code: "NOT_FOUND",
          message:
            error instanceof WorkflowVersionNotFoundError
              ? "Workflow version not found"
              : "Workflow not found",
        });
      }
    }),

  autosave: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
        dsl: studioWorkflowSchema,
        setAsLatestVersion: z.boolean(),
      }),
    )
    .permission("workflows:update")
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
        dsl: studioWorkflowSchema,
      }),
    )
    .permission("workflows:update")
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
    .permission("workflows:update")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.workflows.publish({
        id: input.workflowId,
        projectId: input.projectId,
        versionId: input.versionId,
        actorId: ctx.session.user.id,
      });
    }),

  unpublish: protectedProcedure
    .input(z.object({ projectId: z.string(), workflowId: z.string() }))
    .permission("workflows:update")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.workflows.unpublish({
        id: input.workflowId,
        projectId: input.projectId,
      });
    }),

  syncFromSource: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        workflowId: z.string(),
      }),
    )
    .permission("workflows:update")
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
      const hasSourcePermission = await probeProjectPermission(
        ctx,
        sourceWorkflow.projectId,
        "workflows:view",
      );

      if (!hasSourcePermission) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You do not have permission to view workflows in the source project",
        });
      }

      // Calculate next version based on THIS copy's latest version (not the source's version)
      const copyLatestVersion = workflow.latestVersion;
      const [versionMajor] = (copyLatestVersion?.version ?? "0.0").split(".");
      const nextVersion = `${parseInt(versionMajor ?? "0") + 1}`;

      // Deep clone DSL to ensure mutability
      const dsl = parseStudioWorkflow(JSON.parse(JSON.stringify(sourceWorkflow.latestVersion.dsl)));

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
    .permission("workflows:update")
    .mutation(async ({ ctx, input }) => {
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
        ? workflow.copiedWorkflows.filter((copy) => input.copyIds!.includes(copy.id))
        : workflow.copiedWorkflows;

      if (copiesToPush.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No valid copies selected to push to",
        });
      }

      // Deep clone DSL to ensure mutability
      const dsl = parseStudioWorkflow(JSON.parse(JSON.stringify(workflow.latestVersion.dsl)));

      const results = [];

      // Push to each copy
      for (const copy of copiesToPush) {
        // Check that the user has workflows:update permission on the copy's project
        const hasCopyPermission = await probeProjectPermission(
          ctx,
          copy.projectId,
          "workflows:update",
        );

        if (!hasCopyPermission) {
          // Skip copies where user doesn't have permission
          continue;
        }

        // Fetch the copy's latest version to get its current version number
        // Each copy maintains its own version history independently
        const copyWithLatestVersion = await ctx.prisma.workflow.findUnique({
          where: {
            id: copy.id,
            projectId: copy.projectId,
          },
          include: {
            latestVersion: true,
          },
        });

        if (!copyWithLatestVersion) {
          continue;
        }

        // Calculate next version based on THIS copy's latest version (not the source's version)
        const copyLatestVersion = copyWithLatestVersion.latestVersion;
        const [versionMajor] = (copyLatestVersion?.version ?? "0.0").split(".");
        const nextVersion = `${parseInt(versionMajor ?? "0") + 1}`;

        // Update the workflow_id to match the copy
        const copyDsl = parseStudioWorkflow(JSON.parse(JSON.stringify(dsl)));
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

        results.push({ copyId: copy.id, copyName: copy.name, version });
      }

      if (results.length === 0) {
        throw new TRPCError({
          code: "UNAUTHORIZED",
          message: "You do not have permission to update any of the copied workflows",
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
    .permission("workflows:view")
    .query(async ({ ctx, input }) => {
      // Find evaluators linked to this workflow
      const evaluators = (
        await ctx.app.evaluators.getAll({
          projectId: input.projectId,
        })
      )
        .filter((evaluator) => evaluator.workflowId === input.workflowId)
        .map(({ id, name }) => ({ id, name }));

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
    .permission("workflows:delete")
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
    .permission("workflows:delete")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.workflows.archive({
        id: input.workflowId,
        projectId: input.projectId,
        unarchive: input.unarchive,
      });
    }),

  generateCommitMessage: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        prevDsl: studioWorkflowSchema,
        newDsl: studioWorkflowSchema,
      }),
    )
    .permission("workflows:update")
    .mutation(async ({ input, ctx }) => {
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
            modelProviders: ctx.app.modelProviders,
            managedProviders: ctx.app.managedProviders,
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
  ctx: { prisma: PrismaClient; session: Session; app: { dataset: DatasetService } };
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
}): Promise<{ workflowId: string; dsl: StudioWorkflow }> => {
  if (!workflow.latestVersion?.dsl) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Workflow version not found",
    });
  }

  // Deep clone DSL to ensure mutability
  const dsl = parseStudioWorkflow(JSON.parse(JSON.stringify(workflow.latestVersion.dsl)));
  const datasetIdMap = new Map<string, { id: string; name: string }>();

  if (copyDatasets) {
    // Type guard for dataset reference
    const isDatasetRef = (value: unknown): value is { id?: string; name?: string } => {
      if (!value || typeof value !== "object") return false;
      const obj = value as Record<string, unknown>;
      return (
        (obj.id === undefined || typeof obj.id === "string") &&
        (obj.name === undefined || typeof obj.name === "string")
      );
    };

    // Helper to process dataset reference
    const processDatasetRef = async (datasetRef: { id?: string; name?: string }) => {
      if (!datasetRef.id) return;

      if (datasetIdMap.has(datasetRef.id)) {
        const newDataset = datasetIdMap.get(datasetRef.id)!;
        datasetRef.id = newDataset.id;
        datasetRef.name = newDataset.name;
        return;
      }

      // Create new dataset in target project using service
      const newDataset = await ctx.app.dataset.copyDataset({
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
    };

    // Traverse nodes to find datasets
    for (const node of dsl.nodes) {
      // Check Entry node dataset
      if (node.data && "dataset" in node.data && node.data.dataset) {
        await processDatasetRef(node.data.dataset);
      }

      // Check parameters for Demonstrations
      if (node.data && "parameters" in node.data && node.data.parameters) {
        for (const param of node.data.parameters) {
          if (param.type === "dataset" && param.value != null && isDatasetRef(param.value)) {
            await processDatasetRef(param.value);
          }
        }
      }
    }
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

export const saveOrCommitWorkflowVersion = async ({
  ctx,
  input,
  autoSaved,
  commitMessage,
  setAsLatestVersion = true,
}: {
  ctx: {
    prisma: PrismaClient;
    session: Session;
    app: { workflows: WorkflowService; modelProviders: ModelProviderService };
  };
  input: {
    projectId: string;
    workflowId: string;
    dsl: z.infer<typeof studioWorkflowSchema>;
  };
  autoSaved: boolean;
  commitMessage: string;
  setAsLatestVersion?: boolean;
}): Promise<WorkflowVersion> => {
  const dslWithMergedConfigs = await prepareWorkflowDsl({
    projectId: input.projectId,
    modelProviders: ctx.app.modelProviders,
    dsl: input.dsl,
  });
  const updatedVersion = await ctx.app.workflows.saveVersion({
    projectId: input.projectId,
    workflowId: input.workflowId,
    dsl: JSON.parse(JSON.stringify(dslWithMergedConfigs)),
    autoSaved,
    commitMessage,
    authorId: ctx.session.user.id,
    setAsLatestVersion,
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

/** Application-owned preparation for legacy Studio node configuration. */
async function prepareWorkflowDsl({
  projectId,
  dsl,
  modelProviders,
}: {
  projectId: string;
  dsl: z.infer<typeof studioWorkflowSchema>;
  modelProviders: ModelProviderService;
}): Promise<z.infer<typeof studioWorkflowSchema>> {
  // Cast required: input.dsl.nodes is z.array(z.any()) from the Zod schema,
  // while mergeLocalConfigsIntoDsl expects Node<Component>[]. The Zod schema
  // uses z.any() for nodes because the DSL node types are too polymorphic
  // for a single Zod discriminated union.
  const dslWithMergedConfigs = {
    ...dsl,
    nodes: mergeLocalConfigsIntoDsl(dsl.nodes as any) as any,
    state: {},
  };
  await materializeNodeLlmConfigs({
    projectId,
    dsl: dslWithMergedConfigs,
    modelProviders,
  });
  return dslWithMergedConfigs;
}
