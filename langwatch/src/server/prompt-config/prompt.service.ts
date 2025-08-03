import {
  type PromptScope,
  type LlmPromptConfig,
  type PrismaClient,
} from "@prisma/client";

import { type UpdateLlmConfigDTO } from "./dtos";
import {
  LlmConfigRepository,
  type LlmConfigWithLatestVersion,
} from "./repositories";

/**
 * Service layer for managing LLM prompt configurations.
 * Handles business logic for prompt operations including handle formatting.
 */
export class PromptService {
  readonly repository: LlmConfigRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new LlmConfigRepository(prisma);
  }

  /**
   * Gets a prompt by ID or handle.
   * If a handle is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.idOrHandle - The ID or handle of the prompt
   * @param params.projectId - The project ID for authorization and context
   * @returns The prompt configuration
   */
  async getPromptByIdOrHandle(params: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<LlmConfigWithLatestVersion> {
    const { idOrHandle, projectId, organizationId } = params;

    return this.repository.getConfigByIdOrHandleWithLatestVersion({
      idOrHandle,
      projectId,
      organizationId,
    });
  }

  /**
   * Creates a new prompt configuration with an initial version.
   * If a handle is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.name - The name of the prompt
   * @param params.projectId - The project ID for authorization and context
   * @param params.handle - The handle of the prompt
   * @returns The created prompt configuration
   */
  async createPrompt(params: {
    name: string;
    projectId: string;
    organizationId: string;
    handle?: string;
    scope: PromptScope;
  }): Promise<LlmConfigWithLatestVersion> {
    return this.repository.createConfigWithInitialVersion(params);
  }

  /**
   * Updates a prompt configuration with the provided data.
   * If a handle is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.id - The prompt configuration ID
   * @param params.projectId - The project ID for authorization and context
   * @param params.data - The update data containing name and optional handle
   * @returns The updated prompt configuration
   */
  async updatePrompt(params: {
    id: string;
    projectId: string;
    data: UpdateLlmConfigDTO;
  }): Promise<LlmPromptConfig> {
    const { id, projectId, data } = params;

    return this.repository.updateConfig(id, projectId, data);
  }

  /**
   * Checks if a handle is unique for a project.
   * @param params - The parameters object
   * @param params.handle - The handle to check
   * @param params.projectId - The project ID to check
   * @param params.organizationId - The organization ID to check
   * @param params.excludeId - The ID of the config to exclude from the check
   * @returns True if the handle is unique, false otherwise
   */
  async checkHandleUniqueness(params: {
    handle: string;
    projectId: string;
    organizationId: string;
    scope: PromptScope;
    excludeId?: string;
  }): Promise<boolean> {
    // Check if handle exists (excluding current config if editing)
    const existingConfig = await this.prisma.llmPromptConfig.findUnique({
      where: {
        scope: params.scope,
        handle: this.repository.createHandle({
          handle: params.handle,
          scope: params.scope,
          projectId: params.projectId,
          organizationId: params.organizationId,
        }),
        // Double check just to make sure the prompt belongs to the project or organization the user is from
        OR: [
          {
            projectId: params.projectId,
          },
          {
            organizationId: params.organizationId,
            scope: "ORGANIZATION",
          },
        ],
      },
    });

    // Return true if unique (no existing config or it's the same config being edited)
    return !existingConfig || existingConfig.id === params.excludeId;
  }
}
