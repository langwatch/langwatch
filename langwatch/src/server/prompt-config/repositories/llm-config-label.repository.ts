import type { Prisma, PrismaClient, PromptVersionLabel } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { VALID_LABELS, type ValidLabel } from "~/prompts/constants/labels";
import { PromptLabelRepository } from "./prompt-label.repository";

export { VALID_LABELS } from "~/prompts/constants/labels";
export type { ValidLabel } from "~/prompts/constants/labels";

const logger = createLogger("langwatch:prompt-version-labels");

export class LabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelValidationError";
  }
}

/**
 * Repository for managing prompt version labels.
 * Labels are named pointers (production, staging, or custom) to specific prompt versions.
 * Built-in labels "production" and "staging" are always valid.
 * Custom labels are valid when a PromptLabel definition exists for the org.
 * "latest" is resolved at query time (highest version number), never stored.
 */
export class PromptVersionLabelRepository {
  private readonly labelDefinitionRepo: PromptLabelRepository;

  constructor(private readonly prisma: PrismaClient) {
    this.labelDefinitionRepo = new PromptLabelRepository(prisma);
  }

  /**
   * Validates that a label is one of the built-in assignable values.
   * For validation that also accepts custom labels, use isValidLabel() with organizationId.
   */
  validateLabel(label: string): asserts label is ValidLabel {
    if (!VALID_LABELS.includes(label as ValidLabel)) {
      logger.warn({ label }, "Invalid label name rejected");
      throw new LabelValidationError(
        `Invalid label "${label}". Must be a built-in label ("production", "staging") or a custom label defined for this org.`,
      );
    }
  }

  /**
   * Returns true if the label is valid for the given org.
   * Delegates to PromptLabelRepository.isValidLabelForOrg().
   */
  async isValidLabel({
    label,
    organizationId,
  }: {
    label: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.labelDefinitionRepo.isValidLabelForOrg({
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
      throw new LabelValidationError(
        "Version does not belong to this prompt config",
      );
    }
  }

  /**
   * Assign a label to a specific version.
   * If the label already exists for the config, it is reassigned (upsert).
   * When organizationId is provided, custom labels are also accepted.
   */
  async assignLabel({
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
      const valid = await this.isValidLabel({ label, organizationId });
      if (!valid) {
        logger.warn({ label }, "Invalid label name rejected");
        throw new LabelValidationError(
          `Invalid label "${label}". Must be a built-in label or a custom label defined for this org.`,
        );
      }
    } else {
      this.validateLabel(label);
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

    logger.info({ configId, versionId, label, projectId }, "Label assigned to prompt version");

    return result;
  }

  /**
   * Get all labels for a prompt config.
   */
  async getLabelsForConfig({
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
   * Get a label by config ID and label name.
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

    logger.info({ configId, label }, "Label lookup completed");

    return result;
  }
}
