import type { WorkflowStudioDispatchService } from "@langwatch/workflow-server";
/**
 * The studio's own vertical, composed as its own feature. Two namespaces, one feature.
 * `workflow.*` is the lifecycle — versions, copies, publication, the archive cascade.
 */
import type { AuthzPermission } from "@langwatch/authz-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { ResourceScope } from "@langwatch/runtime-composition";
import { pMapLimited } from "@langwatch/eventing";
import { HandledError } from "@langwatch/handled-error";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import { AiCallFailureService, getProjectModelProviders } from "@langwatch/model-provider-server";
import { createLogger } from "@langwatch/observability";
import { nowInstant, toDate } from "@langwatch/time";
import {
  ContractWorkflowDslMigrationAdapter,
  HttpWorkflowNlpRuntimeAdapter,
  NlpPayloadStagingPort,
  ModelProviderWorkflowStudioDslAdapter,
  PostgresWorkflowAdapter,
  WorkflowAgentMappingAdapter,
  PrismaWorkflowProjectEnvironmentAdapter,
  PrismaWorkflowRowAdapter,
  UnavailableWorkflowEnvironmentDecryptor,
  UnconfiguredWorkflowNlpRuntimeAdapter,
  WorkflowAiCallPort,
  WorkflowApp,
  WorkflowCommitMessageModelPort,
  WorkflowCommitMessageService,
  WorkflowLlmParametersPort,
  type WorkflowEnvironmentDecryptor,
  type WorkflowAiCallFeature,
  type WorkflowLlmParameterResolution,
  type WorkflowNlpRuntimePort,
  type WorkflowTrpcPorts,
} from "@langwatch/workflow-server";
import type { LLMConfig, WorkflowService } from "@langwatch/workflow-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";

import type { ProjectService } from "@langwatch/project-contract";

import { composeApiAuthoringModelResolver } from "../../app/api-authoring-model.composition.ts";
import type { ApiTrpcPortsContext } from "../../app-trpc/app-trpc.context.ts";
import type { ApiTrpcInfrastructure } from "../../platform/infrastructure/api-trpc.infrastructure.ts";

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
  /**
   * Where an oversized invoke body is parked. Required: on an ARN target the
   * body cap is 6 MB, so a deployment with no object storage must refuse by
   * name rather than post over it.
   */
  payloadStaging: NlpPayloadStagingPort;
}): ApiWorkflowRuntime {
  const nlpRuntime: WorkflowNlpRuntimePort = options.nlpServiceUrl
    ? HttpWorkflowNlpRuntimeAdapter.create({
        serviceUrl: options.nlpServiceUrl,
        staging: options.payloadStaging,
      })
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
  agents: AgentApi;
  /** A studio node's dataset rows, through the ONE dataset service. */
  datasets: DatasetService;
  /** The evaluators a workflow is published as. */
  evaluators: EvaluatorApi;
  /** The gateway a node's model is resolved through. */
  modelProviders: ModelProviderService;
}>;

import type { ComposedWorkflowFeature } from "./workflow.composition.types.ts";

/**
 * Composes the studio's commit-message writer over this process's model gateway.
 * Absent where the process named no engine to proxy the call through, or no
 * gateway to resolve the model with — the studio then refuses by name rather
 * than autogenerating nothing.
 */
export function composeWorkflowCommitMessages(options: {
  modelProviders: ModelProviderService | undefined;
  projects: ProjectService | undefined;
  nlpServiceUrl: string | undefined;
}): WorkflowCommitMessageService | undefined {
  const resolveModel = composeApiAuthoringModelResolver(options);
  if (!resolveModel) return undefined;

  const failures = AiCallFailureService.create();

  return WorkflowCommitMessageService.create({
    models: new (class extends WorkflowCommitMessageModelPort {
      resolve(input: { projectId: string; featureKey: string }) {
        return resolveModel(input);
      }
    })(),
    aiCalls: new (class extends WorkflowAiCallPort {
      run<T>(feature: WorkflowAiCallFeature, call: () => Promise<T>): Promise<T> {
        return failures.wrapAiCall(feature, call);
      }
    })(),
  });
}

async function resolveWorkflowCommitMessage({
  commitMessages,
  input,
}: {
  commitMessages: WorkflowCommitMessageService | undefined;
  input: Parameters<WorkflowTrpcPorts["generateCommitMessage"]>[1];
}): ReturnType<WorkflowTrpcPorts["generateCommitMessage"]> {
  if (!commitMessages) {
    throw new ApiWorkflowUnavailableError(
      "model gateway, so it cannot write a commit message for you",
    );
  }
  return commitMessages.generate(input);
}

/**
 * Each related project needs its own check; cap concurrency so a workflow
 * with many copies cannot exhaust the connection pool.
 */
async function resolveProjectPermissionsMap({
  ctx,
  input,
  probeProjectPermission,
}: {
  ctx: unknown;
  input: Readonly<{ projectIds: readonly string[]; permission: AuthzPermission }>;
  probeProjectPermission: (
    ctx: unknown,
    projectId: string,
    permission: AuthzPermission,
  ) => Promise<boolean>;
}): Promise<Map<string, boolean>> {
  const permitted = new Map<string, boolean>();
  await pMapLimited({
    items: [...input.projectIds],
    concurrency: 5,
    fn: async (projectId: string) => {
      permitted.set(projectId, await probeProjectPermission(ctx, projectId, input.permission));
    },
  });
  return permitted;
}

/** Archives a workflow's evaluators, agents and itself, and hard-deletes its monitors. */
async function cascadeArchiveWorkflowTransaction({
  prisma,
  input,
}: {
  prisma: PrismaClient;
  input: Readonly<{ projectId: string; workflowId: string; unarchive?: boolean }>;
}) {
  const now = input.unarchive ? null : toDate(nowInstant());

  return prisma.$transaction(async (tx) => {
    // 1. Find all evaluators linked to this workflow
    const evaluators = await tx.evaluator.findMany({
      where: { workflowId: input.workflowId, projectId: input.projectId, archivedAt: null },
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
}

/** Composes the studio's two surfaces over this process's own graph. */
export function composeWorkflowFeature(options: {
  infrastructure: ApiTrpcInfrastructure;
  resources: ResourceScope;
  runtime: ApiWorkflowRuntime;
  studioDispatch?: WorkflowStudioDispatchService;
  peers: WorkflowPeers;
  /**
   * Who writes the studio's autogenerated commit message. Absent only where
   * this process composed no model gateway to write it with.
   */
  commitMessages?: WorkflowCommitMessageService | undefined;
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
    infrastructure: {
      studioDispatch: options.studioDispatch,
      workflows: options.runtime.workflows,
      evaluators: options.peers.evaluators,
      datasets: options.peers.datasets,
      studioDsl: ModelProviderWorkflowStudioDslAdapter.create({
        modelProviders: options.peers.modelProviders,
      }),
      agentMappings: WorkflowAgentMappingAdapter.create({ agents: options.peers.agents }),
      workflowRows: PrismaWorkflowRowAdapter.create({ database: prisma }),
    },
    dependencies: {},
    config: void 0,
    resources: options.resources,
  });

  // The two namespaces and their lifecycle and optimization ports went with the
  // transports that took them; they return with the converted ones.
  return { app, service: options.runtime.workflows };
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

  return { app: refuseEvery<WorkflowApp>() };
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
