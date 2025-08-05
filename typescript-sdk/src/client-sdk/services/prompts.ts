import { type InternalConfig } from "../types";

export class PromptsService {
  readonly #config: InternalConfig;

  constructor(config: InternalConfig) {
    this.#config = config;
  }

  static defaultOptions: InternalConfig["prompts"] = {
    defaultCacheTtlMs: 1000 * 60, // 1 minute
  };
}
