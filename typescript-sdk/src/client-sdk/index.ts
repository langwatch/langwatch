import { PromptsFacade, PromptsApiService } from "./services/prompts";
import { LocalPromptsService } from "./services/prompts/local-prompts.service";
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
  private readonly config: InternalConfig;

  readonly prompts: PromptsFacade;
  readonly traces: TracesFacade;

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
  }): InternalConfig {
    return {
      logger: options?.logger ?? new NoOpLogger(),
      langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    };
  }
}
