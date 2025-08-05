import { type CacheStore, InMemoryCacheStore } from "./cache";
import { PromptsFacade } from "./services/prompts";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient } from "../internal/api/client";
import { trace, Tracer } from "@opentelemetry/api";
import { EvaluationsFacade } from "./services/evaluations";
import { Logger, NoOpLogger } from "./logger";

const DEFAULT_ENDPOINT = "https://api.langwatch.com";

export interface LangWatchConstructorOptions {
  apiKey?: string;
  endpoint?: string;
  options?: {
    logger?: Logger;
    cacheStore?: CacheStore;
    prompts?: {
      defaultCacheTtlMs?: number;
    };
    evaluations?: {};
  };
}

export class LangWatch {
  readonly #config: InternalConfig;
  readonly #tracer: Tracer = trace.getTracer("langwatch");

  readonly evaluations: EvaluationsFacade;
  readonly prompts: PromptsFacade;

  constructor(options: LangWatchConstructorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = options.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;

    this.#config = this.#createInternalConfig({
      apiKey,
      endpoint,
      options: options.options,
    });

    this.evaluations = new EvaluationsFacade(this.#config);
    this.prompts = new PromptsFacade(this.#config);
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
      cacheStore: options?.cacheStore ?? new InMemoryCacheStore(),
      prompts: {
        ...PromptsFacade.defaultOptions,
        ...options?.prompts,
      },
      evaluations: {
        ...EvaluationsFacade.defaultOptions,
        ...options?.evaluations,
      },
      langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    };
  }
}
