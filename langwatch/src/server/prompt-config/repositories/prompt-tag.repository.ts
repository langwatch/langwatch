import type { PrismaClient, PromptTag } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { VALID_TAGS, type ValidTag } from "~/prompts/constants/tags";

const logger = createLogger("langwatch:prompt-tags");

/** Tags that are always available and cannot be created or deleted as custom tags. */
export const BUILT_IN_TAGS = ["latest", ...VALID_TAGS] as const;
export type BuiltInTag = (typeof BUILT_IN_TAGS)[number];

const TAG_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;
const PURELY_NUMERIC_REGEX = /^\d+$/;

export class PromptTagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptTagValidationError";
  }
}

export class PromptTagConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PromptTagConflictError";
  }
}

/**
 * Validates a custom tag name.
 * - Must not be empty
 * - Must not be purely numeric
 * - Must match /^[a-z][a-z0-9_-]*$/
 * - Must not clash with built-in tags
 */
export function validateTagName(name: string): void {
  if (!name) {
    throw new PromptTagValidationError(
      `Invalid tag name. Tag name must not be empty.`,
    );
  }

  if (PURELY_NUMERIC_REGEX.test(name)) {
    throw new PromptTagValidationError(
      `Invalid tag name "${name}". Tag names must not be purely numeric.`,
    );
  }

  if (!TAG_NAME_REGEX.test(name)) {
    throw new PromptTagValidationError(
      `Invalid tag name "${name}". Tag names must start with a lowercase letter and contain only lowercase letters, digits, hyphens, or underscores.`,
    );
  }

  if (BUILT_IN_TAGS.includes(name as BuiltInTag)) {
    throw new PromptTagValidationError(
      `"${name}" is a built-in tag and cannot be created as a custom tag.`,
    );
  }
}

/**
 * Repository for managing custom prompt tag definitions.
 * Built-in tags (latest, production, staging) are not stored in the database.
 */
export class PromptTagRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a custom tag definition for an org.
   */
  async create({
    organizationId,
    name,
    createdById,
  }: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag> {
    validateTagName(name);

    try {
      const tag = await this.prisma.promptTag.create({
        data: {
          id: `ptag_${nanoid()}`,
          organizationId,
          name,
          createdById: createdById ?? null,
        },
      });

      logger.info({ organizationId, name }, "Custom prompt tag created");

      return tag;
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new PromptTagConflictError(
          `A tag with name "${name}" already exists in this org.`,
        );
      }
      throw error;
    }
  }

  /**
   * Lists all custom tag definitions for an org.
   */
  async list({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PromptTag[]> {
    return this.prisma.promptTag.findMany({
      where: { organizationId },
      orderBy: { createdAt: "asc" },
    });
  }

  /**
   * Fetches a single custom tag by ID and org (for auth scoping).
   */
  async getById({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<PromptTag | null> {
    return this.prisma.promptTag.findFirst({
      where: { id, organizationId },
    });
  }

  /**
   * Deletes a custom tag definition and cascades to PromptVersionLabel rows
   * for prompts belonging to the same org. Wrapped in a transaction for atomicity.
   */
  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const tag = await tx.promptTag.findFirst({
        where: { id, organizationId },
      });

      if (!tag) {
        return;
      }

      const projects = await tx.project.findMany({
        where: {
          team: { organizationId },
        },
        select: { id: true },
      });

      const projectIds = projects.map((p) => p.id);

      if (projectIds.length > 0) {
        await tx.promptVersionLabel.deleteMany({
          where: {
            label: tag.name,
            projectId: { in: projectIds },
          },
        });
      }

      await tx.promptTag.delete({
        where: { id },
      });

      logger.info({ organizationId, id, name: tag.name }, "Custom prompt tag deleted");
    });
  }

  /**
   * Checks whether a tag name is valid for assignment within an org.
   * Built-in tags (production, staging) are always valid.
   * Custom tags are valid if a definition exists for the org.
   * "latest" is resolved at query time and never assigned.
   */
  async isValidTagForOrg({
    label,
    organizationId,
  }: {
    label: string;
    organizationId: string;
  }): Promise<boolean> {
    if (VALID_TAGS.includes(label as ValidTag)) {
      return true;
    }

    const custom = await this.prisma.promptTag.findFirst({
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
