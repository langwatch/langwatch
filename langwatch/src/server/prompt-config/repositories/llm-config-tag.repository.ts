import type { Prisma, PrismaClient, PromptTag, PromptTagAssignment } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:prompt-version-tags");

export class TagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagValidationError";
  }
}

/**
 * Repository for managing prompt version tag assignments.
 * Assignments link a prompt config to a PromptTag definition via FK.
 * Tag validation is the service layer's responsibility.
 */
export class PromptTagAssignmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Validates that a version belongs to the specified prompt config.
   */
  async validateVersionBelongsToConfig({
    versionId,
    configId,
    projectId,
    tx,
  }: {
    versionId: string;
    configId: string;
    projectId: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = tx ?? this.prisma;
    const version = await client.llmPromptConfigVersion.findFirst({
      where: {
        id: versionId,
        configId,
        projectId,
      },
    });

    if (!version) {
      logger.warn({ versionId, configId, projectId }, "Version does not belong to prompt config");
      throw new TagValidationError(
        "Version does not belong to this prompt config",
      );
    }
  }

  /**
   * Assign a tag to a specific version.
   * If the tag already exists for the config, it is reassigned (upsert).
   * Callers must resolve tag name → tagId before calling this method.
   */
  async assignTag({
    configId,
    versionId,
    tagId,
    projectId,
    userId,
    tx,
  }: {
    configId: string;
    versionId: string;
    tagId: string;
    projectId: string;
    userId?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<PromptTagAssignment & { promptTag: PromptTag }> {
    const client = tx ?? this.prisma;

    await this.validateVersionBelongsToConfig({
      versionId,
      configId,
      projectId,
      tx,
    });

    const result = await client.promptTagAssignment.upsert({
      where: {
        projectId,
        configId_tagId: { configId, tagId },
      },
      create: {
        id: `vtag_${nanoid()}`,
        configId,
        versionId,
        tagId,
        projectId,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
      update: {
        versionId,
        updatedById: userId ?? null,
      },
      include: { promptTag: true },
    });

    logger.info({ configId, versionId, tagId, projectId }, "Tag assigned to prompt version");

    return result;
  }

  /**
   * Get all tags for a prompt config, including the tag name via the promptTag relation.
   */
  async getTagsForConfig({
    configId,
    projectId,
  }: {
    configId: string;
    projectId: string;
  }): Promise<(PromptTagAssignment & { promptTag: PromptTag })[]> {
    return this.prisma.promptTagAssignment.findMany({
      where: { configId, projectId },
      include: { promptTag: true },
    });
  }

  /**
   * Returns every tag assignment (with its PromptTag) that points at any of
   * the given versionIds within the project. Used by read paths that need
   * to surface tags alongside the returned version(s) without loading the
   * entire tag history for the config.
   */
  async findByVersionIds(params: {
    versionIds: string[];
    projectId: string;
  }): Promise<(PromptTagAssignment & { promptTag: PromptTag })[]> {
    if (params.versionIds.length === 0) return [];
    return this.prisma.promptTagAssignment.findMany({
      where: {
        projectId: params.projectId,
        versionId: { in: params.versionIds },
      },
      include: { promptTag: true },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Get a tag assignment by config ID and tagId.
   * Callers must resolve tag name → tagId before calling this method.
   */
  async getByConfigAndTagId({
    configId,
    tagId,
    projectId,
  }: {
    configId: string;
    tagId: string;
    projectId: string;
  }): Promise<PromptTagAssignment | null> {
    const result = await this.prisma.promptTagAssignment.findFirst({
      where: {
        configId,
        tagId,
        projectId,
      },
    });

    logger.info({ configId, tagId }, "Tag lookup completed");

    return result;
  }
}
