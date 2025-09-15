import { PromptsApiService, type SyncResult } from "./prompts-api.service";
import { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody } from "./types";
import { type InternalConfig } from "@/client-sdk/types";
import { LocalPromptsService } from "./local-prompts.service";

interface PromptsFacadeDependencies {
  promptsService: PromptsApiService;
  localPromptsService: LocalPromptsService;
}

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptsFacade {
  private readonly promptsService: PromptsApiService;
  private readonly localPromptsService: LocalPromptsService;

  constructor(config: InternalConfig & PromptsFacadeDependencies) {
    this.promptsService = config.promptsService ?? new PromptsApiService(config);
    this.localPromptsService = config.localPromptsService ?? new LocalPromptsService();
  }

  /**
   * Creates a new prompt.
   * @param data The prompt creation payload.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(data: CreatePromptBody): Promise<Prompt> {
    return this.promptsService.create(data);
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
    const localPrompt = await this.localPromptsService.get(handleOrId);
    if (localPrompt) {
      return new Prompt(localPrompt);
    }
    return this.promptsService.get(handleOrId, options);
  }

  /**
   * Retrieves all prompts.
   * @returns Array of Prompt instances.
   * @throws {PromptsError} If the API call fails.
   */
  async getAll(): Promise<Prompt[]> {
    return this.promptsService.getAll();
  }

  /**
   * Updates an existing prompt.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param newData The update payload.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async update(handleOrId: string, newData: UpdatePromptBody): Promise<Prompt> {
    return this.promptsService.update(handleOrId, newData);
  }

  /**
   * Deletes a prompt by handle or ID.
   * @param handleOrId The prompt's handle or unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async delete(handleOrId: string): Promise<{ success: boolean }> {
    return this.promptsService.delete(handleOrId);
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
    return this.promptsService.sync(params);
  }
}
