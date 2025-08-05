import { type PromptService } from "./service";
import { type Prompt } from "./prompt";
import type { CreatePromptBody, UpdatePromptBody } from "../types";

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptFacade {
  private service: PromptService;

  constructor(service: PromptService) {
    this.service = service;
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
    if (options?.version) {
      return this.service.getVersion(handleOrId, options.version);
    }
    return this.service.get(handleOrId);
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
  async delete(handleOrId: string): Promise<void> {
    return this.service.delete(handleOrId);
  }
}
