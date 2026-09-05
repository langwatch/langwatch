import { nanoid } from "nanoid";
import type {
  LlmPromptConfig,
  LlmPromptConfigVersion,
  Prisma,
  PrismaClient,
  User,
} from "@langwatch/prisma-client/generated";

import { NotFoundError, type SchemaVersion } from "@langwatch/prompt-contract";
import {
  LlmConfigVersionsRepository,
  type LlmConfigVersionDTO,
} from "../prompt-version.repository";
import { PrismaLlmConfigRepository } from "./prisma.prompt.repository";
import { getVersionValidator, parseRuntimeParameters } from "@langwatch/prompt-contract";

/**
 * The client slice version persistence binds to, transaction included: a version row and
 * the config row whose pointer it moves land together.
 */
export type PromptVersionDatabase = Pick<
  PrismaClient,
  "llmPromptConfig" | "llmPromptConfigVersion" | "project" | "$transaction"
>;

/**
 * Repository for managing LLM Configuration Versions Follows Single Responsibility
 * Principle by focusing only on LLM config versions data access
 */
export class PrismaLlmConfigVersionsRepository extends LlmConfigVersionsRepository {
  static create({ prisma }: { prisma: PromptVersionDatabase }): PrismaLlmConfigVersionsRepository {
    return new PrismaLlmConfigVersionsRepository(prisma);
  }

  private constructor(private readonly prisma: PromptVersionDatabase) {
    super();
  }

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
    const promptRepository = PrismaLlmConfigRepository.create({ prisma: this.prisma });
    const config = await promptRepository.tryGetPromptByIdOrHandle({
      idOrHandle,
      projectId,
      organizationId,
    });

    if (!config) {
      throw new NotFoundError("Prompt config not found.");
    }

    // Get all versions
    return await this.prisma.llmPromptConfigVersion.findMany({
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
  }): Promise<LlmPromptConfigVersion & { author: User | null; config: LlmPromptConfig }> {
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
      throw new NotFoundError("Prompt config version not found.");
    }

    return version;
  }

  /**
   * Returns the id of the most recent version for a config, or null when no version exists.
   * Non-throwing variant intended for read-path enrichment (e.g. deciding whether a returned
   * version is "latest") where a missing row is a legitimate case, not an error.
   */
  async tryFindLatestId(params: {
    configId: string;
    projectId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<string | null> {
    const client = params.tx ?? this.prisma;
    const v = await client.llmPromptConfigVersion.findFirst({
      where: { configId: params.configId, projectId: params.projectId },
      orderBy: { createdAt: "desc" },
      select: { id: true },
    });
    return v?.id ?? null;
  }

  /**
   * Get the latest version for a config
   */
  async getLatestVersion(
    configId: string,
    projectId: string,
    options?: {
      tx?: Prisma.TransactionClient;
    },
  ): Promise<LlmPromptConfigVersion & { author: User | null }> {
    const { tx } = options ?? {};
    const client = tx ?? this.prisma;
    // Verify the config exists
    const config = await client.llmPromptConfig.findUnique({
      where: { id: configId, projectId },
    });

    if (!config) {
      throw new NotFoundError("Prompt config not found.");
    }

    // Get the latest version
    const latestVersion = await client.llmPromptConfigVersion.findFirst({
      where: { configId, projectId },
      orderBy: { createdAt: "desc" },
      include: {
        author: true,
      },
    });

    if (!latestVersion) {
      throw new NotFoundError("No versions found for this config.");
    }

    return latestVersion;
  }

  /**
   * Create a new version for an existing config
   */
  async createVersion(params: {
    versionData: Omit<LlmConfigVersionDTO, "author" | "id" | "createdAt"> & {
      runtimeParameters?: Record<string, unknown>;
    };
    organizationId: string;
  }): Promise<LlmPromptConfigVersion & { schemaVersion: SchemaVersion }> {
    const { versionData, organizationId } = params;
    // Verify the config exists
    const promptRepository = PrismaLlmConfigRepository.create({ prisma: this.prisma });
    const config = await promptRepository.tryGetConfigByIdOrHandleWithLatestVersion({
      idOrHandle: versionData.configId,
      projectId: versionData.projectId,
      organizationId,
    });

    if (!config) {
      throw new NotFoundError("Prompt config not found.");
    }

    // Omit the version field from the validator since auto-incremented by the database
    const validator = getVersionValidator(versionData.schemaVersion).omit({
      id: true,
      createdAt: true,
      version: true,
    });

    // Validate the config data
    validator.parse(versionData);

    // Use a transaction to ensure both operations succeed or fail together
    const configId = config.id;
    const { projectId } = versionData;
    const version = await this.prisma.$transaction(async (tx) => {
      const maxVersion = await tx.llmPromptConfigVersion.aggregate({
        where: { configId, projectId },
        _max: { version: true },
      });

      if ("author" in versionData) {
        delete versionData.author;
      }

      const nextVersion = (maxVersion._max.version ?? -1) + 1;

      // Create the new version
      const { runtimeParameters, ...restVersionData } = versionData;
      const newVersion = await tx.llmPromptConfigVersion.create({
        data: {
          ...restVersionData,
          id: `prompt_version_${nanoid()}`,
          version: nextVersion,
          configData: restVersionData.configData as Prisma.InputJsonValue,
          runtimeParameters: (runtimeParameters as Prisma.InputJsonValue) ?? {},
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
  async restoreVersion(params: {
    id: string;
    projectId: string;
    organizationId: string;
    authorId: string | null;
  }): Promise<LlmPromptConfigVersion> {
    const { id, projectId, organizationId, authorId } = params;

    // Find the version to restore
    const version = await this.prisma.llmPromptConfigVersion.findUnique({
      where: { id, projectId },
    });

    if (!version) {
      throw new Error(`Version ${id} not found.`);
    }

    const newVersion = await this.createVersion({
      versionData: {
        authorId,
        projectId: version.projectId,
        configId: version.configId,
        commitMessage: `Restore from version ${version.version}`,
        schemaVersion: version.schemaVersion as SchemaVersion,
        configData: version.configData as LlmConfigVersionDTO["configData"],
        runtimeParameters: parseRuntimeParameters(version.runtimeParameters),
      },
      organizationId,
    });

    return newVersion;
  }

  generateVersionId(): string {
    return `prompt_version_${nanoid()}`;
  }
}
