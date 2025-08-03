import { type LlmPromptConfig, type PrismaClient } from "@prisma/client";

import { type UpdateLlmConfigDTO } from "./dtos";
import { NotFoundError } from "./errors";
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
  }): Promise<LlmConfigWithLatestVersion> {
    const { idOrHandle, projectId } = params;

    const handle = await this.createHandle(
      projectId,
      idOrHandle
    );

    return this.repository.getConfigByIdOrHandleWithLatestVersion({
      id: idOrHandle,
      handle: handle,
      projectId,
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
    handle?: string;
  }): Promise<LlmConfigWithLatestVersion> {
    const data = { ...params };

    if (data.handle) {
      data.handle = await this.createHandle(
        data.projectId,
        data.handle
      );
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
    data: UpdateLlmConfigDTO;
  }): Promise<LlmPromptConfig> {
    const { id, projectId, data } = params;

    const updateData = {
      ...data,
    };

    // Format handle with organization/project context if provided
    if (data.handle) {
      updateData.handle = await this.createHandle(
        projectId,
        data.handle
      );
    }

    return this.repository.updateConfig(id, projectId, updateData);
  }

  /**
   * Creates a fully qualified handle by combining organization, project, and user-provided handle.
   * Format: {organizationId}/{projectId}/{handle}
   *
   * This ensures handles are unique across the entire system and provides clear ownership context.
   *
   * @param projectId - The project ID to fetch organization context
   * @param handle - The user-provided handle
   * @returns Formatted handle string
   * @throws Will throw if project is not found or missing organization context
   */
  private async createHandle(
    projectId: string,
    handle: string
  ): Promise<string> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: {
        team: {
          include: {
            organization: true,
          },
        },
      },
    });

    if (!project) {
      throw new NotFoundError("Project not found");
    }

    if (!project.team.organization) {
      throw new NotFoundError("Organization not found");
    }

    const organizationId = project?.team.organization.id;

    return `${organizationId}/${projectId}/${handle}`;
  }
}
