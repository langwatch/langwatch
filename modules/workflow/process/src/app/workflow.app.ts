import { CloudWatchLogsClient } from "@aws-sdk/client-cloudwatch-logs";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { AgentApi } from "@langwatch/agent-contract";
import { ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import { ProjectPermissionDeniedError, type AuthzPermission } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
/**
 * The workflow module's application: what all five of its doors call. A caller
 * arrives as an argument, never read from a session or a request, so one
 * operation serves a browser session, an API key and a background job alike.
 */
import { DatasetApi } from "@langwatch/dataset-contract";
import { NurturingApi } from "@langwatch/enterprise-nurturing-contract";
import { EvaluatorApi, newEvaluatorId, type Evaluator } from "@langwatch/evaluator-contract";
import type { EventingCommands, StaticPipelineDefinition } from "@langwatch/eventing";
import { ExperimentApi } from "@langwatch/experiment-contract";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import type { FeatureSetup } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { MonitorApi } from "@langwatch/monitor-contract";
import { createLogger } from "@langwatch/observability";
import { type MembersRead } from "@langwatch/process-stores/members";
import { Secret } from "@langwatch/secrets";
import { nowInstant, type Instant } from "@langwatch/time";
import {
  clearDsl,
  recursiveAlphabeticallySortedKeys,
  WorkflowApi,
  WorkflowExecutionFailedError,
  WorkflowNotFoundError,
  WorkflowNotPublishedError,
  WorkflowVersionNotFoundError,
  type ArchiveWorkflowCommand,
  type CopyStudioWorkflowCommand,
  type CopyWorkflowCommand,
  type CreateWorkflowCommand,
  type ExecuteWorkflowComponentInput,
  type ExecutionState,
  type LLMConfig,
  type PublishWorkflowCommand,
  type RunWorkflowCommand,
  type StudioClientEvent,
  type StudioServerEvent,
  type StudioWorkflow,
  type UpdateWorkflowCommand,
  type Workflow,
  type WorkflowCaller,
  type WorkflowCascadeArchive,
  type WorkflowCopiesRow,
  type WorkflowCodeCompletionResponse,
  type WorkflowRestEnvelope,
  type WorkflowCopyRow,
  type WorkflowCopyWithPath,
  type WorkflowPushToCopies,
  type WorkflowDsl,
  type WorkflowEvaluatorFields,
  type WorkflowEvaluationRequest,
  type WorkflowEvaluationStarted,
  type WorkflowLineageRow,
  type WorkflowListRow,
  type WorkflowMappingFields,
  type PublishedWorkflowAnswer,
  type WorkflowPublicationFlags,
  type WorkflowReference,
  type WorkflowRelatedEntities,
  type WorkflowRunAnswer,
  type WorkflowRunOrigin,
  type WorkflowSourceRow,
  type WorkflowVersion,
  type WorkflowVersionHistoryEntry,
  type WorkflowVersionHistoryMode,
  type WorkflowWithVersion,
  workflowConfig,
  type WorkflowServerConfig,
  type WorkflowUsageCount,
  WorkflowCallerUnauthenticatedError,
  LlmModelNotSetError,
  WorkflowOptimizationRemovedError,
  WorkflowStudioEventInvalidError,
  workflowStudioRestEventSchema,
  nlpLambdaFleetFromSecret,
  type NlpLambdaFleetFields,
} from "@langwatch/workflow-contract";

import { LambdaWorkflowStudioStreamChannel } from "../channels/aws.lambda-workflow-studio-stream.channel.ts";
import { AwsNlpLambdaArnResolverChannel } from "../channels/aws.nlp-lambda-arn-resolver.channel.ts";
import { AwsNlpLambdaFleetChannel } from "../channels/aws.nlp-lambda-fleet.channel.ts";
import { AwsNlpLambdaInvokeChannel } from "../channels/aws.nlp-lambda-invoke.channel.ts";
import { AwsNlpLambdaStreamInvokeChannel } from "../channels/aws.nlp-lambda-stream-invoke.channel.ts";
import {
  HttpWorkflowNlpRuntimeAdapter,
  UnconfiguredWorkflowNlpRuntimeAdapter,
} from "../channels/http/http.workflow-nlp-runtime.channel.ts";
import {
  HttpWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
} from "../channels/http/http.workflow-studio-stream.channel.ts";
import type {
  NlpLambdaFunctionReader,
  WorkflowStudioStream,
} from "../channels/nlp-lambda.channel.ts";
import {
  buildWorkflowLifecyclePipeline,
  type WorkflowLifecyclePipeline,
} from "../eventing/workflow-lifecycle.pipeline.ts";
import { buildNlpLambdaCleanupPipeline } from "../eventing/workflow-nlp-lambda-cleanup.pipeline.ts";
import type { WorkflowLineageRepository } from "../repositories/workflow-lineage.repository.ts";
import {
  workflowRepositories,
  type WorkflowRepositories,
} from "../repositories/workflow-repositories.registry.ts";
import type { WorkflowRowRepository } from "../repositories/workflow-row.repository.ts";
import { buildStudioLambdaConfig } from "../rules/nlp-lambda-config.rules.ts";
import { workflowPlatformUrl } from "../rules/workflow-platform-url.rules.ts";
import {
  DISPATCHABLE_STUDIO_EVENT_TYPES,
  findPostedJson,
  studioFailureFrame,
} from "../rules/workflow-studio-event.rules.ts";
import { NlpLambdaCleanupService } from "../services/nlp-lambda-cleanup.service.ts";
import { NlpLambdaRuntimeService } from "../services/nlp-lambda-runtime.service.ts";
import { StudioEventPreparerService } from "../services/studio-event-preparer.service.ts";
import { WorkflowAgentMappingService } from "../services/workflow-agent-mapping.service.ts";
import { WorkflowCodeCompletionService } from "../services/workflow-code-completion.service.ts";
import { WorkflowCommitMessageService } from "../services/workflow-commit-message.service.ts";
import { WorkflowCopyLineageService } from "../services/workflow-copy-lineage.service.ts";
import { ContractWorkflowDslMigrationService } from "../services/workflow-dsl-migration.service.ts";
import { WorkflowLinkedRowsService } from "../services/workflow-linked-rows.service.ts";
import { WorkflowNlpExecutionService } from "../services/workflow-nlp-execution.service.ts";
import { WorkflowPermissionService } from "../services/workflow-permission.service.ts";
import { WorkflowProjectEnvironmentService } from "../services/workflow-project-environment.service.ts";
import { WorkflowPublicationService } from "../services/workflow-publication.service.ts";
import { WorkflowSignalsService } from "../services/workflow-signals.service.ts";
import { WorkflowStudioCopyService } from "../services/workflow-studio-copy.service.ts";
import { WorkflowStudioDispatchService } from "../services/workflow-studio-dispatch.service.ts";
import { ModelProviderWorkflowStudioDslService } from "../services/workflow-studio-dsl.service.ts";
import { WorkflowStudioVersionService } from "../services/workflow-studio-version.service.ts";
import { WorkflowService } from "../services/workflow.service.ts";

const logger = createLogger("langwatch:workflows");

/** Whether one person may act on a project other than the scoped one. */
export interface WorkflowPermissionProbe {
  has(input: { userId: string; projectId: string; permission: AuthzPermission }): Promise<boolean>;
  /**
   * The same probe for many projects at once. Bounded concurrency is the
   * process's concern - a workflow with many copies must not exhaust its
   * connection pool - so the cap lives with whoever owns the pool.
   */
  hasMany(input: {
    userId: string;
    projectIds: readonly string[];
    permission: AuthzPermission;
  }): Promise<ReadonlyMap<string, boolean>>;
}

/**
 * The reads a workflow's lineage and its archive cascade are made of: the
 * process's rows rather than this module's, since a copy names a project, a
 * team and an organization.
 */
export interface WorkflowLineageReads {
  listWithCopyLineage(input: { projectId: string }): Promise<readonly WorkflowLineageRow[]>;
  findWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ projectId: string }> | null>;
  findCopiesWithPath(input: {
    workflowId: string;
    projectId: string;
  }): Promise<readonly WorkflowCopyWithPath[] | null>;
  findWorkflowWithSource(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowSourceRow | null>;
  findWorkflowWithCopies(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowCopiesRow | null>;
  /**
   * The latest version NUMBER of one workflow. Null when the workflow row is
   * gone; `version: null` when it exists but has no latest version.
   */
  findLatestVersionNumber(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ version: string | null }> | null>;
  listAgents(input: {
    workflowId: string;
    projectId: string;
  }): Promise<readonly Readonly<{ id: string; name: string }>[]>;
  listMonitorsForEvaluators(input: {
    projectId: string;
    evaluatorIds: readonly string[];
  }): Promise<readonly Readonly<{ id: string; name: string; evaluatorId: string }>[]>;
  cascadeArchive(input: {
    projectId: string;
    workflowId: string;
    unarchive?: boolean;
  }): Promise<WorkflowCascadeArchive>;
}

/** The publication flags the Optimization Studio reads and writes. */
export interface WorkflowPublicationReads {
  findFlags(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowPublicationFlags | null>;
  findVersion(input: {
    versionId: string;
    projectId: string;
  }): Promise<Readonly<Record<string, unknown>> | null>;
  setFlags(input: {
    workflowId: string;
    projectId: string;
    isComponent?: boolean;
    isEvaluator?: boolean;
  }): Promise<void>;
  listPublishedComponents(input: { projectId: string }): Promise<unknown>;
}

/** The model call behind an autogenerated commit message. */
export interface WorkflowCommitMessageWriter {
  generate(input: { projectId: string; previousDsl: string; nextDsl: string }): Promise<string>;
}

/** Starting one evaluation run through the deployment's evaluations pipeline. */
export interface WorkflowEvaluationTrigger {
  trigger(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted>;
}

/** One Monaco completion for the studio's code editor. */
export interface WorkflowCodeCompletions {
  complete(input: {
    projectId: string;
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse>;
}

/** One streaming studio run, opened and read back event by event. */
export interface WorkflowStudioRuns {
  postEvent(input: {
    projectId: string;
    event: StudioClientEvent;
    onEvent: (event: StudioServerEvent) => void;
    isAborted?: () => Promise<boolean>;
    origin?: WorkflowRunOrigin;
  }): Promise<void>;
}

/** Where a product signal and an unexpected failure go. */
export interface WorkflowSignals {
  failed(error: unknown, context: Readonly<{ projectId?: string }>): void;
}

/** One deployed NLP Lambda function, reduced to what the cleanup policy reads. */
export type NlpLambdaFunction = Readonly<{ name: string }>;

/**
 * The account's per-project NLP Lambda functions and their log groups. A
 * technical need rather than a store: the cutoffs are this module's decision,
 * the AWS account they are applied to is the deployment's.
 */
export interface NlpLambdaFleet {
  /** Every function whose name starts with the studio's engine prefix. */
  listFunctions(input: { namePrefix: string }): Promise<readonly NlpLambdaFunction[]>;
  /**
   * When the function last logged, or null when nothing says. Null is not
   * "never used": a missing log group is also unknown, and the policy declines
   * to delete on an unknown rather than guessing.
   */
  findLastActivityAt(input: { functionName: string }): Promise<Instant | null>;
  /** True when the function still exists in the account. */
  functionExists(input: { functionName: string }): Promise<boolean>;
  deleteFunction(input: { functionName: string }): Promise<void>;
  /** Every log group under the studio's engine prefix, by function name. */
  listLogGroups(input: { namePrefix: string }): Promise<readonly string[]>;
  deleteLogGroup(input: { functionName: string }): Promise<void>;
}

/**
 * A cluster-wide store with an expiry for a project's resolved NLP Lambda ARN.
 * Redis in production; a process with none composes an in-memory stand-in,
 * which is slower rather than wrong.
 */
export interface NlpLambdaArnCache {
  find(key: string): Promise<string | null>;
  set(input: { key: string; value: string; ttlSeconds: number }): Promise<void>;
  delete(key: string): Promise<void>;
}

/** What the process supplies this module beside its own graph. */
export interface WorkflowInfrastructure {
  /** Where a studio component executes; absent means nothing executes. */
  studioDispatch?: WorkflowStudioDispatchService;
  /** The ONE workflow graph service on this process. */
  workflows: WorkflowService;
  /** The evaluators a workflow is published as. */
  evaluators: EvaluatorApi;
  /** The dataset copies a Studio graph carries with it into another project. */
  datasets: DatasetApi;
  /** How a Studio graph is prepared before any version of it is written. */
  studioDsl: WorkflowStudioDsl;
  /** The agent mappings a saved Studio graph refreshes, best effort. */
  agentMappings: WorkflowAgentMapping;
  /** The bare row a Studio copy lands in, before its first version exists. */
  workflowRows: WorkflowRowRepository;
  /** Executes a workflow run; absent means nothing executes. */
  execution: WorkflowExecution;
  /** Where a studio graph and a code evaluator both execute. */
  nlpRuntime: WorkflowNlpRuntime;
  /** Mints workflow and version ids. */
  ids: WorkflowId;
  /** Upgrades a persisted graph before it becomes the workflow's current version. */
  dslMigration: WorkflowDslMigration;
  /** Project credentials and decrypted secrets. */
  projectEnvironment: WorkflowProjectEnvironment;
  /** Resolves process-specific LiteLLM credentials without exposing provider rows. */
  llmParameters: WorkflowLlmParameters;
  permissions: WorkflowPermissionProbe;
  lineage: WorkflowLineageReads;
  publications: WorkflowPublicationReads;
  commitMessages: WorkflowCommitMessageWriter;
  evaluations: WorkflowEvaluationTrigger;
  codeCompletions: WorkflowCodeCompletions;
  studioRuns: WorkflowStudioRuns;
  signals: WorkflowSignals;
  /** The workflow's own lifecycle pipeline, whose worker subscriber tells nurturing. */
  lifecycle: WorkflowLifecyclePipeline;
  /**
   * The account the studio's engines are deployed into, for the daily sweep.
   * Absent where the deployment fronts the engine with no Lambdas at all,
   * and the sweep then reads nothing.
   */
  nlpLambdaFleet?: NlpLambdaFleet;
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
}

/**
 * What the process hands the module; some dependencies now module-supplied instead of
 * host-supplied.
 */
export type WorkflowHostMembers = Omit<
  WorkflowInfrastructure,
  | "evaluators"
  | "studioDsl"
  | "agentMappings"
  | "workflowRows"
  | "workflows"
  | "datasets"
  | "permissions"
  | "commitMessages"
  | "codeCompletions"
  | "studioRuns"
  | "studioDispatch"
  | "publicBaseUrl"
  | "evaluations"
  | "lineage"
  | "publications"
  | "signals"
>;

/** The engine address, its code-block ceiling and the public origin are process facts. */
type WorkflowProcessFacts = Readonly<{
  nlpServiceUrl: string | undefined;
  nlpCodeBlockTimeoutSeconds: string | undefined;
  publicBaseUrl: string | undefined;
}>;

type WorkflowSetup = FeatureSetup<
  typeof WorkflowApp.dependencies,
  WorkflowHostMembers & MembersRead<readonly ["prisma", "encryption"]> & WorkflowProcessFacts,
  WorkflowServerConfig,
  WorkflowRepositories
>;

/** The per-project studio fleet (`LANGWATCH_NLP_LAMBDA_CONFIG`): a credential, not config. */
const nlpLambdaFleetSecret = Secret.load("LANGWATCH_NLP_LAMBDA_CONFIG", { optional: true });

/** Main's retry budget, enough to ride out a cold fleet's concurrency burst. */
const NLP_LAMBDA_CLIENT_MAX_ATTEMPTS = 6;

/** Where studio graphs and workflow runs execute, and the fleet the daily sweep reads. */
type WorkflowEngine = Readonly<{
  stream: WorkflowStudioStream;
  runtime: WorkflowNlpRuntime;
  fleet?: NlpLambdaFleet;
}>;

/**
 * Main's precedence: a named fleet wins, and one that cannot be used refuses by
 * name rather than falling back; with none, the engine address; with neither,
 * every run refuses by name. See modules/workflow/specs/studio-lambda-stream.feature.
 */
async function composeEngine(setup: WorkflowSetup): Promise<WorkflowEngine> {
  const named = await setup.secrets.into(nlpLambdaFleetSecret, (raw) =>
    nlpLambdaFleetFromSecret.safeParse(raw),
  );
  if (!named.success) {
    const reason =
      named.error.issues[0]?.message ?? "The NLP Lambda fleet configuration cannot be used.";
    logger.error({ reason }, "the named NLP Lambda fleet is unusable; studio runs will refuse");

    return {
      stream: UnconfiguredWorkflowStudioStreamAdapter.create({ reason }),
      runtime: UnconfiguredWorkflowNlpRuntimeAdapter.create({ reason }),
    };
  }

  if (named.data) return lambdaEngine({ fields: named.data, setup });

  const serviceUrl = setup.members.nlpServiceUrl;
  if (!serviceUrl) {
    return {
      stream: UnconfiguredWorkflowStudioStreamAdapter.create(),
      runtime: UnconfiguredWorkflowNlpRuntimeAdapter.create(),
    };
  }

  return {
    stream: HttpWorkflowStudioStreamAdapter.create({ serviceUrl }),
    runtime: HttpWorkflowNlpRuntimeAdapter.create({ serviceUrl }),
  };
}

/** Each project's own function, resolved once cluster-wide and invoked over AWS. */
function lambdaEngine({
  fields,
  setup,
}: {
  fields: NlpLambdaFleetFields;
  setup: WorkflowSetup;
}): WorkflowEngine {
  const config = buildStudioLambdaConfig({
    fields: {
      region: fields.AWS_REGION,
      accessKeyId: fields.AWS_ACCESS_KEY_ID,
      secretAccessKey: fields.AWS_SECRET_ACCESS_KEY,
      roleArn: fields.role_arn,
      imageUri: fields.image_uri,
      cacheBucket: fields.cache_bucket,
      subnetIds: fields.subnet_ids,
      securityGroupIds: fields.security_group_ids,
    },
    langwatchEndpoint: setup.members.publicBaseUrl ?? "",
    codeBlockTimeoutRawValue: setup.members.nlpCodeBlockTimeoutSeconds,
    stagingThresholdBytesRawValue: setup.config.stagingThresholdBytes,
    stagingTtlSecondsRawValue: setup.config.stagingTtlSeconds,
  });
  const credentials = { accessKeyId: config.accessKeyId, secretAccessKey: config.secretAccessKey };
  const lambda = new LambdaClient({
    region: config.region,
    credentials,
    maxAttempts: NLP_LAMBDA_CLIENT_MAX_ATTEMPTS,
  });
  const logs = new CloudWatchLogsClient({ region: config.region, credentials });
  setup.resources.own("Workflow NLP Lambda clients", () => {
    lambda.destroy();
    logs.destroy();
  });

  const arns = NlpLambdaRuntimeService.create({
    cache: setup.repositories.nlpLambdaArns,
    resolver: AwsNlpLambdaArnResolverChannel.create({ lambda, logs, config, logger }),
    imageUri: config.imageUri,
    logger,
  });
  const functions: NlpLambdaFunctionReader = {
    arnFor: ({ projectId }) => arns.resolveArn(projectId),
  };
  const staging = setup.repositories.payloadStaging;
  const { stagingThresholdBytes, stagingTtlSeconds } = config;

  return {
    stream: LambdaWorkflowStudioStreamChannel.create({
      functions,
      invoke: AwsNlpLambdaStreamInvokeChannel.create({ lambda }),
      staging,
      stagingThresholdBytes,
      stagingTtlSeconds,
    }),
    runtime: HttpWorkflowNlpRuntimeAdapter.onProjectFunctions({
      functions,
      lambda: AwsNlpLambdaInvokeChannel.create({ lambda }),
      staging,
      stagingConfig: { stagingThresholdBytes, stagingTtlSeconds },
    }),
    fleet: AwsNlpLambdaFleetChannel.create({ lambda, logs, logger }),
  };
}

/** The lineage reads: the workflow's own rows, and what hangs off it through its owners. */
function lineageOf({
  rows,
  linked,
}: {
  rows: WorkflowLineageRepository;
  linked: WorkflowLinkedRowsService;
}): WorkflowLineageReads {
  return {
    listWithCopyLineage: (input) => rows.findWithCopyLineage(input),
    findWorkflow: (input) => rows.findWorkflow(input),
    findCopiesWithPath: (input) => rows.findCopiesWithPath(input),
    findWorkflowWithSource: (input) => rows.findWorkflowWithSource(input),
    findWorkflowWithCopies: (input) => rows.findWorkflowWithCopies(input),
    findLatestVersionNumber: (input) => rows.findLatestVersionNumber(input),
    listAgents: (input) => linked.listAgents(input),
    listMonitorsForEvaluators: (input) => linked.listMonitorsForEvaluators(input),
    cascadeArchive: (input) => linked.cascadeArchive(input),
  };
}

/** The Optimization Studio's publication flags, off the workflow's own rows. */
function publicationsOf(rows: WorkflowLineageRepository): WorkflowPublicationReads {
  return {
    findFlags: (input) => rows.findFlags(input),
    findVersion: (input) => rows.findVersion(input),
    setFlags: (input) => rows.setFlags(input),
    listPublishedComponents: (input) => rows.findPublishedComponents(input),
  };
}

/** The module's own id generator - the same ksuid the worker's copy used. */
class KsuidWorkflowId implements WorkflowId {
  static create(): KsuidWorkflowId {
    return new KsuidWorkflowId();
  }

  private constructor() {}

  next(kind: string): string {
    return generate(kind).toString();
  }
}

/** Resolves a workflow's LiteLLM parameters over the model-provider dependency. */
class ModelProviderWorkflowLlmParameters implements WorkflowLlmParameters {
  static create(input: { modelProviders: ModelProviderApi }): ModelProviderWorkflowLlmParameters {
    return new ModelProviderWorkflowLlmParameters(input.modelProviders);
  }

  #modelProviders: ModelProviderApi;

  private constructor(modelProviders: ModelProviderApi) {
    this.#modelProviders = modelProviders;
  }

  async resolve(input: {
    projectId: string;
    models: readonly LLMConfig["model"][];
  }): Promise<readonly WorkflowLlmParameterResolution[]> {
    const providers = await this.#modelProviders.getExecutionProviders({
      projectId: input.projectId,
    });

    return Promise.all(
      input.models.map(async (model) => {
        const provider = model.split("/")[0]!;
        const modelProvider = providers[provider];
        if (!modelProvider) return { model, provider, configured: false, enabled: false };
        if (!modelProvider.enabled) return { model, provider, configured: true, enabled: false };

        return {
          model,
          provider,
          configured: true,
          enabled: true,
          litellmParams: await this.#modelProviders.prepareExecution({
            model,
            projectId: input.projectId,
          }),
        };
      }),
    );
  }
}

/** The comparable text of a graph: local configuration stripped, keys sorted. */
function comparableDsl(dsl: StudioWorkflow): string {
  return JSON.stringify(recursiveAlphabeticallySortedKeys(clearDsl(dsl)), null, 2);
}

/** Every project id a workflow's copy lineage names, source and copies alike. */
function relatedProjectIdsOf(workflow: WorkflowLineageRow): readonly string[] {
  return [
    ...(workflow.copiedFrom ? [workflow.copiedFrom.projectId] : []),
    ...workflow.copiedWorkflows.map((copy) => copy.projectId),
  ];
}

export class WorkflowApp implements WorkflowApi {
  static readonly contract = WorkflowApi;
  static readonly dependencies = {
    /** The evaluators a workflow is published as - a peer's App, not a member. */
    evaluators: EvaluatorApi,
    /** Resolves a Studio graph's models before any version of it is written. */
    modelProviders: ModelProviderApi,
    /** The agent mappings a saved Studio graph refreshes, best effort. */
    agents: AgentApi,
    /** The dataset copies a Studio graph carries with it into another project. */
    datasets: DatasetApi,
    /** Whether one person holds a permission on a project the caller names. */
    authz: AuthzApi,
    /** Registers and runs a workflow's evaluation over its batch. */
    experiments: ExperimentApi,
    /** The monitors an archived workflow's evaluators back, deleted with it. */
    monitors: MonitorApi,
    /** Where a created workflow is told, by the lifecycle pipeline's subscriber. */
    nurturing: NurturingApi,
  };
  static readonly config = workflowConfig;
  /**
   * `prisma` for `workflowRows`/`workflows`/`projectEnvironment`, via this
   * module's own `workflowRepositories` registry; `encryption` for decrypting
   * the project secrets `projectEnvironment` reads.
   */
  static readonly reads = [
    "prisma",
    "encryption",
    "nlpServiceUrl",
    "nlpCodeBlockTimeoutSeconds",
    "publicBaseUrl",
  ] as const;
  static readonly repositories = workflowRepositories;
  static readonly secrets = { nlpLambdaFleet: nlpLambdaFleetSecret } as const;

  static async create(setup: WorkflowSetup): Promise<WorkflowApp> {
    const engine = await composeEngine(setup);
    const datasets = setup.dependencies.datasets;
    const llmParameters = ModelProviderWorkflowLlmParameters.create({
      modelProviders: setup.dependencies.modelProviders,
    });
    const projectEnvironment = WorkflowProjectEnvironmentService.create({
      repository: setup.repositories.projectEnvironment,
      encryption: setup.members.encryption,
    });
    const studioEvents = StudioEventPreparerService.create({
      datasets,
      projectEnvironment,
      llmParameters,
    });
    const nlpRuntime = engine.runtime;
    const ids = KsuidWorkflowId.create();
    const workflows = WorkflowService.create({
      repository: setup.repositories.workflows,
      datasets,
      execution: WorkflowNlpExecutionService.create({
        ids,
        modelProviders: setup.dependencies.modelProviders,
        nlpRuntime,
        studioEvents,
      }),
      studioEvents,
      dslMigration: ContractWorkflowDslMigrationService.create(),
      ids,
    });

    const modelProviders = setup.dependencies.modelProviders;
    const studioDispatch = WorkflowStudioDispatchService.create({
      stream: engine.stream,
      modelProviders,
    });

    return new WorkflowApp({
      ...setup.members,
      ...(engine.fleet ? { nlpLambdaFleet: engine.fleet } : {}),
      permissions: WorkflowPermissionService.create({ authz: setup.dependencies.authz }),
      commitMessages: WorkflowCommitMessageService.create({ modelProviders }),
      codeCompletions: WorkflowCodeCompletionService.create({ modelProviders }),
      studioDispatch,
      studioRuns: studioDispatch,
      ...(setup.members.publicBaseUrl === undefined
        ? {}
        : { publicBaseUrl: setup.members.publicBaseUrl }),
      workflows,
      datasets,
      evaluators: setup.dependencies.evaluators,
      studioDsl: ModelProviderWorkflowStudioDslService.create({
        modelProviders: setup.dependencies.modelProviders,
      }),
      agentMappings: WorkflowAgentMappingService.create({ agents: setup.dependencies.agents }),
      workflowRows: setup.repositories.workflowRows,
      evaluations: {
        trigger: (input) => setup.dependencies.experiments.triggerWorkflowEvaluation(input),
      },
      lineage: lineageOf({
        rows: setup.repositories.lineage,
        linked: WorkflowLinkedRowsService.create({
          workflows,
          agents: setup.dependencies.agents,
          evaluators: setup.dependencies.evaluators,
          monitors: setup.dependencies.monitors,
        }),
      }),
      publications: publicationsOf(setup.repositories.lineage),
      signals: WorkflowSignalsService.create(),
      lifecycle: buildWorkflowLifecyclePipeline(setup.dependencies.nurturing),
    });
  }

  #members: WorkflowInfrastructure;
  #lifecycleCommands: EventingCommands<WorkflowLifecyclePipeline> | undefined;
  #studioVersions: WorkflowStudioVersionService;
  #studioCopies: WorkflowStudioCopyService;
  #publication: WorkflowPublicationService;
  #copyLineage: WorkflowCopyLineageService;

  private constructor(members: WorkflowInfrastructure) {
    this.#members = members;
    this.#studioVersions = WorkflowStudioVersionService.create({
      workflows: members.workflows,
      studioDsl: members.studioDsl,
      agentMappings: members.agentMappings,
    });
    this.#studioCopies = WorkflowStudioCopyService.create({
      datasets: members.datasets,
      rows: members.workflowRows,
    });
    this.#publication = WorkflowPublicationService.create({
      publications: members.publications,
    });
    this.#copyLineage = WorkflowCopyLineageService.create({
      lineage: members.lineage,
      permissions: members.permissions,
      workflows: members.workflows,
      studioVersions: this.#studioVersions,
    });
  }

  // -- the workflow itself ---------------------------------------------------

  async executeComponent(input: ExecuteWorkflowComponentInput): Promise<ExecutionState> {
    const dispatch = this.#members.studioDispatch;

    if (!dispatch) throw new WorkflowExecutionFailedError();

    return dispatch.executeComponent(input);
  }

  /** Every non-archived workflow in the project. */
  list(input: { projectId: string }): Promise<Workflow[]> {
    return this.#members.workflows.list(input);
  }

  findEvaluatorWorkflows(input: {
    projectId: string;
  }): Promise<(Workflow & { versions: WorkflowVersion[] })[]> {
    return this.#members.workflows.findEvaluatorWorkflows(input);
  }

  /** One workflow, optionally with its current version. */
  getById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion> {
    return this.#members.workflows.getById(input);
  }

  /** One workflow with its current version, the graph upgraded to the current DSL. */
  getWithMigratedDsl(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowWithVersion> {
    return this.#studioVersions.getWithMigratedDsl(input);
  }

  /** Verifies that a workflow belongs to the requested project. */
  assertInProject(input: { workflowId: string; projectId: string }): Promise<void> {
    return this.#members.workflows.assertInProject(input);
  }

  listFields(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<Record<string, WorkflowMappingFields>> {
    return this.#members.workflows.listFields(input);
  }

  listSummaries(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<{ id: string; name: string }[]> {
    return this.#members.workflows.listSummaries(input);
  }

  archiveLinked(input: WorkflowReference): Promise<{ id: string }> {
    return this.#members.workflows.archiveLinked(input);
  }

  deleteUncommitted(input: WorkflowReference): Promise<void> {
    return this.#members.workflows.deleteUncommitted(input);
  }

  /**
   * One studio event, resolved against the project it will run in: its
   * environment, its LiteLLM parameters and the datasets it names.
   */
  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    return this.#members.workflows.prepareStudioEvent(input);
  }

  /** A peer's inbound Studio event, prepared the same way before it re-enters the graph. */
  enrichStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    return this.#members.workflows.enrichStudioEvent(input);
  }

  /** The evaluator-fields shape a peer's guard and run read off this workflow. */
  getFields(input: { workflowId: string; projectId: string }): Promise<WorkflowEvaluatorFields> {
    return this.#members.workflows.getFields(input);
  }

  /**
   * Creates a workflow and its first version, attributed to its caller, and
   * records it on the lifecycle pipeline. Attribution is here because who
   * wrote a version is a property of the act, not the door.
   */
  async create(
    input: Omit<CreateWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    const created = await this.#members.workflows.create({ ...input, authorId: by.id });

    this.#recordCreated({ workflowId: created.workflow.id, projectId: input.projectId, by });

    return created;
  }

  /** Records the create with the project's workflow count, never failing or delaying it. */
  #recordCreated(input: { workflowId: string; projectId: string; by: WorkflowCaller }): void {
    const { workflowId, projectId, by } = input;
    void this.#members.workflows
      .list({ projectId })
      .then((workflows) => {
        if (!this.#lifecycleCommands) {
          throw new Error("workflow_lifecycle pipeline senders are not connected yet");
        }
        return this.#lifecycleCommands.recordWorkflowCreated.send({
          tenantId: projectId,
          occurredAt: nowInstant().epochMilliseconds,
          workflowId,
          projectId,
          userId: by.id,
          workflowCount: workflows.length,
        });
      })
      .catch((error: unknown) => this.#members.signals.failed(error, { projectId }));
  }

  /** The workflow lifecycle pipeline this module registers, built once by {@link create}. */
  lifecyclePipeline(): WorkflowLifecyclePipeline {
    return this.#members.lifecycle;
  }

  /** Binds the built lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<WorkflowLifecyclePipeline>): void {
    this.#lifecycleCommands = commands;
  }

  /** Copies a workflow into another project, attributed to its caller. */
  copy(
    input: Omit<CopyWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    return this.#members.workflows.copy({ ...input, authorId: by.id });
  }

  /** Copies a workflow once the caller may create workflows in its source project too. */
  copyFromPermittedSource(
    input: Omit<CopyWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    return this.#copyLineage.copyFromPermittedSource(input, by);
  }

  /** Changes a workflow's own metadata: its name, its icon, its description. */
  update(input: UpdateWorkflowCommand): Promise<Workflow> {
    return this.#members.workflows.update(input);
  }

  /** The version history of one workflow. */
  getVersionHistory(input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    return this.#members.workflows.getVersionHistory(input);
  }

  /** Makes a stored version current again. */
  restoreVersion(input: { versionId: string; projectId: string }): Promise<WorkflowVersion> {
    return this.#members.workflows.restoreVersion(input);
  }

  /** Publishes one version, attributed to the caller who asked for it. */
  publish(input: Omit<PublishWorkflowCommand, "actorId">, by: WorkflowCaller): Promise<Workflow> {
    return this.#members.workflows.publish({ ...input, actorId: by.id });
  }

  /** Withdraws the published version. */
  unpublish(input: { id: string; projectId: string }): Promise<Workflow> {
    return this.#members.workflows.unpublish(input);
  }

  /** Archives one workflow, or restores it when `unarchive` is set. */
  archive(input: ArchiveWorkflowCommand): Promise<Workflow> {
    return this.#members.workflows.archive(input);
  }

  /** Runs a workflow synchronously, on its published version unless one is named. */
  run(input: RunWorkflowCommand): Promise<WorkflowRunAnswer> {
    return this.#members.workflows.run(input);
  }

  async runSynchronous(input: RunWorkflowCommand): Promise<WorkflowRunAnswer> {
    try {
      return await this.#members.workflows.run(input);
    } catch (error) {
      if (error instanceof WorkflowNotFoundError) {
        throw new NotFoundError("workflow_not_found", {
          resource: "Workflow",
          id: input.workflowId,
        });
      }
      if (error instanceof WorkflowNotPublishedError) {
        throw new ValidationError("Workflow not published", {
          meta: { workflowId: input.workflowId },
        });
      }
      if (error instanceof WorkflowVersionNotFoundError) {
        throw new NotFoundError("published_workflow_version_not_found", {
          resource: "Published workflow version",
          id: error.versionId,
        });
      }

      throw error;
    }
  }

  /**
   * Runs the project's published workflow once, on the same service the public
   * run endpoint dispatches through.
   */
  runPublished(input: {
    workflowId: string;
    projectId: string;
    body: Readonly<Record<string, unknown>>;
  }): Promise<WorkflowRunAnswer> {
    return this.#members.workflows.run({
      workflowId: input.workflowId,
      projectId: input.projectId,
      inputs: { ...input.body },
    });
  }

  /** Starts one evaluation run of a committed version. */
  async triggerEvaluation({
    callerMayReadRuns,
    ...input
  }: WorkflowEvaluationRequest & {
    callerMayReadRuns: boolean;
  }): Promise<WorkflowEvaluationStarted> {
    if (!callerMayReadRuns) throw new ApiKeyPermissionDeniedError("evaluations:view");
    return this.#members.evaluations.trigger(input);
  }

  // -- the Studio's own save and copy ----------------------------------------

  /**
   * Prepares a Studio graph the way saving one does, without writing anything,
   * so what executes is the same graph a save would have persisted.
   */
  prepareStudioDsl(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow> {
    return this.#studioVersions.prepareDsl(input);
  }

  /**
   * Writes a Studio graph as a version, attributed to the caller who asked for
   * it, and refreshes the agent mappings the new graph implies.
   */
  saveStudioVersion(
    input: {
      projectId: string;
      workflowId: string;
      dsl: StudioWorkflow;
      autoSaved: boolean;
      commitMessage: string;
      setAsLatestVersion?: boolean;
    },
    by: WorkflowCaller,
  ): Promise<WorkflowVersion> {
    return this.#studioVersions.saveOrCommit({ ...input, authorId: by.id });
  }

  /**
   * Copies a workflow into another project and answers the new row's id with
   * the graph rewritten to belong to it. The caller commits its first version.
   */
  copyStudioWorkflow(
    input: CopyStudioWorkflowCommand,
  ): Promise<{ workflowId: string; dsl: StudioWorkflow }> {
    return this.#studioCopies.copyWithDatasets(input);
  }

  async completeCode(input: {
    projectId: string;
    userId: string | undefined;
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse> {
    if (input.userId === undefined) throw new WorkflowCallerUnauthenticatedError();
    const permitted = await this.#members.permissions.has({
      userId: input.userId,
      projectId: input.projectId,
      permission: "workflows:manage",
    });

    if (!permitted) throw new ProjectPermissionDeniedError("workflows:manage");

    try {
      return await this.#members.codeCompletions.complete({
        projectId: input.projectId,
        body: input.body,
      });
    } catch (error) {
      this.#members.signals.failed(error, { projectId: input.projectId });
      throw error;
    }
  }

  postStudioEvent(input: {
    projectId: string;
    event: StudioClientEvent;
    onEvent: (event: StudioServerEvent) => void;
    isAborted?: () => Promise<boolean>;
    origin?: WorkflowRunOrigin;
  }): Promise<void> {
    return this.#members.studioRuns.postEvent(input);
  }

  reportStudioFailure(error: unknown, context: { projectId: string }): void {
    this.#members.signals.failed(error, context);
  }

  /**
   * The editor's posted event, checked and prepared the way the door always has, answered as
   * the engine's events. The body is forwarded as sent: the schema is only the 400 gate, since
   * parsing would strip the node payload keys the engine reads back out.
   */
  async streamStudioEvent({
    body,
    userId,
  }: {
    body: string;
    userId: string | undefined;
  }): Promise<AsyncIterable<StudioServerEvent>> {
    const [posted] = findPostedJson(body);
    const validated = posted ? workflowStudioRestEventSchema.safeParse(posted) : undefined;
    if (!posted || !validated?.success) throw new WorkflowStudioEventInvalidError();

    const projectId = validated.data.projectId;
    const eventWithoutEnvs = posted.event as StudioClientEvent;
    logger.info({ event: eventWithoutEnvs.type, projectId }, "post_event");

    if (userId === undefined) throw new WorkflowCallerUnauthenticatedError();
    const permitted = await this.hasProjectPermission({
      userId,
      projectId,
      permission: "workflows:manage",
    });
    if (!permitted) throw new ProjectPermissionDeniedError("workflows:manage");

    const message = await this.#preparedForDispatch({ event: eventWithoutEnvs, projectId });
    if (!DISPATCHABLE_STUDIO_EVENT_TYPES.has(message.type)) {
      throw new WorkflowStudioEventInvalidError(`Unknown event type on server: ${message.type}`);
    }
    // Optimization was DSPy-only; stop events still pass so a started run can be cancelled.
    if (message.type === "execute_optimization") throw new WorkflowOptimizationRemovedError();

    return studioEventsOf({
      start: (onEvent) => this.postStudioEvent({ projectId, event: message, onEvent }),
      failureFrame: (error) =>
        studioFailureFrame({ error, message, finishedAtMs: nowInstant().epochMilliseconds }),
    });
  }

  /**
   * A graph that could not be prepared: a still-preparing dataset or a node with no model are
   * the caller's to fix and rethrow as they are; anything else is reported first.
   */
  async #preparedForDispatch(input: {
    event: StudioClientEvent;
    projectId: string;
  }): Promise<StudioClientEvent> {
    try {
      return await this.prepareStudioEvent(input);
    } catch (error) {
      if (isCallerFixable(error)) throw error;
      logger.error({ error, projectId: input.projectId }, "error");
      this.reportStudioFailure(error, { projectId: input.projectId });
      throw error;
    }
  }

  /**
   * A short commit message for the change between two graphs, both normalised
   * first - local configuration stripped, keys sorted - so a reordering never
   * reaches a model.
   */
  async generateCommitMessage(input: {
    projectId: string;
    prevDsl: StudioWorkflow;
    newDsl: StudioWorkflow;
  }): Promise<string> {
    const previousDsl = comparableDsl(input.prevDsl);
    const nextDsl = comparableDsl(input.newDsl);

    if (previousDsl === nextDsl) return "no changes";

    return this.#members.commitMessages.generate({
      projectId: input.projectId,
      previousDsl,
      nextDsl,
    });
  }

  // -- the evaluator a published workflow is wrapped in -----------------------

  /** Every evaluator in the project. */
  listEvaluators(input: { projectId: string }): Promise<Evaluator[]> {
    return this.#members.evaluators.getAll(input);
  }

  /**
   * Create-or-rename rather than create: a workflow republished after a rename
   * must not leave the picker showing the old name, and a second evaluator for
   * one workflow would be two rows the picker cannot tell apart.
   */
  async linkEvaluatorToWorkflow(input: {
    workflowId: string;
    projectId: string;
    name: string;
  }): Promise<Evaluator> {
    const { workflowId, projectId, name } = input;
    const [existing] = await this.#members.evaluators.listByWorkflow({
      workflowId,
      projectId,
    });

    if (existing) {
      return this.#members.evaluators.update({
        id: existing.id,
        projectId,
        data: { name },
      });
    }

    return this.#members.evaluators.create({
      id: newEvaluatorId(),
      projectId,
      name,
      type: "workflow",
      config: {},
      workflowId,
    });
  }

  /**
   * Nothing may keep an evaluator pointing at a workflow that no longer offers
   * itself as one. A workflow never published as an evaluator has nothing to
   * archive, which is a no-op rather than a refusal.
   */
  async unlinkEvaluatorFromWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<void> {
    const [linked] = await this.#members.evaluators.listByWorkflow(input);

    if (!linked) return;

    await this.#members.evaluators.archive({
      id: linked.id,
      projectId: input.projectId,
    });
  }

  // -- what the caller may see elsewhere -------------------------------------

  hasProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<boolean> {
    return this.#members.permissions.has(input);
  }

  // -- copy lineage, related entities and the archive cascade ----------------

  /**
   * The project's workflows, with copy lineage redacted to what the caller may
   * see: a source workflow in a project they cannot view is hidden entirely,
   * and the copy count only counts copies they can view.
   */
  async listWithCopyLineage(input: {
    projectId: string;
    viewerUserId: string;
  }): Promise<WorkflowListRow[]> {
    const workflows = await this.#members.lineage.listWithCopyLineage({
      projectId: input.projectId,
    });

    const relatedProjectIds = [...new Set(workflows.flatMap(relatedProjectIdsOf))];
    const probed = await this.#members.permissions.hasMany({
      userId: input.viewerUserId,
      projectIds: relatedProjectIds.filter((projectId) => projectId !== input.projectId),
      permission: "workflows:view",
    });
    const isVisible = (projectId: string) =>
      projectId === input.projectId || probed.get(projectId) === true;

    return workflows.map(({ copiedWorkflows, ...workflow }) => {
      const canSeeSource = workflow.copiedFrom !== null && isVisible(workflow.copiedFrom.projectId);

      return {
        ...workflow,
        copiedFromWorkflowId: canSeeSource ? workflow.copiedFromWorkflowId : null,
        copiedFrom: canSeeSource ? workflow.copiedFrom : null,
        _count: {
          copiedWorkflows: copiedWorkflows.filter((copy) => isVisible(copy.projectId)).length,
        },
      };
    });
  }

  findWorkflowOwner(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ projectId: string }> | null> {
    return this.#members.lineage.findWorkflow(input);
  }

  findCopiesWithPath(input: {
    workflowId: string;
    projectId: string;
  }): Promise<readonly WorkflowCopyWithPath[] | null> {
    return this.#members.lineage.findCopiesWithPath(input);
  }

  findWorkflowWithSource(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowSourceRow | null> {
    return this.#members.lineage.findWorkflowWithSource(input);
  }

  findWorkflowWithCopies(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowCopiesRow | null> {
    return this.#members.lineage.findWorkflowWithCopies(input);
  }

  findLatestVersionNumber(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ version: string | null }> | null> {
    return this.#members.lineage.findLatestVersionNumber(input);
  }

  /** The copies of a workflow the caller may push to. */
  listPermittedCopies(
    input: { workflowId: string; projectId: string },
    by: WorkflowCaller,
  ): Promise<WorkflowCopyRow[]> {
    return this.#copyLineage.listPermittedCopies(input, by);
  }

  /** Pulls the source's latest graph into this copy as its next major version. */
  syncFromSource(
    input: { workflowId: string; projectId: string },
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowSourceRow; version: WorkflowVersion }> {
    return this.#copyLineage.syncFromSource(input, by);
  }

  /** Pushes this workflow's latest graph to the copies the caller may update. */
  pushToCopies(
    input: { workflowId: string; projectId: string; copyIds?: string[] },
    by: WorkflowCaller,
  ): Promise<WorkflowPushToCopies> {
    return this.#copyLineage.pushToCopies(input, by);
  }

  /**
   * What archiving this workflow would take with it - the evaluators and
   * agents bound to it, and the monitors those evaluators back.
   */
  async getRelatedEntities(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowRelatedEntities> {
    const evaluators = (await this.listEvaluators({ projectId: input.projectId }))
      .filter((evaluator) => evaluator.workflowId === input.workflowId)
      .map(({ id, name }) => ({ id, name }));

    // Copied out of the readonly views: the confirmation dialog these lists
    // feed types them as plain arrays, and a readonly element type would
    // narrow a client payload that is identical on the wire.
    const agents = [...(await this.#members.lineage.listAgents(input))];

    const evaluatorIds = evaluators.map((evaluator) => evaluator.id);
    const monitors =
      evaluatorIds.length > 0
        ? [
            ...(await this.#members.lineage.listMonitorsForEvaluators({
              projectId: input.projectId,
              evaluatorIds,
            })),
          ]
        : [];

    return { evaluators, agents, monitors };
  }

  /**
   * Archives the workflow and everything downstream of it in one transaction:
   * linked evaluators and agents are archived, and the monitors those
   * evaluators back are deleted outright.
   */
  cascadeArchive(input: {
    projectId: string;
    workflowId: string;
    unarchive?: boolean;
  }): Promise<WorkflowCascadeArchive> {
    return this.#members.lineage.cascadeArchive(input);
  }

  // -- the Optimization Studio's publication flags ---------------------------

  async toggleSaveAsEvaluator(input: {
    workflowId: string;
    projectId: string;
    isEvaluator: boolean;
  }): Promise<void> {
    const workflow = await this.#members.publications.findFlags(input);
    if (!workflow) {
      throw new WorkflowNotFoundError(input.workflowId, input.projectId);
    }

    await this.#members.publications.setFlags({
      workflowId: input.workflowId,
      projectId: input.projectId,
      isEvaluator: input.isEvaluator,
      isComponent: !input.isEvaluator,
    });

    if (input.isEvaluator) {
      await this.linkEvaluatorToWorkflow({
        workflowId: input.workflowId,
        projectId: input.projectId,
        name: workflow.name,
      });
    }
  }

  findWorkflowFlags(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowPublicationFlags | null> {
    return this.#members.publications.findFlags(input);
  }

  getPublishedWorkflow(input: {
    workflowId: string;
    projectId: string;
  }): Promise<PublishedWorkflowAnswer> {
    return this.#publication.getPublished(input);
  }

  findWorkflowVersionById(input: {
    versionId: string;
    projectId: string;
  }): Promise<Readonly<Record<string, unknown>> | null> {
    return this.#members.publications.findVersion(input);
  }

  setWorkflowFlags(input: {
    workflowId: string;
    projectId: string;
    isComponent?: boolean;
    isEvaluator?: boolean;
  }): Promise<void> {
    return this.#members.publications.setFlags(input);
  }

  listPublishedComponents(input: { projectId: string }): Promise<unknown> {
    return this.#members.publications.listPublishedComponents(input);
  }

  // -- the deployment's own housekeeping ------------------------------------

  /** The daily sweep of the studio's quiet NLP Lambda functions this module's worker hosts. */
  nlpLambdaCleanupPipeline(deps: {
    deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  }): StaticPipelineDefinition<never> {
    return buildNlpLambdaCleanupPipeline({
      sweep: () => this.#sweepQuietNlpLambdas(),
      deleteDispatchedBefore: deps.deleteDispatchedBefore,
    });
  }

  /** A deployment with no Lambda account has no engines of its own to sweep. */
  async #sweepQuietNlpLambdas(): Promise<void> {
    const fleet = this.#members.nlpLambdaFleet;
    if (!fleet) {
      logger.info("no NLP Lambda fleet composed; the daily sweep has nothing to read");
      return;
    }

    await NlpLambdaCleanupService.create({ fleet, logger }).sweep();
  }

  // ── the platform's own links ──────────────────────────────────────────────

  /**
   * The platform's own address for one workflow resource. A deployment that
   * serves this family but named no public origin refuses by name.
   */
  countUsage(input: {
    projectIds: readonly string[];
    since?: number;
  }): Promise<WorkflowUsageCount> {
    return this.#members.workflowRows.countUsage(input);
  }

  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#members.publicBaseUrl === undefined) {
      throw new Error(
        "The workflows REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return workflowPlatformUrl({ publicBaseUrl: this.#members.publicBaseUrl, ...input });
  }
}

export type WorkflowExecutionInput = {
  projectId: string;
  workflowId: string;
  version: WorkflowVersion;
  inputs: Record<string, unknown>;
  doNotTrace?: boolean;
  runEvaluations?: boolean;
  origin?: WorkflowRunOrigin;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
};

/** Execution is members: the feature supplies a dispatch port. */
export interface WorkflowExecution {
  execute(input: WorkflowExecutionInput): Promise<WorkflowRunAnswer>;
}

export type WorkflowNlpDispatchInput = {
  projectId: string;
  body: StudioClientEvent;
  origin: WorkflowRunOrigin;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
};

export type WorkflowNlpDispatchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
};

export interface WorkflowNlpRuntime {
  dispatch(input: WorkflowNlpDispatchInput): Promise<WorkflowNlpDispatchResponse>;
}

export interface WorkflowId {
  next(kind: string): string;
}

/** Upgrades a persisted graph before it becomes the workflow's current version. */
export interface WorkflowDslMigration {
  migrate(dsl: WorkflowDsl): WorkflowDsl;
}

/** Project credentials and decrypted secrets are application members. */
export interface WorkflowProjectEnvironment {
  get(input: { projectId: string }): Promise<{ apiKey: string; secrets: Record<string, string> }>;
}

export type WorkflowLlmParameterResolution = {
  model: string;
  provider: string;
  configured: boolean;
  enabled: boolean;
  litellmParams?: Record<string, string>;
};

/** Resolves process-specific LiteLLM credentials without exposing provider rows. */
export interface WorkflowLlmParameters {
  resolve(input: {
    projectId: string;
    models: readonly LLMConfig["model"][];
  }): Promise<readonly WorkflowLlmParameterResolution[]>;
}

/**
 * Application-owned preparation of Studio graph before persistence; folds editor config and
 * fills LLM nodes.
 */
export interface WorkflowStudioDsl {
  prepare(input: { projectId: string; dsl: StudioWorkflow }): Promise<StudioWorkflow>;
}

/**
 * The agent-mapping recompute a saved Studio graph triggers. Best effort and
 * outside the save: a failure to refresh the host's scenario mappings must
 * never fail the version that was already written.
 */
export interface WorkflowAgentMapping {
  recompute(input: { projectId: string; workflowId: string; dsl: StudioWorkflow }): Promise<void>;
}

/** Matched on the handled CODE: the dataset module's own class is not this module's to name. */
function isCallerFixable(error: unknown): boolean {
  if (error instanceof LlmModelNotSetError) return true;
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "dataset_not_ready"
  );
}

/**
 * A run's events as they arrive. A `done` keeps the stream open one more second so a trailing
 * frame still reaches the editor; the run settling ends it either way, and a failure becomes
 * one last frame.
 */
async function* studioEventsOf({
  start,
  failureFrame,
}: {
  start: (onEvent: (event: StudioServerEvent) => void) => Promise<void>;
  failureFrame: (error: unknown) => StudioServerEvent;
}): AsyncGenerator<StudioServerEvent> {
  const queue: StudioServerEvent[] = [];
  let closed = false;
  let wake: (() => void) | undefined;
  const notify = () => {
    wake?.();
    wake = undefined;
  };
  const close = () => {
    closed = true;
    notify();
  };

  void start((event) => {
    if (closed) return;
    queue.push(event);
    notify();
    if (event.type === "done") setTimeout(close, 1000);
  })
    .catch((error: unknown) => {
      logger.error({ error }, "Error handling message");
      if (!closed) queue.push(failureFrame(error));
    })
    .finally(close);

  while (!closed || queue.length > 0) {
    const next = queue.shift();
    if (next) {
      yield next;
      continue;
    }
    await new Promise<void>((resolve) => {
      wake = resolve;
    });
  }
}
