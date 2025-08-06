import { type CacheStore, InMemoryCacheStore } from "./cache";
import { PromptsFacade } from "./services/prompts";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient } from "../internal/api/client";
import { trace, Tracer } from "@opentelemetry/api";
import { Logger, NoOpLogger } from "../logger";
import { TracesFacade } from "./services/traces/facade";

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
    traces?: {},
  };
}

export class LangWatch {
  readonly #config: InternalConfig;
  readonly #tracer: Tracer = trace.getTracer("langwatch");

  readonly prompts: PromptsFacade;
  readonly traces: TracesFacade;

  constructor(options: LangWatchConstructorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = options.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;

    this.#config = this.#createInternalConfig({
      apiKey,
      endpoint,
      options: options.options,
    });

    this.prompts = new PromptsFacade(this.#config);
    this.traces = new TracesFacade(this.#config);
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
      traces: {
        ...TracesFacade.defaultOptions,
        ...options?.traces,
      },
      langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    };
  }
}
