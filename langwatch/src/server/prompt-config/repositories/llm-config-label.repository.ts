import type {
  LlmPromptConfigLabel,
  Prisma,
  PrismaClient,
} from "@prisma/client";
import { PrismaClientKnownRequestError } from "@prisma/client/runtime/library";
import { nanoid } from "nanoid";

/** Valid characters for label names: lowercase alphanumeric, hyphens, underscores */
const LABEL_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]*$/;

export class LabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelValidationError";
  }
}

export class LabelNotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelNotFoundError";
  }
}

export class LabelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LabelConflictError";
  }
}

/**
 * Repository for managing LLM Prompt Config Labels.
 * Labels are named pointers to specific prompt versions (e.g., "production", "staging").
 */
export class LlmConfigLabelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Validates a label name. Must be non-empty, lowercase alphanumeric with hyphens/underscores.
   * "latest" is reserved and cannot be used.
   */
  validateLabelName(name: string): void {
    if (!name || name.trim().length === 0) {
      throw new LabelValidationError("Label name must be a non-empty string");
    }

    if (name === "latest") {
      throw new LabelValidationError(
        '"latest" is a reserved label and cannot be stored in the database',
      );
    }

    if (!LABEL_NAME_PATTERN.test(name)) {
      throw new LabelValidationError(
        `Label name "${name}" is invalid. Must be lowercase alphanumeric with hyphens or underscores, starting with a letter or number.`,
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
   * Create a new label for a prompt config.
   */
  async create({
    configId,
    name,
    versionId,
    projectId,
    createdById,
    tx,
  }: {
    configId: string;
    name: string;
    versionId: string;
    projectId: string;
    createdById?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<LlmPromptConfigLabel> {
    this.validateLabelName(name);

    const client = tx ?? this.prisma;

    await this.validateVersionBelongsToConfig({
      versionId,
      configId,
      projectId,
      tx,
    });

    try {
      return await client.llmPromptConfigLabel.create({
        data: {
          id: this.generateLabelId(),
          configId,
          name,
          versionId,
          projectId,
          createdById: createdById ?? null,
          updatedById: createdById ?? null,
        },
      });
    } catch (error: unknown) {
      if (
        error instanceof PrismaClientKnownRequestError &&
        error.code === "P2002"
      ) {
        throw new LabelConflictError(
          `Label "${name}" already exists for this prompt`,
        );
      }
      throw error;
    }
  }

  /**
   * Get a label by config ID and name.
   */
  async getByConfigAndName({
    configId,
    name,
    projectId,
  }: {
    configId: string;
    name: string;
    projectId: string;
  }): Promise<LlmPromptConfigLabel | null> {
    return await this.prisma.llmPromptConfigLabel.findFirst({
      where: {
        configId,
        name,
        projectId,
      },
    });
  }

  /**
   * List all labels for a prompt config.
   */
  async listByConfig({
    configId,
    projectId,
  }: {
    configId: string;
    projectId: string;
  }): Promise<LlmPromptConfigLabel[]> {
    return await this.prisma.llmPromptConfigLabel.findMany({
      where: {
        configId,
        projectId,
      },
      orderBy: { name: "asc" },
    });
  }

  /**
   * Update a label to point to a different version.
   */
  async update({
    configId,
    name,
    versionId,
    projectId,
    updatedById,
  }: {
    configId: string;
    name: string;
    versionId: string;
    projectId: string;
    updatedById?: string;
  }): Promise<LlmPromptConfigLabel> {
    await this.validateVersionBelongsToConfig({
      versionId,
      configId,
      projectId,
    });

    const label = await this.getByConfigAndName({ configId, name, projectId });

    if (!label) {
      throw new LabelNotFoundError(
        `Label "${name}" not found for this prompt`,
      );
    }

    return await this.prisma.llmPromptConfigLabel.update({
      where: { id: label.id, projectId },
      data: {
        versionId,
        updatedById: updatedById ?? null,
      },
    });
  }

  /**
   * Delete a label by config ID and name.
   */
  async delete({
    configId,
    name,
    projectId,
  }: {
    configId: string;
    name: string;
    projectId: string;
  }): Promise<void> {
    const label = await this.getByConfigAndName({ configId, name, projectId });

    if (!label) {
      throw new LabelNotFoundError(
        `Label "${name}" not found for this prompt`,
      );
    }

    await this.prisma.llmPromptConfigLabel.delete({
      where: { id: label.id, projectId },
    });
  }

  /**
   * Create built-in labels (production, staging) for a newly created prompt.
   */
  async createBuiltInLabels({
    configId,
    versionId,
    projectId,
    createdById,
    tx,
  }: {
    configId: string;
    versionId: string;
    projectId: string;
    createdById?: string;
    tx?: Prisma.TransactionClient;
  }): Promise<void> {
    const client = tx ?? this.prisma;

    await client.llmPromptConfigLabel.createMany({
      data: [
        {
          id: this.generateLabelId(),
          configId,
          name: "production",
          versionId,
          projectId,
          createdById: createdById ?? null,
          updatedById: createdById ?? null,
        },
        {
          id: this.generateLabelId(),
          configId,
          name: "staging",
          versionId,
          projectId,
          createdById: createdById ?? null,
          updatedById: createdById ?? null,
        },
      ],
    });
  }

  private generateLabelId(): string {
    return `label_${nanoid()}`;
  }
}
