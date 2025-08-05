import { trace, Tracer } from "@opentelemetry/api";
import { type BaseRequestOptions, type InternalConfig } from "../../types";

interface CreatePromptParams extends BaseRequestOptions { }
interface CreatePromptOptions extends BaseRequestOptions { }

interface GetPromptOptions extends BaseRequestOptions {
  promptCacheTtlMs?: number;
}

export class PromptsFacade {
  readonly #tracer: Tracer = trace.getTracer("langwatch.prompts");
  readonly #config: InternalConfig;

  constructor(config: InternalConfig) {
    this.#config = config;
  }

  async create(params: CreatePromptParams, options?: CreatePromptOptions): Promise<void> {
    const { ...rest } = options ?? {};

    // contact service
  }

  async get(handleOrId: string, options?: GetPromptOptions): Promise<void> {
    const { promptCacheTtlMs, ...rest } = options ?? {};

    // contact service
  }

  static defaultOptions: InternalConfig["prompts"] = {
    defaultCacheTtlMs: 1000 * 60, // 1 minute
  };
}
