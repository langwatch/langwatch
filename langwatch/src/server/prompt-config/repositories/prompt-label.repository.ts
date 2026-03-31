import type { PrismaClient, PromptLabel } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";

const logger = createLogger("langwatch:prompt-labels");

export const BUILT_IN_LABELS = ["latest", "production", "staging"] as const;
export type BuiltInLabel = (typeof BUILT_IN_LABELS)[number];

const LABEL_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;
const PURELY_NUMERIC_REGEX = /^\d+$/;

export class PromptLabelValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptLabelValidationError";
  }
}

export class PromptLabelConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptLabelConflictError";
  }
}

/**
 * Validates a custom label name.
 * - Must not be purely numeric
 * - Must match /^[a-z][a-z0-9_-]*$/ (lowercase, starts with letter, alphanumeric/dash/underscore only)
 * - Must not clash with built-in labels
 */
export function validateLabelName(name: string): void {
  if (!name) {
    throw new PromptLabelValidationError(
      `Invalid label name. Label name must not be empty.`,
    );
  }

  if (PURELY_NUMERIC_REGEX.test(name)) {
    throw new PromptLabelValidationError(
      `Invalid label name "${name}". Label names must not be purely numeric.`,
    );
  }

  if (!LABEL_NAME_REGEX.test(name)) {
    throw new PromptLabelValidationError(
      `Invalid label name "${name}". Label names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores.`,
    );
  }

  if (BUILT_IN_LABELS.includes(name as BuiltInLabel)) {
    throw new PromptLabelValidationError(
      `"${name}" is a built-in label and cannot be created as a custom label.`,
    );
  }
}

/**
 * Repository for managing custom prompt label definitions.
 * Built-in labels (latest, production, staging) are not stored in the database.
 */
export class PromptLabelRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a custom label definition for an org.
   */
  async create({
    organizationId,
    name,
    createdById,
  }: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptLabel> {
    validateLabelName(name);

    try {
      const label = await this.prisma.promptLabel.create({
        data: {
          id: `plabel_${nanoid()}`,
          organizationId,
          name,
          createdById: createdById ?? null,
        },
      });

      logger.info({ organizationId, name }, "Custom prompt label created");

      return label;
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new PromptLabelConflictError(
          `A label with name "${name}" already exists in this org.`,
        );
      }
      throw error;
    }
  }

  /**
   * Lists all custom label definitions for an org.
   */
  async list({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PromptLabel[]> {
    return this.prisma.promptLabel.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Fetches a single custom label by ID and org (for auth scoping).
   */
  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<PromptLabel | null> {
    return this.prisma.promptLabel.findFirst({
      where: { id, organizationId },
    });
  }

  /**
   * Deletes a custom label definition and cascades to PromptVersionLabel rows
   * for prompts belonging to the same org.
   */
  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    const label = await this.prisma.promptLabel.findFirst({
      where: { id, organizationId },
    });

    if (!label) {
      return;
    }

    // Find all project IDs belonging to this org (via teams).
    const projects = await this.prisma.project.findMany({
      where: {
        team: { organizationId },
      },
      select: { id: true },
    });

    const projectIds = projects.map((p) => p.id);

    // Cascade: delete all PromptVersionLabel rows where the label name matches
    // and the project belongs to this org.
    if (projectIds.length > 0) {
      await this.prisma.promptVersionLabel.deleteMany({
        where: {
          label: label.name,
          projectId: { in: projectIds },
        },
      });
    }

    await this.prisma.promptLabel.delete({
      where: { id },
    });

    logger.info({ organizationId, id, name: label.name }, "Custom prompt label deleted");
  }

  /**
   * Checks whether a label name is valid for assignment within an org.
   * Built-in labels (production, staging) are always valid.
   * Custom labels are valid if a definition exists for the org.
   * "latest" is resolved at query time and never assigned.
   */
  async isValidLabelForOrg({
    label,
    organizationId,
  }: {
    label: string;
    organizationId: string;
  }): Promise<boolean> {
    if ((["production", "staging"] as string[]).includes(label)) {
      return true;
    }

    const custom = await this.prisma.promptLabel.findFirst({
      where: { organizationId, name: label },
    });

    return custom !== null;
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code: string }).code === "P2002"
  );
}
