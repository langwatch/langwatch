import {
  type LlmPromptConfig,
  type LlmPromptConfigVersion,
  type PrismaClient,
  type User,
} from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { nanoid } from "nanoid";

import {
  type LatestConfigVersionSchema,
  type SchemaVersion,
  getVersionValidator,
} from "./llm-config-version-schema";
import { LlmConfigRepository } from "./llm-config.repository";

/**
 * Interface for LLM Config Version data transfer objects
 */
export type LlmConfigVersionDTO = Omit<LatestConfigVersionSchema, "version">;

export type CreateLlmConfigVersionParams = Omit<
  LlmPromptConfigVersion,
  "id" | "author" | "config" | "createdAt"
>;

/**
 * Repository for managing LLM Configuration Versions
 * Follows Single Responsibility Principle by focusing only on LLM config versions data access
 *
 * Generally, you should be using the LlmConfigRepository to get the latest version of a config
 * instead of this repository.
 */
export class LlmConfigVersionsRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get all versions for a specific config
   */
  async getVersionsForConfigByIdOrHandle({
    idOrHandle,
    projectId,
    organizationId,
  }: {
    idOrHandle: string;
    projectId: string;
    organizationId: string;
  }): Promise<(LlmPromptConfigVersion & { author: User | null })[]> {
    // Verify the config exists
    const promptRepository = new LlmConfigRepository(this.prisma);
    const config = await promptRepository.getPromptByIdOrHandle({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!config) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config not found.",
      });
    }

    // Get all versions
    return this.prisma.llmPromptConfigVersion.findMany({
      where: { configId: config.id, projectId },
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
      },
    });
  }

  /**
   * Get a specific version by ID
   */
  async getVersionById({
    versionId,
    projectId,
  }: {
    versionId: string;
    projectId: string;
  }): Promise<
    LlmPromptConfigVersion & { author: User | null; config: LlmPromptConfig }
  > {
    const version = await this.prisma.llmPromptConfigVersion.findFirst({
      where: {
        id: versionId,
        projectId,
        config: { projectId },
      },
      include: {
        author: true,
        config: true,
      },
    });

    if (!version) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config version not found.",
      });
    }

    return version;
  }

  /**
   * Get the latest version for a config
   */
  async getLatestVersion(
    configId: string,
    projectId: string
  ): Promise<LlmPromptConfigVersion & { author: User | null }> {
    // Verify the config exists
    const config = await this.prisma.llmPromptConfig.findUnique({
      where: { id: configId, projectId },
    });

    if (!config) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config not found.",
      });
    }

    // Get the latest version
    const latestVersion = await this.prisma.llmPromptConfigVersion.findFirst({
      where: { configId, projectId },
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
      },
    });

    if (!latestVersion) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "No versions found for this config.",
      });
    }

    return latestVersion;
  }

  /**
   * Create a new version for an existing config
   */
  async createVersion(
    versionData: Omit<LlmConfigVersionDTO, "author">,
    organizationId: string
  ): Promise<LlmPromptConfigVersion & { schemaVersion: SchemaVersion }> {
    // Verify the config exists
    const promptRepository = new LlmConfigRepository(this.prisma);
    const config =
      await promptRepository.getConfigByIdOrHandleWithLatestVersion({
        idOrHandle: versionData.configId,
        projectId: versionData.projectId,
        organizationId,
      });

    if (!config) {
      throw new TRPCError({
        code: "NOT_FOUND",
        message: "Prompt config not found.",
      });
    }

    // Omit the version field from the validator since auto-incremented by the database
    const validator = getVersionValidator(versionData.schemaVersion).omit({
      version: true,
    });

    // Validate the config data
    validator.parse(versionData);

    // Use a transaction to ensure both operations succeed or fail together
    const configId = config.id;
    const { projectId } = versionData;
    const version = await this.prisma.$transaction(async (tx) => {
      const count = await tx.llmPromptConfigVersion.count({
        where: { configId, projectId },
      });

      if ("author" in versionData) {
        delete versionData.author;
      }

      // Create the new version
      const newVersion = await tx.llmPromptConfigVersion.create({
        data: {
          ...versionData,
          id: `prompt_version_${nanoid()}`,
          version: count, // Since we start at zero, this is correct
          configData: versionData.configData as any,
        },
      });

      // Update the parent config's updatedAt timestamp
      await tx.llmPromptConfig.update({
        where: { id: configId, projectId },
        data: { updatedAt: new Date() },
      });

      return newVersion;
    });

    return {
      ...version,
      schemaVersion: version.schemaVersion as SchemaVersion,
    };
  }

  /**
   * Restore a version by creating a new version with the same config data
   */
  async restoreVersion(
    id: string,
    projectId: string,
    organizationId: string,
    authorId: string | null
  ): Promise<LlmPromptConfigVersion> {
    // Find the version to restore
    const version = await this.prisma.llmPromptConfigVersion.findUnique({
      where: { id, projectId },
    });

    if (!version) {
      throw new Error(`Version ${id} not found.`);
    }

    const newVersion = await this.createVersion(
      {
        authorId,
        projectId: version.projectId,
        configId: version.configId,
        commitMessage: `Restore from version ${version.version}`,
        schemaVersion: version.schemaVersion as SchemaVersion,
        configData: version.configData as LlmConfigVersionDTO["configData"],
      },
      organizationId
    );

    return newVersion;
  }

  generateVersionId() {
    return `prompt_version_${nanoid()}`;
  }
}
