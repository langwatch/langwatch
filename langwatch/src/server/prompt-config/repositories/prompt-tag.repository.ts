import type { PrismaClient, PromptTag } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { SEEDED_TAGS } from "~/prompts/constants/tags";

const logger = createLogger("langwatch:prompt-tags");

/** Tags that cannot be created or deleted. Only 'latest' is protected — it is resolved at query time. */
export const PROTECTED_TAGS = ["latest"] as const;
export type ProtectedTag = (typeof PROTECTED_TAGS)[number];

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
 * - Must not clash with protected tags
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

  if (PROTECTED_TAGS.includes(name as ProtectedTag)) {
    throw new PromptTagValidationError(
      `"${name}" is a protected tag and cannot be created as a custom tag.`,
    );
  }
}

/**
 * Repository for managing prompt tag definitions.
 * Production and staging are seeded as custom tags per org.
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
   * Deletes a custom tag definition and cascades to PromptTagAssignment rows
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
        await tx.promptTagAssignment.deleteMany({
          where: {
            tag: tag.name,
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
   * All non-protected tags are validated via DB lookup.
   */
  async isValidTagForOrg({
    tag,
    organizationId,
  }: {
    tag: string;
    organizationId: string;
  }): Promise<boolean> {
    const exists = await this.prisma.promptTag.findFirst({
      where: { organizationId, name: tag },
    });
    return exists !== null;
  }

  /**
   * Seeds default tags (production, staging) for a new org.
   */
  async seedForOrg({ organizationId }: { organizationId: string }): Promise<void> {
    await this.prisma.promptTag.createMany({
      data: SEEDED_TAGS.map((tag) => ({
        id: `ptag_${nanoid()}`,
        organizationId,
        name: tag,
      })),
      skipDuplicates: true,
    });
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
