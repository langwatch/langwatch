import { type CacheStore, InMemoryCacheStore } from "./cache";
import { PromptsService } from "./services/prompts";
import { type InternalConfig } from "./types";
import { createLangWatchApiClient } from "../internal/api/client";

export interface LangWatchConstructorOptions {
  apiKey?: string;
  endpoint?: string;
  options?: {
    cacheStore?: CacheStore;
    prompts?: {
      defaultCacheTtlMs?: number;
    };
  };
}

export class LangWatch {
  readonly #config: InternalConfig;
  readonly prompts: PromptsService;

  constructor(options: LangWatchConstructorOptions = {}) {
    const apiKey = options.apiKey ?? process.env.LANGWATCH_API_KEY ?? "";
    const endpoint = options.endpoint ?? process.env.LANGWATCH_ENDPOINT ?? "https://api.langwatch.com";

    this.#config = this.#createInternalConfig({
      apiKey,
      endpoint,
      options: options.options,
    });

    this.prompts = new PromptsService(this.#config);
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
      cacheStore: options?.cacheStore ?? new InMemoryCacheStore(),
      prompts: {
        ...PromptsService.defaultOptions,
        ...options?.prompts,
      },
      langwatchApiClient: createLangWatchApiClient(apiKey, endpoint),
    };
  }
}
