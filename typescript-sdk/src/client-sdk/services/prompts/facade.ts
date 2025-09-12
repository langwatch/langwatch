import { PromptApiService, type SyncResult } from "./prompt-api.service";
import type { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody } from "./types";
import { type InternalConfig } from "@/client-sdk/types";

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptsFacade {
  private readonly service: PromptApiService;
  private readonly config: InternalConfig;

  constructor(config: InternalConfig) {
    this.config = config;
    this.service = new PromptApiService(config);
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
   * Retrieves all prompts.
   * @returns Array of Prompt instances.
   * @throws {PromptsError} If the API call fails.
   */
  async getAll(): Promise<Prompt[]> {
    return this.service.getAll();
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
   * Syncs a prompt with the server.
   * @param params The sync parameters.
   * @returns The sync result.
   * @throws {PromptsError} If the API call fails.
   */
  async sync(params: {
    name: string;
    configData: any;
    localVersion?: number;
    commitMessage?: string;
  }): Promise<SyncResult> {
    return this.service.sync(params);
  }
}
