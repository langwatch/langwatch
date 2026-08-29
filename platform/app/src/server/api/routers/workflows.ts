/**
 * Process wiring for the `workflow.*` and `optimization.*` tRPC surfaces.
 *
 * Both transports are package-owned — `WorkflowTrpcApi` and
 * `WorkflowOptimizationTrpcApi` in `@langwatch/workflow-server`, mounted
 * through `@langwatch/platform-api/app-trpc`. What is left here is the
 * composition this application still owns: its tRPC root, its authenticated
 * procedure, its authorization middlewares, the workflow-adjacent rows the
 * workflow service does not read yet, the model call behind commit-message
 * generation, and the nurturing signal a new workflow fires.
 *
 * `copyWorkflowWithDatasets` and `saveOrCommitWorkflowVersion` stay exported
 * here: the experiments router and the evaluator workflow replication call
 * them directly, and both take this application's request context.
 */
import type { OpenAIResponsesProviderOptions } from "@ai-sdk/openai";
import type { DatasetApp } from "@langwatch/dataset-server";
import { pMapLimited } from "@langwatch/eventing";
import { featureByKey, type ModelProviderService } from "@langwatch/model-provider-contract";
import type { ModelProviderApp } from "@langwatch/model-provider-server";
import { createLogger } from "@langwatch/observability";
import type { AppTrpcPolicyMiddlewares } from "@langwatch/api/trpc";
import {
  createWorkflowOptimizationTrpcRouter,
  createWorkflowTrpcRouter,
  declaredCheckFrom,
} from "@langwatch/platform-api/app-trpc";
import {
  mergeLocalConfigsIntoDsl,
  parseStudioWorkflow,
  studioWorkflowSchema,
  type StudioWorkflow,
  type WorkflowVersion,
} from "@langwatch/workflow-contract";
import type { WorkflowApp } from "@langwatch/workflow-server";
import type { JsonValue } from "@prisma/client/runtime/client";
import { TRPCError } from "@trpc/server";
import { generateText } from "ai";
import { createPatch } from "diff";
import { nanoid } from "nanoid";
import type { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import type { Session } from "~/server/auth";
import { fireWorkflowCreatedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import {
  checkDeclaredPermission,
  checkDeclaredPermissionAny,
  declaredNoPermission,
  declaredServiceAuthorization,
} from "~/server/app-layer/authz/trpc-middleware";
import { probeProjectPermission } from "~/server/app-layer/permissions/imperative";
import { captureException, toError } from "~/utils/posthogErrorCapture";
import { wrapAiCall } from "../../modelProviders/aiCallFailedError";
import { getVercelAIModel } from "../../modelProviders/utils";
import { autoComputeAgentMappings } from "../../workflows/auto-compute-agent-mappings";
import { materializeNodeLlmConfigs } from "../../workflows/materializeNodeLlmConfigs";
import type { TRPCContext } from "../trpc.context";
import { appTrpcRoot } from "../trpc.root";
import {
  auditLogMutations,
  authProtectedProcedure,
  enforcePermissionCheck,
  handledErrorMiddleware,
  loggerMiddleware,
  tracerMiddleware,
} from "../trpc.runtime-policy";
import { scopeLineageGuard } from "../trpc.scope-lineage-middleware";

const autoComputeLogger = createLogger("langwatch:workflows:auto-compute");

/** This process's concrete policy chain, in the order the mounts apply it. */
const middlewares: AppTrpcPolicyMiddlewares = {
  tracer: tracerMiddleware,
  logger: loggerMiddleware,
  handledError: handledErrorMiddleware,
  scopeLineageGuard,
  declaredCheck: declaredCheckFrom({
    permission: checkDeclaredPermission,
    permissionAny: checkDeclaredPermissionAny,
    noPermission: declaredNoPermission,
    serviceAuthorized: declaredServiceAuthorization,
  }),
  enforceCheck: enforcePermissionCheck,
  auditMutations: auditLogMutations,
};

/** The feature transports are typed against their own context; this is ours. */
const appContext = (ctx: unknown) => ctx as TRPCContext;

/** The copy-lineage selection `workflow.getAll` redacts against permissions. */
const copyLineageSelect = {
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
} as const;

/** Where one copy lives, for the "org / team / project" path shown beside it. */
const copyPathSelect = {
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
} as const;

export const workflowRouter = createWorkflowTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    hasProjectPermission: (ctx, input) =>
      probeProjectPermission(appContext(ctx), input.projectId, input.permission),

    // Each related project needs its own RBAC check; cap concurrency so a
    // workflow with many copies can't exhaust the DB connection pool.
    hasProjectPermissions: async (ctx, input) => {
      const permitted = new Map<string, boolean>();
      await pMapLimited({
        items: [...input.projectIds],
        concurrency: 5,
        fn: async (projectId) => {
          permitted.set(
            projectId,
            await probeProjectPermission(appContext(ctx), projectId, input.permission),
          );
        },
      });
      return permitted;
    },

    prepareDsl: (ctx, input) =>
      prepareWorkflowDsl({
        projectId: input.projectId,
        modelProviders: appContext(ctx).app.modelProviders.providerService,
        dsl: input.dsl,
      }),

    saveWorkflowVersion: (ctx, input) =>
      saveOrCommitWorkflowVersion({
        ctx: appContext(ctx) as unknown as WorkflowSaveContext,
        input: {
          projectId: input.projectId,
          workflowId: input.workflowId,
          dsl: input.dsl,
        },
        autoSaved: input.autoSaved,
        commitMessage: input.commitMessage,
        ...(input.setAsLatestVersion === undefined
          ? {}
          : { setAsLatestVersion: input.setAsLatestVersion }),
      }),

    listWorkflowsWithCopyLineage: async (ctx, input) =>
      await appContext(ctx).prisma.workflow.findMany({
        where: { projectId: input.projectId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: copyLineageSelect,
      }),

    tryFindWorkflow: async (ctx, input) =>
      // Prisma requires projectId in the where clause for a project-level model.
      await appContext(ctx).prisma.workflow.findFirst({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
      }),

    // Copies are queried through the relation so the findMany's projectId
    // requirement does not force a single project on a cross-project read.
    tryFindCopiesWithPath: async (ctx, input) => {
      const workflowWithCopies = await appContext(ctx).prisma.workflow.findUnique({
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
            select: copyPathSelect,
          },
        },
      });

      return workflowWithCopies ? workflowWithCopies.copiedWorkflows : null;
    },

    tryFindWorkflowWithSource: async (ctx, input) =>
      await appContext(ctx).prisma.workflow.findUnique({
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
      }),

    tryFindWorkflowWithCopies: async (ctx, input) =>
      await appContext(ctx).prisma.workflow.findUnique({
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
      }),

    tryFindLatestVersionNumber: async (ctx, input) => {
      const workflow = await appContext(ctx).prisma.workflow.findUnique({
        where: {
          id: input.workflowId,
          projectId: input.projectId,
        },
        include: {
          latestVersion: true,
        },
      });

      return workflow ? { version: workflow.latestVersion?.version ?? null } : null;
    },

    listAgentsForWorkflow: async (ctx, input) =>
      await appContext(ctx).prisma.agent.findMany({
        where: {
          workflowId: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, name: true },
      }),

    listMonitorsForEvaluators: async (ctx, input) =>
      await appContext(ctx).prisma.monitor.findMany({
        where: {
          evaluatorId: { in: [...input.evaluatorIds] },
          projectId: input.projectId,
        },
        select: { id: true, name: true, evaluatorId: true },
      }),

    cascadeArchiveWorkflow: async (ctx, input) => {
      const now = input.unarchive ? null : new Date();

      return appContext(ctx).prisma.$transaction(async (tx) => {
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
    },

    generateCommitMessage: async (ctx, input) => {
      const diff = createPatch(
        "workflow.json",
        input.previousDsl,
        input.nextDsl,
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
            modelProviders: appContext(ctx).app.modelProviders.providerService,
            managedProviders: appContext(ctx).app.managedProviders,
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
${input.previousDsl}
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
    },

    workflowCreated: (_ctx, input) => fireWorkflowCreatedNurturing(input),
    captureException: (error) => captureException(toError(error)),
  },
});

/** Process transport mount for `optimization.*`; feature behaviour is package-owned. */
export const optimizationRouter = createWorkflowOptimizationTrpcRouter({
  root: appTrpcRoot,
  protectedProcedure: authProtectedProcedure,
  middlewares,
  ports: {
    // The studio's chat panel runs the workflow over the same public run
    // endpoint an external caller uses, authenticated as the project.
    runPublishedWorkflow: async (ctx, input) => {
      const project = await appContext(ctx).prisma.project.findFirst({
        where: { id: input.projectId },
      });

      const apiKey = project?.apiKey;

      const response = await fetch(
        `${process.env.BASE_HOST}/api/workflows/${input.workflowId}/run`,
        {
          method: "POST",
          body: JSON.stringify(input.body),
          headers: {
            "Content-Type": "application/json",
            ...(apiKey && { "x-auth-token": apiKey }),
          },
        },
      );

      return await response.json();
    },
    tryGetWorkflow: async (ctx, input) =>
      await appContext(ctx).prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId },
      }),
    tryGetWorkflowVersion: async (ctx, input) =>
      await appContext(ctx).prisma.workflowVersion.findFirst({
        where: { id: input.versionId, projectId: input.projectId },
      }),
    setWorkflowFlags: async (ctx, input) => {
      await appContext(ctx).prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
          ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
        },
      });
    },
    listPublishedComponents: async (ctx, input) => {
      const workflows = await appContext(ctx).prisma.workflow.findMany({
        where: {
          projectId: input.projectId,
          OR: [{ isComponent: true }, { isEvaluator: true }],
        },
        include: { versions: true },
      });

      // Each component carries only the version it publishes; the studio picks
      // a component by its published shape, never by a draft.
      workflows.forEach((workflow) => {
        workflow.versions = workflow.versions.filter(
          (version) => version.id === workflow.publishedId,
        );
      });

      return workflows;
    },
  },
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
  ctx: { prisma: PrismaClient; session: Session; app: { dataset: DatasetApp } };
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

/** What `saveOrCommitWorkflowVersion` needs from the request context. */
type WorkflowSaveContext = {
  prisma: PrismaClient;
  session: Session;
  app: { workflows: WorkflowApp; modelProviders: ModelProviderApp };
};

export const saveOrCommitWorkflowVersion = async ({
  ctx,
  input,
  autoSaved,
  commitMessage,
  setAsLatestVersion = true,
}: {
  ctx: WorkflowSaveContext;
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
    modelProviders: ctx.app.modelProviders.providerService,
    dsl: input.dsl,
  });
  const updatedVersion = await ctx.app.workflows.workflowService.saveVersion({
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
