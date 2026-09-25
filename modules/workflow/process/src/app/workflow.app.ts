import { AgentApi } from "@langwatch/agent-contract";
import {
  AuthzApi,
  ProjectPermissionDeniedError,
  type AuthzPermission,
} from "@langwatch/authz-contract";
/**
 * The workflow module's application: what all five of its doors call. A caller
 * arrives as an argument, never read from a session or a request, so one
 * operation serves a browser session, an API key and a background job alike.
 */
import { DatasetApi } from "@langwatch/dataset-contract";
import { EvaluatorApi, newEvaluatorId, type Evaluator } from "@langwatch/evaluator-contract";
import { NotFoundError, ValidationError } from "@langwatch/handled-error";
import type { FeatureSetup } from "@langwatch/kernel";
import { generate } from "@langwatch/ksuid";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { reads, type MembersRead } from "@langwatch/process-stores/members";
import type { Instant } from "@langwatch/time";
import {
  clearDsl,
  recursiveAlphabeticallySortedKeys,
  NlpLambdaFleetNotComposedError,
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
} from "@langwatch/workflow-contract";

import { UnconfiguredWorkflowNlpRuntimeAdapter } from "../channels/http/http.workflow-nlp-runtime.channel.ts";
import {
  HttpWorkflowStudioStreamAdapter,
  UnconfiguredWorkflowStudioStreamAdapter,
} from "../channels/http/http.workflow-studio-stream.channel.ts";
import {
  workflowRepositories,
  type WorkflowRepositories,
} from "../repositories/workflow-repositories.registry.ts";
import type { WorkflowRowRepository } from "../repositories/workflow-row.repository.ts";
import { workflowPlatformUrl } from "../rules/workflow-platform-url.rules.ts";
import { NlpLambdaCleanupService } from "../services/nlp-lambda-cleanup.service.ts";
import { StudioEventPreparerService } from "../services/studio-event-preparer.service.ts";
import { WorkflowAgentMappingService } from "../services/workflow-agent-mapping.service.ts";
import { WorkflowCodeCompletionService } from "../services/workflow-code-completion.service.ts";
import { WorkflowCommitMessageService } from "../services/workflow-commit-message.service.ts";
import { WorkflowCopyLineageService } from "../services/workflow-copy-lineage.service.ts";
import { ContractWorkflowDslMigrationService } from "../services/workflow-dsl-migration.service.ts";
import { WorkflowNlpExecutionService } from "../services/workflow-nlp-execution.service.ts";
import { WorkflowPermissionService } from "../services/workflow-permission.service.ts";
import { WorkflowProjectEnvironmentService } from "../services/workflow-project-environment.service.ts";
import { WorkflowPublicationService } from "../services/workflow-publication.service.ts";
import { WorkflowStudioCopyService } from "../services/workflow-studio-copy.service.ts";
import { WorkflowStudioDispatchService } from "../services/workflow-studio-dispatch.service.ts";
import { ModelProviderWorkflowStudioDslService } from "../services/workflow-studio-dsl.service.ts";
import { WorkflowStudioVersionService } from "../services/workflow-studio-version.service.ts";
import { WorkflowService } from "../services/workflow.service.ts";

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
  }): Promise<void>;
}

/** Where a product signal and an unexpected failure go. */
export interface WorkflowSignals {
  workflowCreated(input: {
    userId: string;
    workflowCount: number;
    workflowId: string;
    projectId: string;
  }): void;
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
  /**
   * The account the studio's engines are deployed into, for the cron sweep.
   * Absent where the deployment fronts the engine with no Lambdas at all,
   * and the sweep then refuses by name rather than reporting a clean run.
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
>;

/** The engine address and public origin are process facts, not this module's env spellings. */
type WorkflowProcessFacts = Readonly<{
  nlpServiceUrl: string | undefined;
  publicBaseUrl: string | undefined;
}>;

type WorkflowSetup = FeatureSetup<
  typeof WorkflowApp.dependencies,
  WorkflowHostMembers & MembersRead<readonly ["prisma", "encryption"]> & WorkflowProcessFacts,
  WorkflowServerConfig,
  WorkflowRepositories
>;

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
  };
  static readonly config = workflowConfig;
  /**
   * `prisma` for `workflowRows`/`workflows`/`projectEnvironment`, via this
   * module's own `workflowRepositories` registry; `encryption` for decrypting
   * the project secrets `projectEnvironment` reads.
   */
  static readonly reads = [
    ...reads("prisma", "encryption"),
    "nlpServiceUrl",
    "publicBaseUrl",
  ] as const;
  static readonly repositories = workflowRepositories;

  static create(setup: WorkflowSetup): WorkflowApp {
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
    // `LANGWATCH_NLP_SERVICE` is model-provider's own leaf (config-schema-nuke-batch-c
    // handoff: a cross-module shared-fact collision, unresolved — always Unconfigured here).
    const nlpRuntime = UnconfiguredWorkflowNlpRuntimeAdapter.create();
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
      stream: setup.members.nlpServiceUrl
        ? HttpWorkflowStudioStreamAdapter.create({ serviceUrl: setup.members.nlpServiceUrl })
        : UnconfiguredWorkflowStudioStreamAdapter.create(),
      modelProviders,
    });

    return new WorkflowApp({
      ...setup.members,
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
    });
  }

  #members: WorkflowInfrastructure;
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
   * fires the product signal a project's new workflow raises. Attribution is
   * here because who wrote a version is a property of the act, not the door.
   */
  async create(
    input: Omit<CreateWorkflowCommand, "authorId">,
    by: WorkflowCaller,
  ): Promise<{ workflow: WorkflowWithVersion; version: WorkflowVersion }> {
    const created = await this.#members.workflows.create({ ...input, authorId: by.id });

    this.#announceCreated({ workflowId: created.workflow.id, projectId: input.projectId, by });

    return created;
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
        throw new NotFoundError("workflow_not_found", "Workflow", input.workflowId);
      }
      if (error instanceof WorkflowNotPublishedError) {
        throw new ValidationError("Workflow not published", {
          meta: { workflowId: input.workflowId },
        });
      }
      if (error instanceof WorkflowVersionNotFoundError) {
        throw new NotFoundError(
          "published_workflow_version_not_found",
          "Published workflow version",
          error.versionId,
        );
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
  triggerEvaluation(input: WorkflowEvaluationRequest): Promise<WorkflowEvaluationStarted> {
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
    userId: string;
    body: WorkflowRestEnvelope;
  }): Promise<WorkflowCodeCompletionResponse> {
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
  }): Promise<void> {
    return this.#members.studioRuns.postEvent(input);
  }

  reportStudioFailure(error: unknown, context: { projectId: string }): void {
    this.#members.signals.failed(error, context);
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

  /**
   * Sweeps the studio's quiet per-project NLP Lambda functions and log
   * groups. Refuses rather than reporting an empty sweep when no fleet was
   * composed — "nothing to delete" and "nothing was looked at" read alike.
   */
  async cleanupOldLambdas(): Promise<void> {
    const fleet = this.#members.nlpLambdaFleet;

    if (!fleet) throw new NlpLambdaFleetNotComposedError();

    await NlpLambdaCleanupService.create({ fleet }).sweep();
  }

  /**
   * Fire-and-forget: the count is read after the write landed, and a failure
   * to count must never fail the create that already succeeded.
   */
  #announceCreated(input: { workflowId: string; projectId: string; by: WorkflowCaller }): void {
    void this.#members.workflows
      .list({ projectId: input.projectId })
      .then((workflows) => {
        this.#members.signals.workflowCreated({
          userId: input.by.id,
          workflowCount: workflows.length,
          workflowId: input.workflowId,
          projectId: input.projectId,
        });
      })
      .catch((error: unknown) => {
        this.#members.signals.failed(error, { projectId: input.projectId });
      });
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
