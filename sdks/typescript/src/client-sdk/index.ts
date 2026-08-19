import { scopedApiKey } from "@/internal/credentialContext";
import { PromptsApiService, PromptsFacade } from "./services/prompts";

export {
  AgentsApiError,
  AgentsApiService,
} from "./services/agents/agents-api.service";
export {
  AnalyticsApiError,
  AnalyticsApiService,
} from "./services/analytics/analytics-api.service";
export {
  AnnotationsApiError,
  AnnotationsApiService,
} from "./services/annotations/annotations-api.service";
export {
  DashboardsApiError,
  DashboardsApiService,
} from "./services/dashboards/dashboards-api.service";
export type {
  BatchCreateRecordsResponse,
  CreateDatasetOptions,
  CreateFromUploadResponse,
  Dataset,
  DatasetColumnType,
  DatasetEntry,
  DatasetListItem,
  DatasetMetadata,
  DatasetRecordResponse,
  DeleteRecordsResponse,
  GetDatasetOptions,
  ListDatasetsApiResponse,
  ListDatasetsOptions,
  ListRecordsApiResponse,
  ListRecordsOptions,
  PaginatedResponse,
  Pagination,
  UpdateDatasetOptions,
  UploadResponse,
} from "./services/datasets";
export {
  DatasetApiError,
  DatasetError,
  DatasetNotFoundError,
  DatasetPlanLimitError,
  DatasetValidationError,
} from "./services/datasets";
export type {
  EvaluateOptions,
  EvaluationCost,
  EvaluationResult,
  EvaluationStatus,
} from "./services/evaluations";
export {
  EvaluationError,
  EvaluationsApiError,
  EvaluatorCallError,
  EvaluatorNotFoundError,
} from "./services/evaluations";
export {
  EvaluatorsApiError,
  EvaluatorsApiService,
} from "./services/evaluators";
export type {
  ExperimentRowResult,
  ExperimentRunResult,
  ExperimentRunWithResults,
  RunExperimentOptions,
  RunWithResultsOptions,
} from "./services/experiments";
export {
  ExperimentNotFoundError,
  ExperimentRunFailedError,
  ExperimentsApiError,
  ExperimentsError,
  ExperimentTimeoutError,
} from "./services/experiments";
export {
  GatewayBudgetsApiError,
  GatewayBudgetsApiService,
} from "./services/gateway-budgets/gateway-budgets-api.service";
export { GraphsApiError, GraphsApiService } from "./services/graphs";
export {
  ModelProvidersApiError,
  ModelProvidersApiService,
} from "./services/model-providers/model-providers-api.service";
export { MonitorsApiError, MonitorsApiService } from "./services/monitors";
export type {
  ArchivedProject,
  CreateProjectInput,
  PaginatedProjects,
  Project,
  ProjectWithServiceKey,
  UpdateProjectInput,
} from "./services/projects/projects-api.service";
export {
  ProjectsApiError,
  ProjectsApiService,
} from "./services/projects/projects-api.service";
export { FetchPolicy, type GetPromptOptions } from "./services/prompts";
export { ScenariosApiError, ScenariosApiService } from "./services/scenarios";
export { SecretsApiError, SecretsApiService } from "./services/secrets";
export {
  SimulationRunsApiError,
  SimulationRunsApiService,
} from "./services/simulation-runs";
export {
  SpendEventsApiError,
  SpendEventsApiService,
} from "./services/spend-events/spend-events-api.service";
export { SuitesApiError, SuitesApiService } from "./services/suites";
export type {
  ArchivedTeam,
  ListTeamsResponse,
  Team,
  TeamMember,
  TeamPagination,
} from "./services/teams/teams-api.service";
export {
  TeamsApiError,
  TeamsApiService,
} from "./services/teams/teams-api.service";
export {
  TracesApiError,
  TracesApiService,
} from "./services/traces/traces-api.service";
export { TriggersApiError, TriggersApiService } from "./services/triggers";
export {
  VirtualKeysApiError,
  VirtualKeysApiService,
} from "./services/virtual-keys/virtual-keys-api.service";
export {
  WebhooksApiError,
  WebhooksApiService,
} from "./services/webhooks/webhooks-api.service";
export {
  WorkflowsApiError,
  WorkflowsApiService,
} from "./services/workflows/workflows-api.service";

import { resolveEndpoint } from "@/internal/endpoint";
import {
  createLangWatchApiClient,
  type LangwatchApiClient,
} from "../internal/api/client";
import { type Logger, NoOpLogger } from "../logger";
import { AgentsApiService } from "./services/agents/agents-api.service";
import { AnalyticsApiService } from "./services/analytics/analytics-api.service";
import { AnnotationsApiService } from "./services/annotations/annotations-api.service";
import { DashboardsApiService } from "./services/dashboards/dashboards-api.service";
import { DatasetsFacade } from "./services/datasets";
import { EvaluationsFacade } from "./services/evaluations";
import { EvaluatorsApiService } from "./services/evaluators";
import { ExperimentsFacade } from "./services/experiments";
import { GatewayBudgetsApiService } from "./services/gateway-budgets/gateway-budgets-api.service";
import { GraphsApiService } from "./services/graphs";
import { ModelProvidersApiService } from "./services/model-providers/model-providers-api.service";
import { MonitorsApiService } from "./services/monitors";
import { ProjectsApiService } from "./services/projects/projects-api.service";
import { LocalPromptsService } from "./services/prompts/local-prompts.service";
import { ScenariosApiService } from "./services/scenarios";
import { SecretsApiService } from "./services/secrets";
import { SimulationRunsApiService } from "./services/simulation-runs";
import { SpendEventsApiService } from "./services/spend-events/spend-events-api.service";
import { SuitesApiService } from "./services/suites";
import { TeamsApiService } from "./services/teams/teams-api.service";
import { TracesFacade } from "./services/traces/facade";
import { TriggersApiService } from "./services/triggers";
import { VirtualKeysApiService } from "./services/virtual-keys/virtual-keys-api.service";
import { WebhooksApiService } from "./services/webhooks/webhooks-api.service";
import { WorkflowsApiService } from "./services/workflows/workflows-api.service";
import type { InternalConfig } from "./types";

export interface LangWatchConstructorOptions {
  apiKey?: string;
  endpoint?: string;
  options?: {
    logger?: Logger;
  };
}

export class LangWatch {
  private readonly config: InternalConfig & {
    endpoint: string;
    apiKey: string;
  };

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
  readonly suites: SuitesApiService;
  readonly workflows: WorkflowsApiService;
  readonly agents: AgentsApiService;
  readonly annotations: AnnotationsApiService;
  readonly dashboards: DashboardsApiService;
  readonly modelProviders: ModelProvidersApiService;
  readonly analytics: AnalyticsApiService;
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
    const apiKey =
      options.apiKey ?? scopedApiKey() ?? process.env.LANGWATCH_API_KEY ?? "";
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
    this.workflows = new WorkflowsApiService(this.config);
    this.agents = new AgentsApiService(this.config);
    this.annotations = new AnnotationsApiService(this.config);
    this.dashboards = new DashboardsApiService(this.config);
    this.modelProviders = new ModelProvidersApiService(this.config);
    this.analytics = new AnalyticsApiService(this.config);
    this.triggers = new TriggersApiService(this.config);
    this.graphs = new GraphsApiService(this.config);
    this.simulationRuns = new SimulationRunsApiService(this.config);
    this.monitors = new MonitorsApiService({ apiKey, endpoint });
    this.secrets = new SecretsApiService({ apiKey, endpoint });
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
