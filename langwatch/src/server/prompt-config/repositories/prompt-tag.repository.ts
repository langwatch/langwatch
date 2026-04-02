import type { PrismaClient, PromptTag } from "@prisma/client";
import { nanoid } from "nanoid";
import { createLogger } from "~/utils/logger";
import { SEEDED_TAGS } from "~/prompts/constants/tags";

const logger = createLogger("langwatch:prompt-tags");

/** Tags that cannot be created or deleted. Only 'latest' is protected — it is resolved at query time. */
export const PROTECTED_TAGS = ["latest"] as const;
export type ProtectedTag = (typeof PROTECTED_TAGS)[number];

/**
 * Repository for managing prompt tag definitions.
 * Production and staging are seeded as custom tags per org.
 */
export class PromptTagRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Creates a custom tag definition for an org.
   * Name validation is the caller's responsibility.
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
  }

  /**
   * Lists all custom tag definitions for an org.
   */
  async findAll({
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
  async findById({
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
   * Deletes a custom tag definition.
   * PromptTagAssignment rows are removed automatically via the FK onDelete: Cascade.
   */
  async delete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<void> {
    const tag = await this.prisma.promptTag.findFirst({
      where: { id, organizationId },
    });

    if (!tag) {
      return;
    }

    await this.prisma.promptTag.delete({
      where: { id },
    });

    logger.info({ organizationId, id, name: tag.name }, "Custom prompt tag deleted");
  }

  /**
   * Checks whether a tag definition exists for an org.
   */
  async existsForOrg({
    tag,
    organizationId,
  }: {
    tag: string;
    organizationId: string;
  }): Promise<boolean> {
    const found = await this.prisma.promptTag.findFirst({
      where: { organizationId, name: tag },
    });
    return found !== null;
  }

  /**
   * Finds a tag definition by org and name. Returns null if not found.
   */
  async findByOrgAndName({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null> {
    return this.prisma.promptTag.findFirst({
      where: { organizationId, name },
    });
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
