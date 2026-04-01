import type { Prisma, PrismaClient, PromptVersionLabel } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { VALID_TAGS, type ValidTag } from "~/prompts/constants/tags";
import { PromptTagRepository } from "./prompt-tag.repository";

export { VALID_TAGS } from "~/prompts/constants/tags";
export type { ValidTag } from "~/prompts/constants/tags";

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
export class PromptVersionLabelRepository {
  private readonly tagDefinitionRepo: PromptTagRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.tagDefinitionRepo = new PromptTagRepository(prisma);
  }

  /**
   * Validates that a tag is one of the built-in assignable values.
   * For validation that also accepts custom tags, use isValidTag() with organizationId.
   */
  validateTag(label: string): asserts label is ValidTag {
    if (!VALID_TAGS.includes(label as ValidTag)) {
      logger.warn({ label }, "Invalid tag name rejected");
      throw new TagValidationError(
        `Invalid label "${label}". Must be a built-in tag ("production", "staging") or a custom tag defined for this org.`,
      );
    }
  }

  /**
   * Returns true if the tag is valid for the given org.
   * Delegates to PromptTagRepository.isValidTagForOrg().
   */
  async isValidTag({
    label,
    organizationId,
  }: {
    label: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.tagDefinitionRepo.isValidTagForOrg({
      label,
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
    label,
    projectId,
    userId,
    organizationId,
    tx,
  }: {
    configId: string;
    versionId: string;
    label: string;
    projectId: string;
    userId?: string;
    organizationId?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<PromptVersionLabel> {
    if (organizationId) {
      const valid = await this.isValidTag({ label, organizationId });
      if (!valid) {
        logger.warn({ label }, "Invalid tag name rejected");
        throw new TagValidationError(
          `Invalid label "${label}". Must be a built-in tag or a custom tag defined for this org.`,
        );
      }
    } else {
      this.validateTag(label);
    }

    const client = tx ?? this.prisma;

    await this.validateVersionBelongsToConfig({
      versionId,
      configId,
      projectId,
      tx,
    });

    const result = await client.promptVersionLabel.upsert({
      where: {
        projectId,
        configId_label: { configId, label },
      },
      create: {
        id: `label_${nanoid()}`,
        configId,
        versionId,
        label,
        projectId,
        createdById: userId ?? null,
        updatedById: userId ?? null,
      },
      update: {
        versionId,
        updatedById: userId ?? null,
      },
    });

    logger.info({ configId, versionId, label, projectId }, "Tag assigned to prompt version");

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
  }): Promise<PromptVersionLabel[]> {
    return this.prisma.promptVersionLabel.findMany({
      where: { configId, projectId },
    });
  }

  /**
   * Get a tag by config ID and tag name.
   */
  async getByConfigAndLabel({
    configId,
    label,
    projectId,
  }: {
    configId: string;
    label: string;
    projectId: string;
  }): Promise<PromptVersionLabel | null> {
    const result = await this.prisma.promptVersionLabel.findFirst({
      where: {
        configId,
        label,
        projectId,
      },
    });

    logger.info({ configId, label }, "Tag lookup completed");

    return result;
  }
}
