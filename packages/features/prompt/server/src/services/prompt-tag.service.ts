import {
  PromptTagConflictError,
  PromptTagNotFoundError,
  PromptTagProtectedError,
  PromptTagValidationError,
  type PromptTag,
} from "@langwatch/prompt-contract";
import {
  PROTECTED_TAGS,
  PromptTagRepository,
  type ProtectedTag,
} from "../repositories/prompt-tag.repository";

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "P2002"
  );
}

const TAG_NAME_REGEX = /^[a-z][a-z0-9_-]*$/;
const PURELY_NUMERIC_REGEX = /^\d+$/;

/**
 * Service for managing prompt tag definitions.
 */
export class PromptTagService {
  static create(repository: PromptTagRepository): PromptTagService {
    return new PromptTagService(repository);
  }

  private constructor(private readonly repo: PromptTagRepository) {}

  /**
   * Validates a custom tag name.
   */
  static validateTagName(name: string): void {
    if (!name) {
      throw new PromptTagValidationError(`Invalid tag name. Tag name must not be empty.`);
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

  seedForOrganization(input: { organizationId: string }): Promise<void> {
    return this.repo.seedForOrg(input);
  }

  /**
   * Returns all custom tag definitions for the given org.
   */
  async getAll({ organizationId }: { organizationId: string }): Promise<PromptTag[]> {
    return this.repo.findAll({ organizationId });
  }

  /**
   * Creates a custom tag definition for the given org.
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
    PromptTagService.validateTagName(name);

    try {
      return await this.repo.create({ organizationId, name, createdById });
    } catch (error: unknown) {
      if (isUniqueConstraintError(error)) {
        throw new PromptTagConflictError(`A tag with name "${name}" already exists in this org.`);
      }

      throw error;
    }
  }

  /**
   * Deletes a custom tag definition and cascades to PromptTagAssignment rows.
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

    PromptTagService.validateTagName(newName);

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
