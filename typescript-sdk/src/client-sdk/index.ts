import { PromptsFacade, PromptsApiService } from "./services/prompts";
export { FetchPolicy, type GetPromptOptions } from "./services/prompts";
export type { Dataset, DatasetEntry, GetDatasetOptions } from "./services/datasets";
export { DatasetError, DatasetNotFoundError, DatasetApiError } from "./services/datasets";
export type { EvaluationRunResult, RunEvaluationOptions } from "./services/evaluation";
export {
  EvaluationsError,
  EvaluationNotFoundError,
  EvaluationTimeoutError,
  EvaluationRunFailedError,
  EvaluationsApiError,
} from "./services/evaluation";
import { LocalPromptsService } from "./services/prompts/local-prompts.service";
import { EvaluationFacade } from "./services/evaluation";
import { DatasetsFacade } from "./services/datasets";
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
  readonly evaluation: EvaluationFacade;
  readonly datasets: DatasetsFacade;

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
    this.evaluation = new EvaluationFacade({
      langwatchApiClient: this.config.langwatchApiClient,
      endpoint: this.config.endpoint,
      apiKey: this.config.apiKey,
      logger: this.config.logger,
    });
    this.datasets = new DatasetsFacade({
      langwatchApiClient: this.config.langwatchApiClient,
      logger: this.config.logger,
    });
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
