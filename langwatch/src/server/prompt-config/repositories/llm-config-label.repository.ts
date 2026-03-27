import type { Prisma, PrismaClient, PromptVersionLabel } from "@prisma/client";
import { nanoid } from "nanoid";

const VALID_LABELS = ["production", "staging"] as const;
type ValidLabel = (typeof VALID_LABELS)[number];

export class LabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelValidationError";
  }
}

/**
 * Repository for managing prompt version labels.
 * Labels are named pointers (production, staging) to specific prompt versions.
 * Only two labels are allowed: "production" and "staging".
 * "latest" is resolved at query time (highest version number), never stored.
 */
export class PromptVersionLabelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Validates that a label is one of the two allowed values.
   */
  validateLabel(label: string): asserts label is ValidLabel {
    if (!VALID_LABELS.includes(label as ValidLabel)) {
      throw new LabelValidationError(
        `Invalid label "${label}". Only "production" and "staging" are allowed.`,
      );
    }
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
      throw new LabelValidationError(
        "Version does not belong to this prompt config",
      );
    }
  }

  /**
   * Assign a label to a specific version.
   * If the label already exists for the config, it is reassigned (upsert).
   */
  async assignLabel({
    configId,
    versionId,
    label,
    projectId,
    userId,
    tx,
  }: {
    configId: string;
    versionId: string;
    label: string;
    projectId: string;
    userId?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<PromptVersionLabel> {
    this.validateLabel(label);

    const client = tx ?? this.prisma;

    await this.validateVersionBelongsToConfig({
      versionId,
      configId,
      projectId,
      tx,
    });

    return await client.promptVersionLabel.upsert({
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
    return await this.prisma.promptVersionLabel.findFirst({
      where: {
        configId,
        label,
        projectId,
      },
    });
  }
}
