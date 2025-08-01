import { type LlmPromptConfig, type PrismaClient } from "@prisma/client";

import { type UpdateLlmConfigDTO } from "./dtos";
import {
  LlmConfigRepository,
  type LlmConfigWithLatestVersion,
} from "./repositories";

/**
 * Service layer for managing LLM prompt configurations.
 * Handles business logic for prompt operations including reference ID formatting.
 */
export class PromptService {
  readonly repository: LlmConfigRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.repository = new LlmConfigRepository(prisma);
  }

  /**
   * Gets a prompt by ID or reference ID.
   * If a reference ID is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.idOrReferenceId - The ID or reference ID of the prompt
   * @param params.projectId - The project ID for authorization and context
   * @returns The prompt configuration
   */
  async getPromptByIdOrReferenceId(params: {
    idOrReferenceId: string;
    projectId: string;
  }): Promise<LlmConfigWithLatestVersion> {
    const { idOrReferenceId, projectId } = params;

    const referenceId = await this.createReferenceId(
      projectId,
      idOrReferenceId
    );

    return this.repository.getConfigByIdOrReferenceIdWithLatestVersion({
      id: idOrReferenceId,
      referenceId,
      projectId,
    });
  }

  /**
   * Creates a new prompt configuration with an initial version.
   * If a reference ID is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.name - The name of the prompt
   * @param params.projectId - The project ID for authorization and context
   * @param params.referenceId - The reference ID of the prompt
   * @returns The created prompt configuration
   */
  async createPrompt(params: {
    name: string;
    projectId: string;
    referenceId?: string;
  }): Promise<LlmConfigWithLatestVersion> {
    const data = { ...params };

    if (data.referenceId) {
      data.referenceId = await this.createReferenceId(
        data.projectId,
        data.referenceId
      );
    }

    return this.repository.createConfigWithInitialVersion(data);
  }

  /**
   * Updates a prompt configuration with the provided data.
   * If a referenceId is provided, it will be formatted with the organization and project context.
   *
   * @param params - The parameters object
   * @param params.id - The prompt configuration ID
   * @param params.projectId - The project ID for authorization and context
   * @param params.data - The update data containing name and optional referenceId
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

    // Format referenceId with organization/project context if provided
    if (data.referenceId) {
      updateData.referenceId = await this.createReferenceId(
        projectId,
        data.referenceId
      );
    }

    return this.repository.updateConfig(id, projectId, updateData);
  }

  /**
   * Creates a fully qualified reference ID by combining organization, project, and user-provided reference.
   * Format: {organizationId}/{projectId}/{referenceId}
   *
   * This ensures reference IDs are unique across the entire system and provides clear ownership context.
   *
   * @param projectId - The project ID to fetch organization context
   * @param referenceId - The user-provided reference identifier
   * @returns Formatted reference ID string
   * @throws Will throw if project is not found or missing organization context
   */
  private async createReferenceId(
    projectId: string,
    referenceId: string
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

    const organizationId = project?.team.organization.id;

    return `${organizationId}/${projectId}/${referenceId}`;
  }
}
