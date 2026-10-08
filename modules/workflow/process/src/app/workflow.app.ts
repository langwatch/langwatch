import {
  AgentApi,
  type AgentApiCopyRequest,
  type AgentCopyCreated,
} from "@langwatch/agent-contract";
import { ApiKeyApi, ApiKeyPermissionDeniedError } from "@langwatch/api-key-contract";
import { ProjectPermissionDeniedError, type AuthzPermission } from "@langwatch/authorization";
import { AuthzApi } from "@langwatch/authz-contract";
/**
 * The workflow module's application: what all five of its doors call. A caller
 * arrives as an argument, never read from a session or a request, so one
 * operation serves a browser session, an API key and a background job alike.
 */
import { DatasetApi } from "@langwatch/dataset-contract";
import type { EventingCommands, StaticPipelineDefinition } from "@langwatch/eventing";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import type { FeatureSetup } from "@langwatch/process";
import { SecretApi } from "@langwatch/secret-contract";
import { nlpInternalSecret } from "@langwatch/secrets";
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
  type ExecuteSyncRelayEvent,
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
  type WorkflowLineageRow,
  type WorkflowListRow,
  type PublishedWorkflowAnswer,
  type WorkflowPublicationFlags,
  type WorkflowReference,
  type WorkflowRelatedEntities,
  type WorkflowRunAnswer,
  type WorkflowRunOrigin,
  type WorkflowRunPrincipal,
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
} from "@langwatch/workflow-contract";

import { LambdaWorkflowStudioStreamChannel } from "../channels/aws.lambda-workflow-studio-stream.channel.ts";
import { HttpWorkflowNlpRuntimeAdapter } from "../channels/http/http.workflow-nlp-runtime.channel.ts";
import type {
  NlpLambdaFunctionReader,
  WorkflowStudioStream,
} from "../channels/nlp-lambda.channel.ts";
import { nlpLambdaFleetSecret, type WorkflowChannels } from "../channels/workflow.channels.ts";
import {
  buildWorkflowAgentArchiveCascadePipeline,
  type WorkflowAgentArchiveCascadePipeline,
} from "../eventing/workflow-agent-archive-cascade.pipeline.ts";
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
import { relayTurnCeilingMs } from "../rules/execute-sync-relay.rules.ts";
import { workflowPlatformUrl } from "../rules/workflow-platform-url.rules.ts";
import { dispatchKeyFloorMs } from "../rules/workflow-run-key.rules.ts";
import {
  DISPATCHABLE_STUDIO_EVENT_TYPES,
  findPostedJson,
  studioFailureFrame,
} from "../rules/workflow-studio-event.rules.ts";
import { NlpLambdaCleanupService } from "../services/nlp-lambda-cleanup.service.ts";
import { NlpLambdaRuntimeService } from "../services/nlp-lambda-runtime.service.ts";
import { StudioEventPreparerService } from "../services/studio-event-preparer.service.ts";
import { WorkflowAgentCopyService } from "../services/workflow-agent-copy.service.ts";
import { WorkflowAgentMappingService } from "../services/workflow-agent-mapping.service.ts";
import { WorkflowCodeCompletionService } from "../services/workflow-code-completion.service.ts";
import { WorkflowCommitMessageService } from "../services/workflow-commit-message.service.ts";
import { WorkflowCopyLineageService } from "../services/workflow-copy-lineage.service.ts";
import { ContractWorkflowDslMigrationService } from "../services/workflow-dsl-migration.service.ts";
import { WorkflowEngineAttachmentLimitService } from "../services/workflow-engine-attachment-limit.service.ts";
import { WorkflowExecuteSyncRelayService } from "../services/workflow-execute-sync-relay.service.ts";
import { WorkflowHttpSecretsService } from "../services/workflow-http-secrets.service.ts";
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
import type { WorkflowBrowserApi } from "../transport/workflow.trpc.ts";

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
interface WorkflowCommitMessageWriter {
  generate(input: { projectId: string; previousDsl: string; nextDsl: string }): Promise<string>;
}

/** One Monaco completion for the studio's code editor. */
interface WorkflowCodeCompletions {
  complete(input: {
    projectId: string;
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse>;
}

/** One streaming studio run, opened and read back event by event. */
interface WorkflowStudioRuns {
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

/** What `WorkflowModule.create` composes from its peers, config, secrets and registry. */
interface WorkflowInfrastructure {
  /** Where a studio component executes; absent means nothing executes. */
  studioDispatch?: WorkflowStudioDispatchService;
  /** Relays a scenario child's turn to its project's own engine. */
  executeSyncRelay: WorkflowExecuteSyncRelayService;
  /** The ONE workflow graph service on this process. */
  workflows: WorkflowService;
  /** The dataset copies a Studio graph carries with it into another project. */
  datasets: DatasetApi;
  /** How a Studio graph is prepared before any version of it is written. */
  studioDsl: WorkflowStudioDsl;
  /** Stores the tokens typed into a graph's HTTP nodes as project secrets. */
  httpSecrets: WorkflowHttpSecrets;
  /** The agent mappings a saved Studio graph refreshes, best effort. */
  agentMappings: WorkflowAgentMapping;
  /** Writes the row of an agent copy whose graph this module copied first. */
  agents: AgentApi;
  /** The bare row a Studio copy lands in, before its first version exists. */
  workflowRows: WorkflowRowRepository;
  permissions: WorkflowPermissionProbe;
  lineage: WorkflowLineageReads;
  publications: WorkflowPublicationReads;
  commitMessages: WorkflowCommitMessageWriter;
  codeCompletions: WorkflowCodeCompletions;
  studioRuns: WorkflowStudioRuns;
  signals: WorkflowSignals;
  /** The workflow's own lifecycle pipeline, whose event nurturing reacts to (§9). */
  lifecycle: WorkflowLifecyclePipeline;
  /**
   * The account the studio's engines are deployed into, for the daily sweep.
   * Absent where the deployment fronts the engine with no Lambdas at all,
   * and the sweep then reads nothing.
   */
  nlpLambdaFleet?: NlpLambdaFleet;
  /** Whether a scenario turn relays to the project's own engine; absent means it does not. */
  perProjectEngines?: boolean;
  /** The deployment's public origin, for `platformUrl`. Optional: not every install serves REST. */
  publicBaseUrl?: string;
}

type WorkflowSetup = FeatureSetup<
  typeof WorkflowModule.dependencies,
  WorkflowServerConfig,
  WorkflowRepositories,
  WorkflowChannels
>;

/** Where studio graphs and workflow runs execute, and the fleet the daily sweep reads. */
type WorkflowEngine = Readonly<{
  stream: WorkflowStudioStream;
  runtime: WorkflowNlpRuntime;
  fleet?: NlpLambdaFleet;
  /** A fleet is named, usable or not: main's `LANGWATCH_NLP_LAMBDA_CONFIG` presence test. */
  perProjectEngines: boolean;
}>;

/** The channels' engine, with a project-function fleet's ARNs resolved over its AWS channels. */
function composeEngine(setup: WorkflowSetup): WorkflowEngine {
  const { engine } = setup.channels;
  if (engine.kind === "single") return engine;

  setup.resources.own("Workflow NLP Lambda clients", () => engine.close());
  const arns = NlpLambdaRuntimeService.create({
    cache: setup.repositories.nlpLambdaArns,
    resolver: engine.resolver,
    imageUri: engine.imageUri,
    configFingerprint: engine.configFingerprint,
    logger,
  });
  const functions: NlpLambdaFunctionReader = {
    arnFor: ({ projectId }) => arns.resolveArn(projectId),
  };
  const staging = setup.repositories.payloadStaging;
  const { stagingThresholdBytes, stagingTtlSeconds, internalSecret } = engine;

  return {
    stream: LambdaWorkflowStudioStreamChannel.create({
      functions,
      invoke: engine.streamInvoke,
      staging,
      stagingThresholdBytes,
      stagingTtlSeconds,
      internalSecret,
    }),
    runtime: HttpWorkflowNlpRuntimeAdapter.onProjectFunctions({
      functions,
      lambda: engine.invoke,
      staging,
      stagingConfig: { stagingThresholdBytes, stagingTtlSeconds },
      internalSecret,
    }),
    fleet: engine.fleet,
    perProjectEngines: true,
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

export class WorkflowModule implements WorkflowApi, WorkflowBrowserApi {
  static readonly contract = WorkflowApi;
  static readonly dependencies = {
    /** Resolves a Studio graph's models before any version of it is written. */
    modelProviders: ModelProviderApi,
    /** The agent mappings a saved Studio graph refreshes, best effort. */
    agents: AgentApi,
    /** The dataset copies a Studio graph carries with it into another project. */
    datasets: DatasetApi,
    /** Whether one person holds a permission on a project the caller names. */
    authz: AuthzApi,
    /** Mints the key a run calls LangWatch back with. */
    apiKeys: ApiKeyApi,
    /** Stores an HTTP node's typed token; reads the listed secrets a Studio run receives. */
    secrets: SecretApi,
  };
  static readonly config = workflowConfig;
  static readonly repositories = workflowRepositories;
  static readonly secrets = {
    nlpLambdaFleet: nlpLambdaFleetSecret,
    nlpInternal: nlpInternalSecret,
  } as const;

  static async create(setup: WorkflowSetup): Promise<WorkflowModule> {
    const engine = composeEngine(setup);
    const datasets = setup.dependencies.datasets;
    const llmParameters = ModelProviderWorkflowLlmParameters.create({
      modelProviders: setup.dependencies.modelProviders,
    });
    const projectEnvironment = WorkflowProjectEnvironmentService.create({
      secrets: setup.dependencies.secrets,
    });
    const studioEvents = StudioEventPreparerService.create({
      datasets,
      agents: setup.dependencies.agents,
      projectEnvironment,
      llmParameters,
      runKeys: setup.dependencies.apiKeys,
      dispatchKeyFloorMs: dispatchKeyFloorMs({ onLambda: engine.fleet !== undefined }),
    });
    const attachmentLimits = WorkflowEngineAttachmentLimitService.create({ datasets });
    const nlpRuntime = attachmentLimits.limitedRuntime(engine.runtime);
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
      stream: attachmentLimits.limitedStream(engine.stream),
      modelProviders,
    });

    return new WorkflowModule({
      ...(engine.fleet ? { nlpLambdaFleet: engine.fleet } : {}),
      perProjectEngines: engine.perProjectEngines,
      permissions: WorkflowPermissionService.create({ authz: setup.dependencies.authz }),
      commitMessages: WorkflowCommitMessageService.create({ modelProviders }),
      codeCompletions: WorkflowCodeCompletionService.create({ modelProviders }),
      studioDispatch,
      studioRuns: studioDispatch,
      ...(setup.config.publicBaseUrl === undefined
        ? {}
        : { publicBaseUrl: setup.config.publicBaseUrl }),
      workflows,
      datasets,
      studioDsl: ModelProviderWorkflowStudioDslService.create({
        modelProviders: setup.dependencies.modelProviders,
      }),
      httpSecrets: WorkflowHttpSecretsService.create(setup.dependencies.secrets),
      agentMappings: WorkflowAgentMappingService.create({ agents: setup.dependencies.agents }),
      agents: setup.dependencies.agents,
      workflowRows: setup.repositories.workflowRows,
      lineage: lineageOf({
        rows: setup.repositories.lineage,
        linked: WorkflowLinkedRowsService.create({
          workflows,
          agents: setup.dependencies.agents,
        }),
      }),
      publications: publicationsOf(setup.repositories.lineage),
      signals: WorkflowSignalsService.create(),
      executeSyncRelay: WorkflowExecuteSyncRelayService.create({
        runtime: nlpRuntime,
        turnCeilingMs: relayTurnCeilingMs({ configured: setup.config.relayTurnCeilingMs }),
      }),
      lifecycle: buildWorkflowLifecyclePipeline(),
    });
  }

  #infrastructure: WorkflowInfrastructure;
  #lifecycleCommands: EventingCommands<WorkflowLifecyclePipeline> | undefined;
  #studioVersions: WorkflowStudioVersionService;
  #studioCopies: WorkflowStudioCopyService;
  #publication: WorkflowPublicationService;
  #copyLineage: WorkflowCopyLineageService;
  #agentCopies: WorkflowAgentCopyService;

  private constructor(infrastructure: WorkflowInfrastructure) {
    this.#infrastructure = infrastructure;
    this.#studioVersions = WorkflowStudioVersionService.create({
      workflows: infrastructure.workflows,
      studioDsl: infrastructure.studioDsl,
      httpSecrets: infrastructure.httpSecrets,
      agentMappings: infrastructure.agentMappings,
      recordVersionSaved: (input) => this.#recordVersionSaved(input),
    });
    this.#studioCopies = WorkflowStudioCopyService.create({
      datasets: infrastructure.datasets,
      rows: infrastructure.workflowRows,
    });
    this.#publication = WorkflowPublicationService.create({
      publications: infrastructure.publications,
    });
    this.#copyLineage = WorkflowCopyLineageService.create({
      lineage: infrastructure.lineage,
      permissions: infrastructure.permissions,
      workflows: infrastructure.workflows,
      studioVersions: this.#studioVersions,
    });
    this.#agentCopies = WorkflowAgentCopyService.create({
      agents: infrastructure.agents,
      permissions: infrastructure.permissions,
      workflows: infrastructure.workflows,
    });
  }

  // -- the workflow itself ---------------------------------------------------

  async executeComponent(input: ExecuteWorkflowComponentInput): Promise<ExecutionState> {
    const dispatch = this.#infrastructure.studioDispatch;

    if (!dispatch) throw new WorkflowExecutionFailedError();

    return dispatch.executeComponent(input);
  }

  /** Every non-archived workflow in the project. */
  list(input: { projectId: string }): Promise<Workflow[]> {
    return this.#infrastructure.workflows.list(input);
  }

  findEvaluatorWorkflows(input: {
    projectId: string;
  }): Promise<(Workflow & { versions: WorkflowVersion[] })[]> {
    return this.#infrastructure.workflows.findEvaluatorWorkflows(input);
  }

  /** One workflow, optionally with its current version. */
  getById(input: {
    id: string;
    projectId: string;
    includeVersion?: boolean;
  }): Promise<WorkflowWithVersion> {
    return this.#infrastructure.workflows.getById(input);
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
    return this.#infrastructure.workflows.assertInProject(input);
  }

  listSummaries(input: {
    projectId: string;
    workflowIds: string[];
  }): Promise<{ id: string; name: string }[]> {
    return this.#infrastructure.workflows.listSummaries(input);
  }

  async archiveLinked(input: WorkflowReference): Promise<{ id: string }> {
    const archived = await this.#infrastructure.workflows.archiveLinked(input);
    this.#recordArchived(input);
    return archived;
  }

  deleteUncommitted(input: WorkflowReference): Promise<void> {
    return this.#infrastructure.workflows.deleteUncommitted(input);
  }

  /**
   * One studio event, resolved against the project it will run in: its
   * environment, its LiteLLM parameters and the datasets it names.
   */
  prepareStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
    principal?: WorkflowRunPrincipal | undefined;
  }): Promise<StudioClientEvent> {
    return this.#infrastructure.workflows.prepareStudioEvent(input);
  }

  /** A peer's inbound Studio event, prepared the same way before it re-enters the graph. */
  enrichStudioEvent(input: {
    event: StudioClientEvent;
    projectId: string;
    principal?: WorkflowRunPrincipal | undefined;
  }): Promise<StudioClientEvent> {
    return this.#infrastructure.workflows.enrichStudioEvent(input);
  }

  /** The evaluator-fields shape a peer's guard and run read off this workflow. */
  getFields(input: { workflowId: string; projectId: string }): Promise<WorkflowEvaluatorFields> {
    return this.#infrastructure.workflows.getFields(input);
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
    const dsl = await this.#infrastructure.httpSecrets.store({
      projectId: input.projectId,
      dsl: input.dsl,
      authorId: by.id,
    });
    const created = await this.#infrastructure.workflows.create({ ...input, dsl, authorId: by.id });

    this.#recordCreated({ workflowId: created.workflow.id, projectId: input.projectId, by });
    this.#recordVersionSaved({
      projectId: input.projectId,
      workflowId: created.workflow.id,
      versionId: created.version.id,
      authorId: by.id,
    });

    return created;
  }

  /** Records the create with the project's workflow count, never failing or delaying it. */
  #recordCreated(input: { workflowId: string; projectId: string; by: WorkflowCaller }): void {
    const { workflowId, projectId, by } = input;
    void this.#infrastructure.workflows
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
      .catch((error: unknown) => this.#infrastructure.signals.failed(error, { projectId }));
  }

  /**
   * Records a version that was saved, restored or brought back with its workflow, with the
   * fields it offers while it is current; never failing or delaying the write.
   */
  #recordVersionSaved(input: {
    projectId: string;
    workflowId: string;
    versionId?: string;
    authorId?: string;
  }): void {
    const { projectId, workflowId, versionId, authorId } = input;
    void this.#infrastructure.workflows
      .findCurrentVersionFacts({ projectId, workflowId, versionId })
      .then(async (current) => {
        const commands = this.#lifecycleCommands;
        if (!commands) throw new Error("workflow_lifecycle pipeline senders are not connected yet");
        const facts =
          current.length > 0 || versionId === undefined || authorId === undefined
            ? current
            : [{ versionId, authorId, fields: undefined }];
        for (const fact of facts) {
          await commands.recordWorkflowVersionSaved.send({
            tenantId: projectId,
            occurredAt: nowInstant().epochMilliseconds,
            projectId,
            workflowId,
            versionId: fact.versionId,
            authorId: authorId ?? fact.authorId,
            ...(fact.fields ? { fields: fact.fields } : {}),
          });
        }
      })
      .catch((error: unknown) => this.#infrastructure.signals.failed(error, { projectId }));
  }

  /** Records an archived workflow, never failing or delaying the archive. */
  #recordArchived(input: WorkflowReference): void {
    void Promise.resolve()
      .then(() => {
        if (!this.#lifecycleCommands) {
          throw new Error("workflow_lifecycle pipeline senders are not connected yet");
        }
        return this.#lifecycleCommands.recordWorkflowArchived.send({
          tenantId: input.projectId,
          occurredAt: nowInstant().epochMilliseconds,
          ...input,
        });
      })
      .catch((error: unknown) =>
        this.#infrastructure.signals.failed(error, { projectId: input.projectId }),
      );
  }

  /** Records an archive, or the current version of a workflow brought back from one. */
  #recordArchiveChange(input: WorkflowReference & { unarchive?: boolean }): void {
    const { unarchive, ...reference } = input;
    if (unarchive) this.#recordVersionSaved(reference);
    else this.#recordArchived(reference);
  }

  /** The workflow lifecycle pipeline this module registers, built once by {@link create}. */
  lifecyclePipeline(): WorkflowLifecyclePipeline {
    return this.#infrastructure.lifecycle;
  }

  /** Binds the built lifecycle pipeline's own senders. */
  connectLifecycleCommands(commands: EventingCommands<WorkflowLifecyclePipeline>): void {
    this.#lifecycleCommands = commands;
  }

  /** Records a live workflow's current version with its fields, for the backfill; false if none. */
  async recordCurrentVersionFields(input: WorkflowReference): Promise<boolean> {
    const commands = this.#lifecycleCommands;
    if (!commands) throw new Error("workflow_lifecycle pipeline senders are not connected yet");
    const facts = await this.#infrastructure.workflows.findCurrentVersionFacts(input);
    for (const fact of facts) {
      await commands.recordWorkflowVersionSaved.send({
        tenantId: input.projectId,
        occurredAt: nowInstant().epochMilliseconds,
        ...input,
        ...fact,
      });
    }
    return facts.length > 0;
  }

  /** Archives an agent's graph once agent records the archive, from workflow's own side (§9). */
  agentArchiveCascadePipeline(): WorkflowAgentArchiveCascadePipeline {
    return buildWorkflowAgentArchiveCascadePipeline({
      workflows: {
        archiveIfLive: async (input) => {
          await this.#infrastructure.workflows.archiveIfLive(input);
          this.#recordArchived(input);
        },
      },
    });
  }

  /** This module's own application, which the browser door reads through. */
  workflows(): WorkflowApi {
    return this;
  }

  /** Copies an agent into another project, bringing a copy of a workflow agent's graph. */
  copyAgent(input: AgentApiCopyRequest, by: WorkflowCaller): Promise<AgentCopyCreated> {
    return this.#agentCopies.copyAgent(input, by);
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
    return this.#infrastructure.workflows.update(input);
  }

  /** The version history of one workflow. */
  getVersionHistory(input: {
    workflowId: string;
    projectId: string;
    mode: WorkflowVersionHistoryMode;
  }): Promise<WorkflowVersionHistoryEntry[]> {
    return this.#infrastructure.workflows.getVersionHistory(input);
  }

  /** Makes a stored version current again. */
  async restoreVersion(input: { versionId: string; projectId: string }): Promise<WorkflowVersion> {
    const version = await this.#infrastructure.workflows.restoreVersion(input);
    this.#recordVersionSaved({
      projectId: input.projectId,
      workflowId: version.workflowId,
      versionId: version.id,
    });
    return version;
  }

  /** Publishes one version, attributed to the caller who asked for it. */
  publish(input: Omit<PublishWorkflowCommand, "actorId">, by: WorkflowCaller): Promise<Workflow> {
    return this.#infrastructure.workflows.publish({ ...input, actorId: by.id });
  }

  /** Withdraws the published version. */
  unpublish(input: { id: string; projectId: string }): Promise<Workflow> {
    return this.#infrastructure.workflows.unpublish(input);
  }

  /** Archives one workflow, or restores it when `unarchive` is set. */
  async archive(input: ArchiveWorkflowCommand): Promise<Workflow> {
    const workflow = await this.#infrastructure.workflows.archive(input);
    this.#recordArchiveChange({
      workflowId: workflow.id,
      projectId: workflow.projectId,
      unarchive: input.unarchive,
    });
    return workflow;
  }

  /** Runs a workflow synchronously, on its published version unless one is named. */
  run(input: RunWorkflowCommand): Promise<WorkflowRunAnswer> {
    return this.#infrastructure.workflows.run(input);
  }

  async runSynchronous(input: RunWorkflowCommand): Promise<WorkflowRunAnswer> {
    try {
      return await this.#infrastructure.workflows.run(input);
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
    principal?: WorkflowRunPrincipal | undefined;
  }): Promise<WorkflowRunAnswer> {
    return this.#infrastructure.workflows.run({
      workflowId: input.workflowId,
      projectId: input.projectId,
      inputs: { ...input.body },
      principal: input.principal,
    });
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
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse> {
    try {
      return await this.#infrastructure.codeCompletions.complete({
        projectId: input.projectId,
        body: input.body,
      });
    } catch (error) {
      this.#infrastructure.signals.failed(error, { projectId: input.projectId });
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
    return this.#infrastructure.studioRuns.postEvent(input);
  }

  relayExecuteSync(input: {
    projectId: string;
    event: ExecuteSyncRelayEvent;
    signal: AbortSignal;
  }): Promise<Response> {
    return this.#infrastructure.executeSyncRelay.relay(input);
  }

  hasPerProjectEngines(): boolean {
    return this.#infrastructure.perProjectEngines === true;
  }

  reportStudioFailure(error: unknown, context: { projectId: string }): void {
    this.#infrastructure.signals.failed(error, context);
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

    const message = await this.#preparedForDispatch({
      event: eventWithoutEnvs,
      projectId,
      principal: { userId },
    });
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
    principal: WorkflowRunPrincipal;
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

    return this.#infrastructure.commitMessages.generate({
      projectId: input.projectId,
      previousDsl,
      nextDsl,
    });
  }

  // -- what the caller may see elsewhere -------------------------------------

  hasProjectPermission(input: {
    userId: string;
    projectId: string;
    permission: AuthzPermission;
  }): Promise<boolean> {
    return this.#infrastructure.permissions.has(input);
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
    const workflows = await this.#infrastructure.lineage.listWithCopyLineage({
      projectId: input.projectId,
    });

    const relatedProjectIds = [...new Set(workflows.flatMap(relatedProjectIdsOf))];
    const probed = await this.#infrastructure.permissions.hasMany({
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
    return this.#infrastructure.lineage.findWorkflow(input);
  }

  findCopiesWithPath(input: {
    workflowId: string;
    projectId: string;
  }): Promise<readonly WorkflowCopyWithPath[] | null> {
    return this.#infrastructure.lineage.findCopiesWithPath(input);
  }

  findWorkflowWithSource(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowSourceRow | null> {
    return this.#infrastructure.lineage.findWorkflowWithSource(input);
  }

  findWorkflowWithCopies(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowCopiesRow | null> {
    return this.#infrastructure.lineage.findWorkflowWithCopies(input);
  }

  findLatestVersionNumber(input: {
    workflowId: string;
    projectId: string;
  }): Promise<Readonly<{ version: string | null }> | null> {
    return this.#infrastructure.lineage.findLatestVersionNumber(input);
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
   * What archiving this workflow takes with it: the agents that run it. The browser names
   * the evaluators and their monitors from evaluator's and monitor's clients.
   */
  async getRelatedEntities(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowRelatedEntities> {
    // Copied out of the readonly view: the dialog types this list as a plain array.
    const agents = await this.#infrastructure.lineage.listAgents(input);

    return { agents: [...agents] };
  }

  /**
   * Archives the workflow and the agents that run it; evaluator archives the
   * evaluators it backs from the archived fact, and monitor deletes their
   * monitors from evaluator's, after a lag (plan §7).
   */
  async cascadeArchive(input: {
    projectId: string;
    workflowId: string;
    unarchive?: boolean;
  }): Promise<WorkflowCascadeArchive> {
    const archived = await this.#infrastructure.lineage.cascadeArchive(input);
    this.#recordArchiveChange(input);
    return archived;
  }

  // -- the Optimization Studio's publication flags ---------------------------

  findWorkflowFlags(input: {
    workflowId: string;
    projectId: string;
  }): Promise<WorkflowPublicationFlags | null> {
    return this.#infrastructure.publications.findFlags(input);
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
    return this.#infrastructure.publications.findVersion(input);
  }

  setWorkflowFlags(input: {
    workflowId: string;
    projectId: string;
    isComponent?: boolean;
    isEvaluator?: boolean;
  }): Promise<void> {
    return this.#infrastructure.publications.setFlags(input);
  }

  listPublishedComponents(input: { projectId: string }): Promise<unknown> {
    return this.#infrastructure.publications.listPublishedComponents(input);
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
    const fleet = this.#infrastructure.nlpLambdaFleet;
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
    return this.#infrastructure.workflowRows.countUsage(input);
  }

  platformUrl(input: { projectSlug: string; path: string }): string {
    if (this.#infrastructure.publicBaseUrl === undefined) {
      throw new Error(
        "The workflows REST family was asked for a platform link, but this deployment named no public base URL",
      );
    }

    return workflowPlatformUrl({ publicBaseUrl: this.#infrastructure.publicBaseUrl, ...input });
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
  principal?: WorkflowRunPrincipal | undefined;
  parentTrace?: { traceId: string; parentSpanId: string };
};

/** Where a workflow run executes: the module composes it over its own engine. */
export interface WorkflowExecution {
  execute(input: WorkflowExecutionInput): Promise<WorkflowRunAnswer>;
}

export type WorkflowNlpDispatchInput = {
  projectId: string;
  /** A studio event, or a scenario child's relayed event forwarded unread. */
  body: StudioClientEvent | ExecuteSyncRelayEvent;
  origin: WorkflowRunOrigin;
  causalityDepth?: number;
  parentTrace?: { traceId: string; parentSpanId: string };
  /** A deadline for the whole call; absent imposes none. */
  timeoutMs?: number;
  /** The caller's cancellation, which stops the engine call. */
  signal?: AbortSignal;
};

export type WorkflowNlpDispatchResponse = {
  ok: boolean;
  status: number;
  statusText: string;
  json(): Promise<unknown>;
  /** The engine's body unread; read once, instead of `json`. */
  text(): Promise<string>;
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

/** A run's decrypted secrets. */
export type WorkflowRunEnvironment = {
  secrets: Record<string, string>;
};

/** A Studio run's secrets; `workflow` is the graph whose secret references must be readable. */
export interface WorkflowProjectEnvironment {
  get(input: { projectId: string; workflow: StudioWorkflow }): Promise<WorkflowRunEnvironment>;
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
 * Stores the literal credentials of a Studio graph's HTTP nodes as project secrets and
 * answers the graph holding their `{{ secrets.NAME }}` references.
 */
export interface WorkflowHttpSecrets {
  store<Dsl extends { nodes?: unknown }>(input: {
    projectId: string;
    dsl: Dsl;
    authorId: string | undefined;
  }): Promise<Dsl>;
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
  if (error instanceof LlmModelNotSetError || error instanceof ApiKeyPermissionDeniedError) {
    return true;
  }
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
