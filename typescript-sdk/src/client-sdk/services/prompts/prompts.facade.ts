import { PromptsApiService, type SyncResult } from "./prompts-api.service";
import { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody } from "./types";
import { type InternalConfig } from "@/client-sdk/types";
import { LocalPromptsService } from "./local-prompts.service";

interface PromptsFacadeDependencies {
  promptsApiService: PromptsApiService;
  localPromptsService: LocalPromptsService;
}

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptsFacade {
  private readonly promptsApiService: PromptsApiService;
  private readonly localPromptsService: LocalPromptsService;

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
    options?: { version?: string },
  ): Promise<Prompt> {
    const localPrompt = await this.localPromptsService.get(handleOrId);
    if (localPrompt) {
      return new Prompt(localPrompt);
    }
    const serverPrompt = await this.promptsApiService.get(handleOrId, options);
    return new Prompt(serverPrompt);
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

  /**
   * Deletes a prompt by handle or ID.
   * @param handleOrId The prompt's handle or unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async delete(handleOrId: string): Promise<{ success: boolean }> {
    return this.promptsApiService.delete(handleOrId);
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
    const syncResult = await this.promptsApiService.sync(params);
    return syncResult;
  }
}
