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
export { DatasetError, DatasetNotFoundError, DatasetApiError, DatasetValidationError, DatasetPlanLimitError } from "./services/datasets";
export type { ExperimentRunResult, RunExperimentOptions } from "./services/experiments";
export {
  ExperimentsError,
  ExperimentNotFoundError,
  ExperimentTimeoutError,
  ExperimentRunFailedError,
  ExperimentsApiError,
} from "./services/experiments";
export type { EvaluationResult, EvaluateOptions, EvaluationStatus, EvaluationCost } from "./services/evaluations";
export {
  EvaluationError,
  EvaluatorCallError,
  EvaluatorNotFoundError,
  EvaluationsApiError,
} from "./services/evaluations";
export { EvaluatorsApiService, EvaluatorsApiError } from "./services/evaluators";
export { ScenariosApiService, ScenariosApiError } from "./services/scenarios";
export { SuitesApiService, SuitesApiError } from "./services/suites";
export { WorkflowsApiService, WorkflowsApiError } from "./services/workflows/workflows-api.service";
export { AgentsApiService, AgentsApiError } from "./services/agents/agents-api.service";
export { AnnotationsApiService, AnnotationsApiError } from "./services/annotations/annotations-api.service";
export { DashboardsApiService, DashboardsApiError } from "./services/dashboards/dashboards-api.service";
export { ModelProvidersApiService, ModelProvidersApiError } from "./services/model-providers/model-providers-api.service";
export { AnalyticsApiService, AnalyticsApiError } from "./services/analytics/analytics-api.service";
export { TriggersApiService, TriggersApiError } from "./services/triggers";
export { GraphsApiService, GraphsApiError } from "./services/graphs";
export { SimulationRunsApiService, SimulationRunsApiError } from "./services/simulation-runs";
export { TracesApiService, TracesApiError } from "./services/traces/traces-api.service";
export { MonitorsApiService, MonitorsApiError } from "./services/monitors";
export { SecretsApiService, SecretsApiError } from "./services/secrets";
import { LocalPromptsService } from "./services/prompts/local-prompts.service";
import { ExperimentsFacade } from "./services/experiments";
import { DatasetsFacade } from "./services/datasets";
import { EvaluationsFacade } from "./services/evaluations";
import { EvaluatorsApiService } from "./services/evaluators";
import { ScenariosApiService } from "./services/scenarios";
import { SuitesApiService } from "./services/suites";
import { WorkflowsApiService } from "./services/workflows/workflows-api.service";
import { AgentsApiService } from "./services/agents/agents-api.service";
import { AnnotationsApiService } from "./services/annotations/annotations-api.service";
import { DashboardsApiService } from "./services/dashboards/dashboards-api.service";
import { ModelProvidersApiService } from "./services/model-providers/model-providers-api.service";
import { AnalyticsApiService } from "./services/analytics/analytics-api.service";
import { TriggersApiService } from "./services/triggers";
import { GraphsApiService } from "./services/graphs";
import { SimulationRunsApiService } from "./services/simulation-runs";
import { MonitorsApiService } from "./services/monitors";
import { SecretsApiService } from "./services/secrets";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient, type LangwatchApiClient } from "../internal/api/client";
import { type Logger, NoOpLogger } from "../logger";
import { TracesFacade } from "./services/traces/facade";
import { DEFAULT_ENDPOINT } from "@/internal/constants";

export interface LangWatchConstructorOptions {
  apiKey?: string;
  endpoint?: string;
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

  constructor(options: LangWatchConstructorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = options.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;

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
  }

  get apiClient(): LangwatchApiClient {
    return this.config.langwatchApiClient;
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
