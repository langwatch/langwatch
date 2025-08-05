import { type BaseRequestOptions, type InternalConfig } from "../types";

interface GetPromptOptions extends BaseRequestOptions {
  promptCacheTtlMs?: number;
}

export class PromptsService {
  readonly #config: InternalConfig;

  constructor(config: InternalConfig) {
    this.#config = config;
  }

  async get(handleOrId: string, options?: GetPromptOptions): Promise<void> {
    const { promptCacheTtlMs, ...rest } = options ?? {};

    // do request


  }

  static defaultOptions: InternalConfig["prompts"] = {
    defaultCacheTtlMs: 1000 * 60, // 1 minute
  };
}
