import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  type PromptTag,
} from "@langwatch/prompt-contract";
import type { PrismaClient } from "../repositories/prisma/prisma.prompt.repository";
function isUniqueConstraintError(error: unknown): boolean {
  return typeof error === "object" && error !== null && "code" in error && (error as { code?: unknown }).code === "P2002";
}
import {
  PROTECTED_TAGS,
  PromptTagRepository,
  type ProtectedTag,
} from "../repositories/prisma/prisma.prompt-tag.repository";

const TAG_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;
const PURELY_NUMERIC_REGEX = /^\d+$/;

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
 * Service for managing prompt tag definitions.
 *
 * Owns all business logic for custom tag CRUD:
 * - validates tag names before persistence
 * - delegates persistence to PromptTagRepository
 * - enforces the protected tag guard on delete
 */
export class PromptTagService {
  constructor(private readonly repo: PromptTagRepository) {}

  static create(prisma: PrismaClient): PromptTagService {
    return new PromptTagService(new PromptTagRepository(prisma));
  }

  seedForOrganization(input: { organizationId: string }): Promise<void> {
    return this.repo.seedForOrg(input);
  }

  /**
   * Returns all custom tag definitions for the given org.
   */
  async getAll({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<PromptTag[]> {
    return this.repo.findAll({ organizationId });
  }

  /**
   * Creates a custom tag definition for the given org.
   *
   * @throws {PromptTagValidationError} if the tag name is invalid
   * @throws {PromptTagConflictError} if a tag with that name already exists
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
      return await this.repo.create({ organizationId, name, createdById });
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
   * Deletes a custom tag definition and cascades to PromptTagAssignment rows.
   *
   * Returns the deleted tag, or null if it was not found.
   *
   * @throws {PromptTagProtectedError} if the tag is a protected system tag
   */
  async tryDelete({
    id,
    organizationId,
  }: {
    id: string;
    organizationId: string;
  }): Promise<PromptTag | null> {
    const tag = await this.repo.tryFindById({ id, organizationId });

    if (!tag) {
      return null;
    }

    if (PROTECTED_TAGS.includes(tag.name as ProtectedTag)) {
      throw new PromptTagProtectedError(tag.name);
    }

    await this.repo.delete({ id, organizationId });

    return tag;
  }

  /**
   * Deletes a custom tag definition by name and cascades to PromptTagAssignment rows.
   *
   * Returns the deleted tag, or null if it was not found.
   *
   * @throws {PromptTagProtectedError} if the tag is a protected system tag
   */
  async tryDeleteByName({
    organizationId,
    name,
  }: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null> {
    if (PROTECTED_TAGS.includes(name as ProtectedTag)) {
      throw new PromptTagProtectedError(name);
    }

    const tag = await this.repo.tryFindByName({ organizationId, name });

    if (!tag) {
      return null;
    }

    await this.repo.deleteByName({ organizationId, name });

    return tag;
  }

  /**
   * Renames a tag definition and updates all corresponding PromptTagAssignment rows.
   *
   * @throws {PromptTagValidationError} if the new name is invalid
   * @throws {PromptTagProtectedError} if the old tag name is a protected system tag
   * @throws {PromptTagConflictError} if a tag with the new name already exists
   */
  async rename({
    organizationId,
    oldName,
    newName,
  }: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    if (PROTECTED_TAGS.includes(oldName as ProtectedTag)) {
      throw new PromptTagProtectedError(oldName, "renamed");
    }

    validateTagName(newName);

    try {
      return await this.repo.rename({ organizationId, oldName, newName });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new PromptTagConflictError(
          `A tag with name "${newName}" already exists in this org.`,
        );
      }
      if (error instanceof Error && error.message.includes("not found")) {
        throw new PromptTagNotFoundError(oldName);
      }
      throw error;
    }
  }
}
