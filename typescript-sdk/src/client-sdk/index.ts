import { type CacheStore, InMemoryCacheStore } from "./cache";
import { PromptFacade } from "./services/prompts";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient } from "../internal/api/client";
import { Logger, NoOpLogger } from "../logger";
import { TracesFacade } from "./services/traces/facade";
import { DataCaptureOptions, getLangWatchTracer, LangWatchTracer } from "@/observability-sdk";

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

    observability?: {
      dataCapture?: DataCaptureOptions;
    },
  };
}

export class LangWatch {
  readonly #config: InternalConfig;
  readonly #tracer: LangWatchTracer = getLangWatchTracer("langwatch");

  readonly prompts: PromptFacade;
  readonly traces: TracesFacade;

  constructor(options: LangWatchConstructorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = options.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? DEFAULT_ENDPOINT;

    this.#config = this.#createInternalConfig({
      apiKey,
      endpoint,
      options: options.options,
    });

    this.prompts = new PromptFacade(this.#config);
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
        ...PromptFacade.defaultOptions,
        ...options?.prompts,
      },
      traces: {
        ...TracesFacade.defaultOptions,
        ...options?.traces,
      },
      observability: {
        dataCapture: options?.observability?.dataCapture ?? "all",
      },
      langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    };
  }
}
