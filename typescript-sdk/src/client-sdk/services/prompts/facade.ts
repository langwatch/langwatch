import { PromptsService } from "./service";
import type { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody } from "./types";
import { InternalConfig } from "@/client-sdk/types";

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptsFacade {
  private readonly service: PromptsService;
  private readonly config: InternalConfig;

  constructor(config: InternalConfig) {
    this.config = config;
    this.service = new PromptsService(config);
  }

  /**
   * Creates a new prompt.
   * @param data The prompt creation payload.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(data: CreatePromptBody): Promise<Prompt> {
    return this.service.create(data);
  }

  /**
   * Retrieves a prompt by handle or ID.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param options Optional parameters for the request.
   * @returns The Prompt instance or null if not found.
   * @throws {PromptsError} If the API call fails.
   */
  async get(
    handleOrId: string,
    options?: { version?: string },
  ): Promise<Prompt | null> {
    return this.service.get(handleOrId, options);
  }

  /**
   * Updates an existing prompt.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param newData The update payload.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async update(handleOrId: string, newData: UpdatePromptBody): Promise<Prompt> {
    return this.service.update(handleOrId, newData);
  }

  /**
   * Deletes a prompt by handle or ID.
   * @param handleOrId The prompt's handle or unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async delete(handleOrId: string): Promise<{ success: boolean }> {
    return this.service.delete(handleOrId);
  }

  /**
   * Default configuration for the the prompts. This is used in the main sdk class.
   */
  static defaultOptions: InternalConfig["prompts"] = {
    defaultCacheTtlMs: 1000 * 60 * 60 * 24, // 5 minutes
  };
}
