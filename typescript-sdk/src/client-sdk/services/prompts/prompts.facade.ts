import { PromptsApiService, type AssignLabelResult } from "./prompts-api.service";
import { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody, PromptData, LabelDefinition, CreatedLabel } from "./types";
import { FetchPolicy } from "./types";
import { type InternalConfig } from "@/client-sdk/types";
import { LocalPromptsService } from "./local-prompts.service";
import { PromptsError } from "./errors";

/**
 * Options for fetching a prompt.
 */
export interface GetPromptOptions {
  /** Specific version to fetch */
  version?: string;
  /** Label to fetch (e.g., "production", "staging", or a custom label) */
  label?: string;
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
  readonly labels: {
    assign(id: string, params: { label: string; versionId: string }): Promise<AssignLabelResult>;
    list(): Promise<LabelDefinition[]>;
    create(params: { name: string }): Promise<CreatedLabel>;
    delete(labelId: string): Promise<void>;
  };

  constructor(config: InternalConfig & PromptsFacadeDependencies) {
    this.promptsApiService = config.promptsApiService ?? new PromptsApiService(config);
    this.localPromptsService = config.localPromptsService ?? new LocalPromptsService();
    this.labels = {
      assign: (id, { label, versionId }) =>
        this.promptsApiService.assignLabel({ id, label, versionId }),
      list: () => this.promptsApiService.listLabels(),
      create: ({ name }) => this.promptsApiService.createLabel({ name }),
      delete: (labelId) => this.promptsApiService.deleteLabel(labelId),
    };
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
   *
   * Supports shorthand `handle:label` syntax — e.g. `get("pizza-prompt:production")`.
   * Shorthand is parsed server-side; the SDK passes the string through as-is.
   *
   * @param handleOrId The prompt's handle, unique identifier, or `handle:label` shorthand.
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
      throw new PromptsError(`Prompt "${handleOrId}" not found locally or on server`);
    }
  }

  private async getMaterializedOnly(handleOrId: string): Promise<Prompt> {
    const localPrompt = await this.localPromptsService.get(handleOrId);
    if (localPrompt) {
      return new Prompt(localPrompt);
    }
    throw new PromptsError(`Prompt "${handleOrId}" not found in materialized files`);
  }

  private buildCacheKey(handleOrId: string, options?: GetPromptOptions): string {
    const labelSegment = options?.label != null ? `::label:${options.label}` : '';
    return `${handleOrId}::version:${options?.version ?? ''}${labelSegment}`;
  }

  private async getCacheTtl(
    handleOrId: string,
    options?: GetPromptOptions,
  ): Promise<Prompt> {
    const cacheKey = this.buildCacheKey(handleOrId, options);
    const ttlMs = (options?.cacheTtlMinutes ?? 5) * 60 * 1000;
    const cached = this.cache.get(cacheKey);
    const now = Date.now();

    if (cached && now - cached.timestamp < ttlMs) {
      return new Prompt(cached.data);
    }

    try {
      const serverPrompt = await this.promptsApiService.get(handleOrId, options);
      this.cache.set(cacheKey, { data: serverPrompt, timestamp: now });
      return new Prompt(serverPrompt);
    } catch {
      const localPrompt = await this.localPromptsService.get(handleOrId);
      if (localPrompt) {
        return new Prompt(localPrompt);
      }
      throw new PromptsError(`Prompt "${handleOrId}" not found locally or on server`);
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
