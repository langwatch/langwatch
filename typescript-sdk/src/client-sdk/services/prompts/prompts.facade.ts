import { PromptsApiService, type SyncResult } from "./prompts-api.service";
import { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody, PromptData } from "./types";
import { FetchPolicy } from "./types";
import { type InternalConfig } from "@/client-sdk/types";
import { LocalPromptsService } from "./local-prompts.service";

/**
 * Options for fetching a prompt.
 */
export interface GetPromptOptions {
  /** Specific version to fetch */
  version?: string;
  /** Fetch policy to use */
  fetchPolicy?: FetchPolicy;
  /** Cache TTL in minutes (only used with CACHE_TTL policy) */
  cacheTtlMinutes?: number;
}

interface CacheEntry {
  data: PromptData;
  timestamp: number;
}

interface PromptsFacadeDependencies {
  promptsApiService: PromptsApiService;
  localPromptsService: LocalPromptsService;
}

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptsFacade implements Pick<PromptsApiService, "sync" | "delete">{
  private readonly promptsApiService: PromptsApiService;
  private readonly localPromptsService: LocalPromptsService;
  private readonly cache = new Map<string, CacheEntry>();

  constructor(config: InternalConfig & PromptsFacadeDependencies) {
    this.promptsApiService = config.promptsApiService ?? new PromptsApiService(config);
    this.localPromptsService = config.localPromptsService ?? new LocalPromptsService();
  }

  /**
   * Creates a new prompt.
   * @param data The prompt creation payload.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(data: CreatePromptBody): Promise<Prompt> {
    const serverPrompt = await this.promptsApiService.create(data);
    return new Prompt(serverPrompt);
  }

  /**
   * Retrieves a prompt by handle or ID.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param options Optional parameters for the request.
   * @returns The Prompt instance.
   * @throws {PromptsError} If the prompt is not found or the API call fails.
   */
  async get(
    handleOrId: string,
    options?: GetPromptOptions,
  ): Promise<Prompt> {
    const fetchPolicy = options?.fetchPolicy ?? FetchPolicy.MATERIALIZED_FIRST;

    switch (fetchPolicy) {
      case FetchPolicy.MATERIALIZED_ONLY:
        return this.getMaterializedOnly(handleOrId);

      case FetchPolicy.ALWAYS_FETCH:
        return this.getAlwaysFetch(handleOrId, options);

      case FetchPolicy.CACHE_TTL:
        return this.getCacheTtl(handleOrId, options);

      case FetchPolicy.MATERIALIZED_FIRST:
      default:
        return this.getMaterializedFirst(handleOrId, options);
    }
  }

  private async getMaterializedFirst(
    handleOrId: string,
    options?: GetPromptOptions,
  ): Promise<Prompt> {
    const localPrompt = await this.localPromptsService.get(handleOrId);
    if (localPrompt) {
      return new Prompt(localPrompt);
    }
    const serverPrompt = await this.promptsApiService.get(handleOrId, options);
    return new Prompt(serverPrompt);
  }

  private async getAlwaysFetch(
    handleOrId: string,
    options?: GetPromptOptions,
  ): Promise<Prompt> {
    try {
      const serverPrompt = await this.promptsApiService.get(handleOrId, options);
      return new Prompt(serverPrompt);
    } catch {
      const localPrompt = await this.localPromptsService.get(handleOrId);
      if (localPrompt) {
        return new Prompt(localPrompt);
      }
      throw new Error(`Prompt "${handleOrId}" not found locally or on server`);
    }
  }

  private async getMaterializedOnly(handleOrId: string): Promise<Prompt> {
    const localPrompt = await this.localPromptsService.get(handleOrId);
    if (localPrompt) {
      return new Prompt(localPrompt);
    }
    throw new Error(`Prompt "${handleOrId}" not found in materialized files`);
  }

  private async getCacheTtl(
    handleOrId: string,
    options?: GetPromptOptions,
  ): Promise<Prompt> {
    const ttlMs = (options?.cacheTtlMinutes ?? 5) * 60 * 1000;
    const cached = this.cache.get(handleOrId);
    const now = Date.now();

    if (cached && now - cached.timestamp < ttlMs) {
      return new Prompt(cached.data);
    }

    try {
      const serverPrompt = await this.promptsApiService.get(handleOrId, options);
      this.cache.set(handleOrId, { data: serverPrompt, timestamp: now });
      return new Prompt(serverPrompt);
    } catch {
      const localPrompt = await this.localPromptsService.get(handleOrId);
      if (localPrompt) {
        return new Prompt(localPrompt);
      }
      throw new Error(`Prompt "${handleOrId}" not found locally or on server`);
    }
  }

  /**
   * Retrieves all prompts.
   * @returns Array of Prompt instances.
   * @throws {PromptsError} If the API call fails.
   */
  async getAll(): Promise<Prompt[]> {
    const serverPrompts = await this.promptsApiService.getAll();
    return serverPrompts.map((prompt) => new Prompt(prompt));
  }

  /**
   * Updates an existing prompt.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param newData The update payload.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async update(handleOrId: string, newData: UpdatePromptBody): Promise<Prompt> {
    const serverPrompt = await this.promptsApiService.update(handleOrId, newData);
    return new Prompt(serverPrompt);
  }

  get delete() {
    return this.promptsApiService.delete.bind(this.promptsApiService);
  }

  /**
   * Delegated method to the prompts API service.
   */
  get sync() {
    return this.promptsApiService.sync.bind(this.promptsApiService);
  }
}
