import { PromptService } from "./service";
import { type Prompt } from "./prompt";
import type { CreatePromptBodyV2, UpdatePromptBody } from "./types";
import { PromptServiceTracingDecorator } from "./prompt-service-tracing.decorator";
import { PromptTracingDecorator } from "./prompt-tracing.decorator";

/**
 * Facade for prompt operations in the LangWatch SDK.
 * Provides a simplified interface for common prompt management tasks.
 */
export class PromptFacade {
  private service: PromptService;

  constructor(service?: PromptService) {
    this.service = service ?? PromptService.getInstance();
  }

  /**
   * Creates a new prompt.
   * @param data The prompt creation payload.
   * @returns The created Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async create(data: CreatePromptBodyV2): Promise<PromptTracingDecorator> {
    const prompt = await this.service.create(data);
    return new PromptTracingDecorator(prompt);
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
  ): Promise<PromptTracingDecorator | null> {
    const service = new PromptServiceTracingDecorator(this.service);
    const prompt = await service.get(handleOrId, options);
    return prompt ? new PromptTracingDecorator(prompt) : null;
  }

  /**
   * Updates an existing prompt.
   * @param handleOrId The prompt's handle or unique identifier.
   * @param newData The update payload.
   * @returns The updated Prompt instance.
   * @throws {PromptsError} If the API call fails.
   */
  async update(
    handleOrId: string,
    newData: UpdatePromptBody,
  ): Promise<PromptTracingDecorator> {
    const prompt = await this.service.update(handleOrId, newData);
    return new PromptTracingDecorator(prompt);
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
