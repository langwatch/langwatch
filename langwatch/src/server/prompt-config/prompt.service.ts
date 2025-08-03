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
    const data = { ...params };

    if (data.handle) {
      data.handle = this.repository.createHandle({
        handle: data.handle,
        scope: data.scope,
        projectId: data.projectId,
        organizationId: data.organizationId,
      });
    }

    return this.repository.createConfigWithInitialVersion(data);
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
    organizationId: string;
    data: UpdateLlmConfigDTO;
  }): Promise<LlmPromptConfig> {
    const { id, projectId, organizationId, data } = params;

    const updateData = {
      ...data,
    };

    // Format handle with organization/project context if provided
    if (data.handle) {
      let newScope = data.scope;
      // Keep current scope if not provided
      if (!newScope) {
        const config =
          await this.repository.getConfigByIdOrHandleWithLatestVersion({
            idOrHandle: id,
            projectId,
            organizationId,
          });
        newScope = config.scope;
      }

      updateData.handle = this.repository.createHandle({
        handle: data.handle,
        scope: newScope,
        projectId,
        organizationId,
      });
    }

    return this.repository.updateConfig(id, projectId, updateData);
  }
}
