import { PromptApiService, type SyncResult } from "./prompt-api.service";
import { Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody } from "./types";
import { type InternalConfig } from "@/client-sdk/types";
import { LocalPromptRepository } from "@/shared/prompts/local-prompt.repository";

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptsFacade {
  private readonly service: PromptApiService;
  private readonly localPromptRepository: LocalPromptRepository;

  constructor(config: InternalConfig) {
    this.service = new PromptApiService(config);
    this.localPromptRepository = new LocalPromptRepository();
  }

  /**
   * Creates a new prompt.
   * @param data The prompt creation payload.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(data: CreatePromptBody): Promise<Prompt> {
    const prompt = await this.service.create(data);
    return new Prompt(prompt);
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
    const localPrompt = await this.localPromptRepository.loadPrompt(handleOrId);
    if (localPrompt) return new Prompt(localPrompt);
    const prompt = await this.service.get(handleOrId, options);
    if (!prompt) return null;
    return new Prompt(prompt);
  }

  /**
   * Retrieves all prompts.
   * @returns Array of Prompt instances.
   * @throws {PromptsError} If the API call fails.
   */
  async getAll(): Promise<Prompt[]> {
    const prompts = await this.service.getAll();
    return prompts.map((prompt) => new Prompt(prompt));
  }

  /**
   * Updates an existing prompt.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param newData The update payload.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async update(handleOrId: string, newData: UpdatePromptBody): Promise<Prompt> {
    const prompt = await this.service.update(handleOrId, newData);
    return new Prompt(prompt);
  }

  /**
   * Deletes a prompt by handle or ID.
   * @param handleOrId The prompt's handle or unique identifier.
   * @throws {PromptsError} If the API call fails.
   */
  async delete(handleOrId: string): Promise<{ success: boolean }> {
    const result = await this.service.delete(handleOrId);
    return result;
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
    const result = await this.service.sync(params);
    return result;
  }
}
