import { Prisma, type PrismaClient, type PromptTag, type PromptTagAssignment } from "@prisma/client";
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
   *
   * `source` records the event that produced the assignment (e.g. a pairwise
   * eval promotion). Passing `null`/`undefined` clears any prior source on
   * reassignment — a new assignment event without a recorded cause replaces
   * stale provenance rather than inheriting it.
   */
  async assignTag({
    configId,
    versionId,
    tagId,
    projectId,
    userId,
    source,
    tx,
  }: {
    configId: string;
    versionId: string;
    tagId: string;
    projectId: string;
    userId?: string;
    source?: Prisma.InputJsonValue | null;
    tx?: Prisma.TransactionClient;
  }): Promise<PromptTagAssignment & { promptTag: PromptTag }> {
    const client = tx ?? this.prisma;

    await this.validateVersionBelongsToConfig({
      versionId,
      configId,
      projectId,
      tx,
    });

    const sourceArg: Prisma.InputJsonValue | typeof Prisma.DbNull =
      source === undefined || source === null ? Prisma.DbNull : source;

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
        source: sourceArg,
      },
      update: {
        versionId,
        updatedById: userId ?? null,
        source: sourceArg,
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
