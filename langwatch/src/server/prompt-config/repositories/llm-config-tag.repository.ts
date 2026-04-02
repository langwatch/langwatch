import type { Prisma, PrismaClient, PromptTagAssignment } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { PromptTagRepository } from "./prompt-tag.repository";

const logger = createLogger("langwatch:prompt-version-tags");

export class TagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagValidationError";
  }
}

/**
 * Repository for managing prompt version tags.
 * Tags are named pointers (production, staging, or custom) to specific prompt versions.
 * Built-in tags "production" and "staging" are always valid.
 * Custom tags are valid when a PromptTag definition exists for the org.
 * "latest" is resolved at query time (highest version number), never stored.
 */
export class PromptTagAssignmentRepository {
  private readonly tagDefinitionRepo: PromptTagRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.tagDefinitionRepo = new PromptTagRepository(prisma);
  }

  /**
   * Validates that a tag is acceptable for assignment without org context.
   * For checking custom tag existence, use tagExistsForOrg() with organizationId.
   */
  validateTag(tag: string): void {
    if (!tag) {
      logger.warn({ tag }, "Invalid tag name rejected");
      throw new TagValidationError(
        `Invalid tag "${tag}". Must be a custom tag defined for this org.`,
      );
    }
  }

  /**
   * Returns true if the tag definition exists for the given org.
   */
  async tagExistsForOrg({
    tag,
    organizationId,
  }: {
    tag: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.tagDefinitionRepo.existsForOrg({
      tag,
      organizationId,
    });
  }

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
   * When organizationId is provided, custom tags are also accepted.
   */
  async assignTag({
    configId,
    versionId,
    tag,
    projectId,
    userId,
    organizationId,
    tx,
  }: {
    configId: string;
    versionId: string;
    tag: string;
    projectId: string;
    userId?: string;
    organizationId?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<PromptTagAssignment> {
    if (organizationId) {
      const exists = await this.tagExistsForOrg({ tag, organizationId });
      if (!exists) {
        logger.warn({ tag }, "Invalid tag name rejected");
        throw new TagValidationError(
          `Invalid tag "${tag}". Must be a custom tag defined for this org.`,
        );
      }
    } else {
      this.validateTag(tag);
    }

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
        configId_tag: { configId, tag },
      },
      create: {
        id: `vtag_${nanoid()}`,
        configId,
        versionId,
        tag,
        projectId,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
      update: {
        versionId,
        updatedById: userId ?? null,
      },
    });

    logger.info({ configId, versionId, tag, projectId }, "Tag assigned to prompt version");

    return result;
  }

  /**
   * Get all tags for a prompt config.
   */
  async getTagsForConfig({
    configId,
    projectId,
  }: {
    configId: string;
    projectId: string;
  }): Promise<PromptTagAssignment[]> {
    return this.prisma.promptTagAssignment.findMany({
      where: { configId, projectId },
    });
  }

  /**
   * Get a tag by config ID and tag name.
   */
  async getByConfigAndTag({
    configId,
    tag,
    projectId,
  }: {
    configId: string;
    tag: string;
    projectId: string;
  }): Promise<PromptTagAssignment | null> {
    const result = await this.prisma.promptTagAssignment.findFirst({
      where: {
        configId,
        tag,
        projectId,
      },
    });

    logger.info({ configId, tag }, "Tag lookup completed");

    return result;
  }
}
