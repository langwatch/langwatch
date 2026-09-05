/**
 * The studio's own vertical, composed as its own feature. Two namespaces, one feature.
 * `workflow.*` is the lifecycle — versions, copies, publication, the archive cascade.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { pMapLimited } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { getProjectModelProviders } from "@langwatch/model-provider-server";
import { createLogger } from "@langwatch/observability";
import {
  ContractWorkflowDslMigrationAdapter,
  HttpWorkflowNlpRuntimeAdapter,
  ModelProviderWorkflowStudioDslAdapter,
  PostgresWorkflowAdapter,
  PrismaWorkflowAgentMappingAdapter,
  PrismaWorkflowProjectEnvironmentAdapter,
  PrismaWorkflowRowAdapter,
  UnavailableWorkflowEnvironmentDecryptor,
  UnconfiguredWorkflowNlpRuntimeAdapter,
  WorkflowApp,
  WorkflowLlmParametersPort,
  type WorkflowEnvironmentDecryptor,
  type WorkflowLlmParameterResolution,
  type WorkflowNlpRuntimePort,
  type WorkflowTrpcPorts,
} from "@langwatch/workflow-server";
import type { LLMConfig, WorkflowService } from "@langwatch/workflow-contract";

import type { ApiTrpcFeatureMount } from "../../api.application";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context";
import type { ApiTrpcInfrastructure } from "../../app-trpc/app-trpc.infrastructure";
import {
  createWorkflowOptimizationTrpcRouter,
  createWorkflowTrpcRouter,
} from "./workflow-trpc.mount";

/** Where one copy lives, for the "org / team / project" path shown beside it. */
const workflowCopyPathSelect = {
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
          organization: { select: { id: true, name: true } },
        },
      },
    },
  },
} as const;

/** The copy-lineage selection `workflow.getAll` redacts against permissions. */
const workflowCopyLineageSelect = {
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
  copiedFrom: { select: workflowCopyPathSelect },
  copiedWorkflows: { where: { archivedAt: null }, select: { projectId: true } },
} as const;

/**
 * The workflow service and the engine it dispatches on, composed before every
 * feature that reads either.
 */
export type ApiWorkflowRuntime = Readonly<{
  /** The ONE workflow service on this process. */
  workflows: WorkflowService;
  /** Where a studio graph and a code evaluator both execute. */
  nlpRuntime: WorkflowNlpRuntimePort;
}>;

/** Composes the workflow service and its engine address. */
export function composeWorkflowRuntime(options: {
  infrastructure: ApiTrpcInfrastructure;
  peers: Readonly<{
    /** The dataset service a studio node reads its rows through. */
    datasets: DatasetService;
    /** The gateway a node's model is resolved through. */
    modelProviders: ModelProviderService;
  }>;
  /** Where the NLP engine answers; absent means nothing executes. */
  nlpServiceUrl: string | undefined;
  /** The cipher a project's run environment is decrypted with. */
  secretDecryptor: WorkflowEnvironmentDecryptor | undefined;
}): ApiWorkflowRuntime {
  const nlpRuntime: WorkflowNlpRuntimePort = options.nlpServiceUrl
    ? HttpWorkflowNlpRuntimeAdapter.create({ serviceUrl: options.nlpServiceUrl })
    : UnconfiguredWorkflowNlpRuntimeAdapter.create();

  const workflows: WorkflowService = PostgresWorkflowAdapter.create({
    database: options.infrastructure.prisma,
    datasets: options.peers.datasets,
    modelProviders: options.peers.modelProviders,
    nlpRuntime,
    projectEnvironment: PrismaWorkflowProjectEnvironmentAdapter.create({
      database: options.infrastructure.prisma,
      encryption: options.secretDecryptor ?? UnavailableWorkflowEnvironmentDecryptor.create(),
    }),
    llmParameters: ApiWorkflowLlmParametersAdapter.create({
      modelProviders: options.peers.modelProviders,
    }),
    dslMigration: ContractWorkflowDslMigrationAdapter.create(),
  });

  return { workflows, nlpRuntime };
}

/** The other features' services the studio's own surfaces reach. */
export type WorkflowPeers = Readonly<{
  /** A studio node's dataset rows, through the ONE dataset service. */
  datasets: DatasetService;
  /** The evaluators a workflow is published as. */
  evaluators: EvaluatorService;
  /** The gateway a node's model is resolved through. */
  modelProviders: ModelProviderService;
}>;

/** The two namespaces and the `ctx.app.workflows` application. */
export type ComposedWorkflowFeature = Readonly<{
  routers(mount: ApiTrpcFeatureMount): {
    workflow: ReturnType<typeof createWorkflowTrpcRouter>;
    optimization: ReturnType<typeof createWorkflowOptimizationTrpcRouter>;
  };
  /** For `ctx.app.workflows`, and for the packaged workflow REST family. */
  app: WorkflowApp;
  /**
   * The studio graph service itself, where this process composed one.
   */
  service?: WorkflowService | undefined;
}>;

/** Composes the studio's two surfaces over this process's own graph. */
export function composeWorkflowFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  runtime: ApiWorkflowRuntime;
  peers: WorkflowPeers;
  /** The model call behind the studio's autogenerated commit message. */
  generateCommitMessage?: (input: {
    projectId: string;
    previousDsl: string;
    nextDsl: string;
  }) => Promise<string>;
  /** Product signal for a project's first workflow. */
  workflowCreated?: (input: {
    userId: string;
    workflowCount: number;
    workflowId: string;
    projectId: string;
  }) => void;
  /** Where a fire-and-forget failure goes. */
  captureException?: (error: unknown) => void;
}): ComposedWorkflowFeature {
  const logger = createLogger("langwatch:api:workflow");
  const { prisma, authz } = options.infrastructure;

  const app = WorkflowApp.create({
    workflows: options.runtime.workflows,
    evaluators: options.peers.evaluators,
    datasets: options.peers.datasets,
    studioDsl: ModelProviderWorkflowStudioDslAdapter.create({
      modelProviders: options.peers.modelProviders,
    }),
    agentMappings: PrismaWorkflowAgentMappingAdapter.create({ database: prisma }),
    workflowRows: PrismaWorkflowRowAdapter.create({ database: prisma }),
  });

  const captureException =
    options.captureException ??
    ((error: unknown) => logger.error({ error }, "workflow surface reported a failure"));

  const probeProjectPermission = (
    ctx: unknown,
    projectId: string,
    permission: AuthzPermission,
  ): Promise<boolean> => authz.hasPermission({ userId: actorId(ctx), permission, projectId });

  const lifecycle: WorkflowTrpcPorts = {
    prepareDsl: (_ctx, input) => app.prepareStudioDsl(input),
    saveWorkflowVersion: (ctx, input) => app.saveStudioVersion(input, { id: actorId(ctx) }),
    generateCommitMessage: async (_ctx, input) => {
      if (!options.generateCommitMessage) {
        throw new ApiWorkflowUnavailableError(
          "model gateway, so it cannot write a commit message for you",
        );
      }
      return await options.generateCommitMessage(input);
    },
    workflowCreated: (_ctx, input) => options.workflowCreated?.(input),
    captureException,

    hasProjectPermission: (
      ctx: unknown,
      input: Readonly<{ projectId: string; permission: AuthzPermission }>,
    ) => probeProjectPermission(ctx, input.projectId, input.permission),

    // Each related project needs its own check; cap concurrency so a
    // workflow with many copies cannot exhaust the connection pool.
    hasProjectPermissions: async (
      ctx: unknown,
      input: Readonly<{ projectIds: readonly string[]; permission: AuthzPermission }>,
    ) => {
      const permitted = new Map<string, boolean>();
      await pMapLimited({
        items: [...input.projectIds],
        concurrency: 5,
        fn: async (projectId: string) => {
          permitted.set(projectId, await probeProjectPermission(ctx, projectId, input.permission));
        },
      });
      return permitted;
    },

    listWorkflowsWithCopyLineage: async (_ctx: unknown, input: Readonly<{ projectId: string }>) =>
      await prisma.workflow.findMany({
        where: { projectId: input.projectId, archivedAt: null },
        orderBy: { updatedAt: "desc" },
        select: workflowCopyLineageSelect,
      }),

    // Prisma requires projectId in the where clause for a project-level model.
    tryFindWorkflow: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) =>
      await prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
      }),

    // Copies are queried through the relation so the findMany's projectId
    // requirement does not force a single project on a cross-project read.
    tryFindCopiesWithPath: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) => {
      const workflowWithCopies = await prisma.workflow.findUnique({
        where: { id: input.workflowId, projectId: input.projectId },
        select: {
          id: true,
          copiedWorkflows: { where: { archivedAt: null }, select: workflowCopyPathSelect },
        },
      });

      return workflowWithCopies ? workflowWithCopies.copiedWorkflows : null;
    },

    tryFindWorkflowWithSource: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) =>
      await prisma.workflow.findUnique({
        where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
        include: { latestVersion: true, copiedFrom: { include: { latestVersion: true } } },
      }),

    tryFindWorkflowWithCopies: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) =>
      await prisma.workflow.findUnique({
        where: { id: input.workflowId, projectId: input.projectId, archivedAt: null },
        include: {
          latestVersion: true,
          copiedWorkflows: {
            where: { archivedAt: null },
            include: { latestVersion: true },
          },
        },
      }),

    tryFindLatestVersionNumber: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) => {
      const workflow = await prisma.workflow.findUnique({
        where: { id: input.workflowId, projectId: input.projectId },
        include: { latestVersion: true },
      });

      return workflow ? { version: workflow.latestVersion?.version ?? null } : null;
    },

    listAgentsForWorkflow: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) =>
      await prisma.agent.findMany({
        where: {
          workflowId: input.workflowId,
          projectId: input.projectId,
          archivedAt: null,
        },
        select: { id: true, name: true },
      }),

    listMonitorsForEvaluators: async (
      _ctx: unknown,
      input: Readonly<{ projectId: string; evaluatorIds: readonly string[] }>,
    ) =>
      (
        await prisma.monitor.findMany({
          where: {
            evaluatorId: { in: [...input.evaluatorIds] },
            projectId: input.projectId,
          },
          select: { id: true, name: true, evaluatorId: true },
        })
      ).flatMap(({ id, name, evaluatorId }) =>
        evaluatorId === null ? [] : [{ id, name, evaluatorId }],
      ),

    cascadeArchiveWorkflow: async (
      _ctx: unknown,
      input: Readonly<{ projectId: string; workflowId: string; unarchive?: boolean }>,
    ) => {
      const now = input.unarchive ? null : new Date();

      return prisma.$transaction(async (tx) => {
        // 1. Find all evaluators linked to this workflow
        const evaluators = await tx.evaluator.findMany({
          where: {
            workflowId: input.workflowId,
            projectId: input.projectId,
            archivedAt: null,
          },
          select: { id: true },
        });
        const evaluatorIds = evaluators.map((evaluator) => evaluator.id);

        // 2. Delete monitors linked to those evaluators (hard delete)
        const deletedMonitors =
          evaluatorIds.length > 0
            ? await tx.monitor.deleteMany({
                where: { evaluatorId: { in: evaluatorIds }, projectId: input.projectId },
              })
            : { count: 0 };

        // 3. Archive evaluators linked to this workflow
        const archivedEvaluators = await tx.evaluator.updateMany({
          where: { workflowId: input.workflowId, projectId: input.projectId },
          data: { archivedAt: now },
        });

        // 4. Archive agents linked to this workflow
        const archivedAgents = await tx.agent.updateMany({
          where: { workflowId: input.workflowId, projectId: input.projectId },
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
  };

  // Written out rather than inferred: the studio reads a stored version and a
  // published component with the shape the rows have, and the transport is
  // generic over both so the client sees exactly that.
  const optimization = {
    /**
     * The studio's chat panel runs the project's published workflow on the same service
     * the public run endpoint dispatches through. In-process on purpose.
     */
    runPublishedWorkflow: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string; body: Record<string, unknown> }>,
    ) =>
      await options.runtime.workflows.run({
        workflowId: input.workflowId,
        projectId: input.projectId,
        inputs: { ...input.body },
      }),

    tryGetWorkflow: async (
      _ctx: unknown,
      input: Readonly<{ workflowId: string; projectId: string }>,
    ) =>
      await prisma.workflow.findFirst({
        where: { id: input.workflowId, projectId: input.projectId },
      }),

    tryGetWorkflowVersion: async (
      _ctx: unknown,
      input: Readonly<{ versionId: string; projectId: string }>,
    ) =>
      await prisma.workflowVersion.findFirst({
        where: { id: input.versionId, projectId: input.projectId },
      }),

    setWorkflowFlags: async (
      _ctx: unknown,
      input: Readonly<{
        workflowId: string;
        projectId: string;
        isComponent?: boolean;
        isEvaluator?: boolean;
      }>,
    ) => {
      await prisma.workflow.update({
        where: { id: input.workflowId, projectId: input.projectId },
        data: {
          ...(input.isComponent === undefined ? {} : { isComponent: input.isComponent }),
          ...(input.isEvaluator === undefined ? {} : { isEvaluator: input.isEvaluator }),
        },
      });
    },

    listPublishedComponents: async (_ctx: unknown, input: Readonly<{ projectId: string }>) => {
      const workflows = await prisma.workflow.findMany({
        where: {
          projectId: input.projectId,
          OR: [{ isComponent: true }, { isEvaluator: true }],
        },
        include: { versions: true },
      });

      // Each component carries only the version it publishes; the studio
      // picks a component by its published shape, never by a draft.
      workflows.forEach((workflow) => {
        workflow.versions = workflow.versions.filter(
          (version) => version.id === workflow.publishedId,
        );
      });

      return workflows;
    },
  };

  return {
    app,
    service: options.runtime.workflows,
    routers: (mount) => ({
      workflow: createWorkflowTrpcRouter({ ...mount, ports: lifecycle }),
      optimization: createWorkflowOptimizationTrpcRouter({ ...mount, ports: optimization }),
    }),
  };
}

/**
 * The studio on a process that composed no graph to run it over. Both namespaces still
 * mount and every call refuses by name, so a person is told the deployment cannot answer
 * rather than shown an empty studio.
 */
export function refusingWorkflowFeature(): ComposedWorkflowFeature {
  const refuse = (): never => {
    throw new ApiWorkflowUnavailableError("studio graph");
  };
  const refuseEvery = <T>(): T => new Proxy({}, { get: () => refuse, has: () => true }) as T;

  return {
    app: refuseEvery<WorkflowApp>(),
    routers: (mount) => ({
      workflow: createWorkflowTrpcRouter({ ...mount, ports: refuseEvery<WorkflowTrpcPorts>() }),
      optimization: createWorkflowOptimizationTrpcRouter({
        ...mount,
        ports: refuseEvery<Parameters<typeof createWorkflowOptimizationTrpcRouter>[0]["ports"]>(),
      }),
    }),
  };
}

/**
 * A capability this deployment did not compose, reported to the caller.
 */
export class ApiWorkflowUnavailableError extends HandledError {
  declare readonly code: "service_unavailable";

  constructor(capability: string) {
    super("service_unavailable", `This deployment has no ${capability}.`, {
      httpStatus: 503,
      fault: "platform",
    });
    this.name = "ApiWorkflowUnavailableError";
  }
}

/** The caller of one request, as the ports above read it. */
const actorId = (ctx: unknown): string => (ctx as ApiTrpcPortsContext).actor().id;

/**
 * The LiteLLM parameters one Studio run executes each of its models with.
 */
class ApiWorkflowLlmParametersAdapter extends WorkflowLlmParametersPort {
  static create(input: { modelProviders: ModelProviderService }): ApiWorkflowLlmParametersAdapter {
    return new ApiWorkflowLlmParametersAdapter(input.modelProviders);
  }

  private constructor(private readonly modelProviders: ModelProviderService) {
    super();
  }

  async resolve(input: {
    projectId: string;
    models: readonly LLMConfig["model"][];
  }): Promise<readonly WorkflowLlmParameterResolution[]> {
    const providers = await getProjectModelProviders(this.modelProviders, input.projectId);

    return await Promise.all(
      input.models.map(async (model) => {
        const provider = model.split("/")[0]!;
        const modelProvider = providers[provider];
        if (!modelProvider) {
          return { model, provider, configured: false, enabled: false };
        }
        if (!modelProvider.enabled) {
          return { model, provider, configured: true, enabled: false };
        }
        return {
          model,
          provider,
          configured: true,
          enabled: true,
          litellmParams: await this.modelProviders.prepareExecution({
            model,
            projectId: input.projectId,
          }),
        };
      }),
    );
  }
}
