import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { Prisma, PrismaClient, WorkflowVersion } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { generateText, tool } from "ai";
import { createPatch } from "diff";
import { nanoid } from "nanoid";
import type { Session } from "next-auth";
import { z } from "zod";
import {
  type Workflow,
  workflowJsonSchema,
} from "../../../optimization_studio/types/dsl";
import { migrateDSLVersion } from "../../../optimization_studio/types/migrate";
import {
  clearDsl,
  recursiveAlphabeticallySortedKeys,
} from "../../../optimization_studio/utils/dslUtils";
import type { Unpacked } from "../../../utils/types";
import { DatasetService } from "../../datasets/dataset.service";
import { getVercelAIModel } from "../../modelProviders/utils";
import { checkProjectPermission, hasProjectPermission } from "../rbac";
import { createTRPCRouter, protectedProcedure } from "../trpc";

export const workflowRouter = createTRPCRouter({
  create: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        dsl: workflowJsonSchema,
        commitMessage: z.string(),
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

      if (!workflow || !workflow.latestVersion?.dsl) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
      }

      // Deep clone DSL to ensure mutability
      const dsl = JSON.parse(
        JSON.stringify(workflow.latestVersion.dsl),
      ) as Workflow;
      const datasetIdMap = new Map<string, { id: string; name: string }>();

      if (input.copyDatasets) {
        const datasetService = DatasetService.create(ctx.prisma);

        // Type guard for dataset reference
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

        // Helper to process dataset reference
        const processDatasetRef = async (datasetRef: {
          id?: string;
          name?: string;
        }) => {
          if (!datasetRef.id) return;

          if (datasetIdMap.has(datasetRef.id)) {
            const newDataset = datasetIdMap.get(datasetRef.id)!;
            datasetRef.id = newDataset.id;
            datasetRef.name = newDataset.name;
            return;
          }

          // Create new dataset in target project using service
          const newDataset = await datasetService.copyDataset({
            sourceDatasetId: datasetRef.id,
            sourceProjectId: input.sourceProjectId,
            targetProjectId: input.projectId,
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
              if (param.type === "dataset" && isDatasetRef(param.value)) {
                await processDatasetRef(param.value);
              }
            }
          }
        }
      }

      const newWorkflow = await ctx.prisma.workflow.create({
        data: {
          id: `workflow_${nanoid()}`,
          projectId: input.projectId,
          name: workflow.name,
          icon: workflow.icon,
          description: workflow.description,
          copiedFromWorkflowId: input.workflowId,
        },
      });

      const version = await saveOrCommitWorkflowVersion({
        ctx,
        input: {
          projectId: input.projectId,
          workflowId: newWorkflow.id,
          dsl: {
            ...dsl,
            workflow_id: newWorkflow.id,
            version: "1",
          },
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
      return ctx.prisma.workflow.findMany({
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
          _count: {
            select: {
              copiedWorkflows: {
                where: {
                  archivedAt: null,
                },
              },
            },
          },
        },
      });
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
        }),
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

      if (!workflow) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Workflow not found",
        });
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
    .use(checkProjectPermission("workflows:update"))
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

      if (!sourceWorkflow || !sourceWorkflow.latestVersion?.dsl) {
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

      const results = [];

      // Push to each copy
      for (const copy of copiesToPush) {
        // Check that the user has workflows:update permission on the copy's project
        const hasCopyPermission = await hasProjectPermission(
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

        results.push({ copyId: copy.id, copyName: copy.name, version });
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

      const commitMessage = await generateText({
        model: await getVercelAIModel(input.projectId),
        providerOptions: {
          openai: {
            reasoningEffort: "minimal",
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
        tools: {
          commitMessage: tool({
            inputSchema: z.object({
              message: z.string(),
            }),
            outputSchema: z.string(),
            execute: async ({ message }) => {
              return message;
            },
          }),
        },
        toolChoice: {
          type: "tool",
          toolName: "commitMessage",
        },
      });

      const result = commitMessage.toolResults?.find(
        (t) => t.toolName === "commitMessage",
      )?.output;

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
    }),
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
