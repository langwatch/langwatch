import { type CacheStore, InMemoryCacheStore } from "./cache";
import { PromptFacade as PromptsFacade } from "./services/prompts";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient } from "../internal/api/client";
import { type Logger, NoOpLogger } from "../logger";
import { TracesFacade } from "./services/traces/facade";
import { getLangWatchTracer, type LangWatchTracer } from "@/observability-sdk";
import { LANGWATCH_SDK_NAME_CLIENT, LANGWATCH_SDK_VERSION } from "@/internal/constants";

import { LANGWATCH_SDK_NAME_CLIENT, LANGWATCH_SDK_VERSION, DEFAULT_ENDPOINT } from "@/internal/constants";
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
  private readonly config: InternalConfig;
  private readonly tracer: LangWatchTracer = getLangWatchTracer(LANGWATCH_SDK_NAME_CLIENT, LANGWATCH_SDK_VERSION);

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

    this.prompts = new PromptsFacade(this.config);
    this.traces = new TracesFacade(this.config);
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
