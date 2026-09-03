import { scopedApiKey } from "@/internal/credentialContext";
import { PromptsFacade, PromptsApiService } from "./services/prompts";
export { FetchPolicy, type GetPromptOptions } from "./services/prompts";
export type {
  Dataset,
  DatasetEntry,
  DatasetMetadata,
  DatasetColumnType,
  DatasetListItem,
  Pagination,
  PaginatedResponse,
  GetDatasetOptions,
  ListDatasetsOptions,
  ListDatasetsApiResponse,
  ListRecordsOptions,
  ListRecordsApiResponse,
  CreateDatasetOptions,
  UpdateDatasetOptions,
  CreateFromUploadResponse,
  BatchCreateRecordsResponse,
  DeleteRecordsResponse,
  UploadResponse,
  DatasetRecordResponse,
} from "./services/datasets";
export {
  DatasetError,
  DatasetNotFoundError,
  DatasetApiError,
  DatasetValidationError,
  DatasetPlanLimitError,
} from "./services/datasets";
export type {
  ExperimentRunResult,
  RunExperimentOptions,
  RunWithResultsOptions,
  ExperimentRowResult,
  ExperimentRunWithResults,
} from "./services/experiments";
export {
  ExperimentsError,
  ExperimentNotFoundError,
  ExperimentTimeoutError,
  ExperimentRunFailedError,
  ExperimentsApiError,
} from "./services/experiments";
export type {
  EvaluationResult,
  EvaluateOptions,
  EvaluationStatus,
  EvaluationCost,
} from "./services/evaluations";
export {
  EvaluationError,
  EvaluatorCallError,
  EvaluatorNotFoundError,
  EvaluationsApiError,
} from "./services/evaluations";
export { EvaluatorsApiService, EvaluatorsApiError } from "./services/evaluators";
export { ScenariosApiService, ScenariosApiError } from "./services/scenarios";
export { SuitesApiService, SuitesApiError } from "./services/suites";
export { RunPlansApiService, RunPlansApiError } from "./services/run-plans";
export { TestSuitesApiService, TestSuitesApiError } from "./services/test-suites";
export { WorkflowsApiService, WorkflowsApiError } from "./services/workflows/workflows-api.service";
export { AgentsApiService, AgentsApiError } from "./services/agents/agents-api.service";
export {
  AnnotationsApiService,
  AnnotationsApiError,
} from "./services/annotations/annotations-api.service";
export {
  DashboardsApiService,
  DashboardsApiError,
} from "./services/dashboards/dashboards-api.service";
export {
  ModelProvidersApiService,
  ModelProvidersApiError,
} from "./services/model-providers/model-providers-api.service";
export { AnalyticsApiService, AnalyticsApiError } from "./services/analytics/analytics-api.service";
export { QueryApiService, QueryApiError } from "./services/query/query-api.service";
export { TriggersApiService, TriggersApiError } from "./services/triggers";
export { GraphsApiService, GraphsApiError } from "./services/graphs";
export { SimulationRunsApiService, SimulationRunsApiError } from "./services/simulation-runs";
export { TracesApiService, TracesApiError } from "./services/traces/traces-api.service";
export { MonitorsApiService, MonitorsApiError } from "./services/monitors";
export { SecretsApiService, SecretsApiError } from "./services/secrets";
export {
  VirtualKeysApiService,
  VirtualKeysApiError,
} from "./services/virtual-keys/virtual-keys-api.service";
export {
  GatewayBudgetsApiService,
  GatewayBudgetsApiError,
} from "./services/gateway-budgets/gateway-budgets-api.service";
export {
  SpendEventsApiService,
  SpendEventsApiError,
} from "./services/spend-events/spend-events-api.service";
export { WebhooksApiService, WebhooksApiError } from "./services/webhooks/webhooks-api.service";
export { TeamsApiService, TeamsApiError } from "./services/teams/teams-api.service";
export type {
  Team,
  TeamPagination,
  TeamMember,
  ListTeamsResponse,
  ArchivedTeam,
} from "./services/teams/teams-api.service";
export { ProjectsApiService, ProjectsApiError } from "./services/projects/projects-api.service";
export type {
  Project,
  PaginatedProjects,
  ProjectWithServiceKey,
  ArchivedProject,
  CreateProjectInput,
  UpdateProjectInput,
} from "./services/projects/projects-api.service";
import { LocalPromptsService } from "./services/prompts/local-prompts.service";
import { ExperimentsFacade } from "./services/experiments";
import { DatasetsFacade } from "./services/datasets";
import { EvaluationsFacade } from "./services/evaluations";
import { EvaluatorsApiService } from "./services/evaluators";
import { ScenariosApiService } from "./services/scenarios";
import { SuitesApiService } from "./services/suites";
import { RunPlansApiService } from "./services/run-plans";
import { TestSuitesApiService } from "./services/test-suites";
import { WorkflowsApiService } from "./services/workflows/workflows-api.service";
import { AgentsApiService } from "./services/agents/agents-api.service";
import { AnnotationsApiService } from "./services/annotations/annotations-api.service";
import { DashboardsApiService } from "./services/dashboards/dashboards-api.service";
import { ModelProvidersApiService } from "./services/model-providers/model-providers-api.service";
import { AnalyticsApiService } from "./services/analytics/analytics-api.service";
import { QueryApiService } from "./services/query/query-api.service";
import { TriggersApiService } from "./services/triggers";
import { GraphsApiService } from "./services/graphs";
import { SimulationRunsApiService } from "./services/simulation-runs";
import { MonitorsApiService } from "./services/monitors";
import { SecretsApiService } from "./services/secrets";
import { VirtualKeysApiService } from "./services/virtual-keys/virtual-keys-api.service";
import { GatewayBudgetsApiService } from "./services/gateway-budgets/gateway-budgets-api.service";
import { SpendEventsApiService } from "./services/spend-events/spend-events-api.service";
import { WebhooksApiService } from "./services/webhooks/webhooks-api.service";
import { TeamsApiService } from "./services/teams/teams-api.service";
import { ProjectsApiService } from "./services/projects/projects-api.service";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "../internal/api/client";
import { type Logger, NoOpLogger } from "../logger";
import { TracesFacade } from "./services/traces/facade";
import { resolveEndpoint } from "@/internal/endpoint";

export interface LangWatchConstructorOptions {
  apiKey?: string;
  endpoint?: string;
  projectId?: string;
  options?: {
    logger?: Logger;
  };
}

export class LangWatch {
  private readonly config: InternalConfig & { endpoint: string; apiKey: string };

  readonly prompts: PromptsFacade;
  readonly traces: TracesFacade;
  readonly datasets: DatasetsFacade;

  /**
   * Run experiments on LangWatch platform or via SDK.
   *
   * Platform experiments (CI/CD):
   * ```typescript
   * const result = await langwatch.experiments.run("my-experiment-slug");
   * result.printSummary();
   * ```
   *
   * SDK-defined experiments:
   * ```typescript
   * const experiment = await langwatch.experiments.init("my-experiment");
   * // ... run evaluators using experiment.evaluate()
   * ```
   */
  readonly experiments: ExperimentsFacade;

  /**
   * Run evaluators and guardrails in real-time (Online Evaluations).
   *
   * @example
   * ```typescript
   * const guardrail = await langwatch.evaluations.evaluate("presidio/pii_detection", {
   *   data: { input: userInput, output: generatedResponse },
   *   name: "PII Detection",
   *   asGuardrail: true,
   * });
   *
   * if (!guardrail.passed) {
   *   return "I'm sorry, I can't do that.";
   * }
   * ```
   */
  readonly evaluations: EvaluationsFacade;

  readonly evaluators: EvaluatorsApiService;
  readonly scenarios: ScenariosApiService;
  /**
   * @deprecated Use runPlans and testSuites; /api/suites is a frozen alias.
   */
  readonly suites: SuitesApiService;
  readonly runPlans: RunPlansApiService;
  readonly testSuites: TestSuitesApiService;
  readonly workflows: WorkflowsApiService;
  readonly agents: AgentsApiService;
  readonly annotations: AnnotationsApiService;
  readonly dashboards: DashboardsApiService;
  readonly modelProviders: ModelProvidersApiService;
  readonly analytics: AnalyticsApiService;
  /** The raw LangWatchQL door — run a governed SELECT or discover the analytics schema directly, outside a saved chart. */
  readonly query: QueryApiService;
  readonly triggers: TriggersApiService;
  readonly graphs: GraphsApiService;
  readonly simulationRuns: SimulationRunsApiService;
  readonly monitors: MonitorsApiService;
  readonly secrets: SecretsApiService;
  readonly virtualKeys: VirtualKeysApiService;
  readonly gatewayBudgets: GatewayBudgetsApiService;
  readonly spendEvents: SpendEventsApiService;
  readonly webhooks: WebhooksApiService;

  #teams?: TeamsApiService;
  #projects?: ProjectsApiService;

  constructor(options: LangWatchConstructorOptions = {}) {
    const apiKey = options.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = resolveEndpoint(options.endpoint);

    this.config = this.#createInternalConfig({
      apiKey,
      endpoint,
      options: options.options,
    });

    this.prompts = new PromptsFacade({
      promptsApiService: new PromptsApiService(this.config),
      localPromptsService: new LocalPromptsService(),
      ...this.config,
    });
    this.traces = new TracesFacade(this.config);

    this.experiments = new ExperimentsFacade({
      langwatchApiClient: this.config.langwatchApiClient,
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      logger: this.config.logger,
    });

    this.datasets = new DatasetsFacade({
      langwatchApiClient: this.config.langwatchApiClient,
      logger: this.config.logger,
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
    });

    this.evaluations = new EvaluationsFacade({
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      logger: this.config.logger,
    });

    this.evaluators = new EvaluatorsApiService(this.config);
    this.scenarios = new ScenariosApiService(this.config);
    this.suites = new SuitesApiService(this.config);
    this.runPlans = new RunPlansApiService(this.config);
    this.testSuites = new TestSuitesApiService(this.config);
    this.workflows = new WorkflowsApiService(this.config);
    this.agents = new AgentsApiService(this.config);
    this.annotations = new AnnotationsApiService(this.config);
    this.dashboards = new DashboardsApiService(this.config);
    this.modelProviders = new ModelProvidersApiService(this.config);
    this.analytics = new AnalyticsApiService(this.config);
    this.query = new QueryApiService(this.config);
    this.triggers = new TriggersApiService(this.config);
    this.graphs = new GraphsApiService(this.config);
    this.simulationRuns = new SimulationRunsApiService(this.config);
    this.monitors = new MonitorsApiService({ apiKey, endpoint });
    this.secrets = new SecretsApiService({
      apiKey,
      endpoint,
      projectId: options.projectId,
    });
    this.virtualKeys = new VirtualKeysApiService({ apiKey, endpoint });
    this.gatewayBudgets = new GatewayBudgetsApiService({ apiKey, endpoint });
    this.spendEvents = new SpendEventsApiService({ apiKey, endpoint });
    this.webhooks = new WebhooksApiService({ apiKey, endpoint });
  }

  get apiClient(): LangwatchApiClient {
    return this.config.langwatchApiClient;
  }

  /**
   * Teams, which group projects and the members who can reach them. These
   * routes want an organization API key.
   *
   * Built on first use rather than in the constructor: the management
   * families resolve their credential when constructed and refuse an empty
   * one, so building this eagerly would make `new LangWatch()` throw for
   * every caller that never touches a team.
   */
  get teams(): TeamsApiService {
    this.#teams ??= new TeamsApiService(this.#managementConfig());
    return this.#teams;
  }

  /**
   * Projects, including provisioning one with its own service API key. These
   * routes want an organization API key.
   */
  get projects(): ProjectsApiService {
    this.#projects ??= new ProjectsApiService(this.#managementConfig());
    return this.#projects;
  }

  /**
   * What the management families are constructed with. An empty key is left
   * off entirely so they resolve the ambient credential instead of
   * authenticating with a blank bearer token.
   */
  #managementConfig(): { apiKey?: string; endpoint: string } {
    return {
      ...(this.config.apiKey ? { apiKey: this.config.apiKey } : {}),
      endpoint: this.config.endpoint,
    };
  }

  #createInternalConfig({
    apiKey,
    endpoint,
    options,
  }: {
    apiKey: string;
    endpoint: string;
    options?: LangWatchConstructorOptions["options"];
  }): InternalConfig & { endpoint: string; apiKey: string } {
    return {
      logger: options?.logger ?? new NoOpLogger(),
      langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
      endpoint,
      apiKey,
    };
  }
}
