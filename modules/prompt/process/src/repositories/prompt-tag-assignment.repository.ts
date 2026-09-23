/**
 * Tag assignments, as the services see them. An assignment links a prompt
 * config and one of its versions to a tag definition; tag validation is the
 * service layer's responsibility.
 */
import type { PromptTag } from "@langwatch/prompt-contract";
import type { TimeInput } from "@langwatch/time";

/**
 * An invalid tag or tag/version pairing. The contract's own refusal, re-exported under the name
 * this repository's callers already use: a plain Error here reached the boundary unattributed, so
 * `PUT /api/prompts/{id}/tags/{tag}` answered 500 where it owed the caller a named 4xx.
 */
export { PromptTagInvalidError as TagValidationError } from "@langwatch/prompt-contract";

/** A stored assignment row. */
export type PromptTagAssignmentRow = {
  id: string;
  configId: string;
  versionId: string;
  tagId: string;
  projectId: string;
  createdAt: TimeInput;
  updatedAt: TimeInput;
  createdById: string | null;
  updatedById: string | null;
};

/** Repository for managing prompt version tag assignments. */
export abstract class PromptTagAssignmentRepository {
  /** Validates that a version belongs to the specified prompt config. */
  abstract validateVersionBelongsToConfig(params: {
    versionId: string;
    configId: string;
    projectId: string;
  }): Promise<void>;

  abstract assignTag(params: {
    configId: string;
    versionId: string;
    tagId: string;
    projectId: string;
    userId?: string;
  }): Promise<PromptTagAssignmentRow & { promptTag: PromptTag }>;

  abstract findTagsForConfig(params: {
    configId: string;
    projectId: string;
  }): Promise<(PromptTagAssignmentRow & { promptTag: PromptTag })[]>;

  abstract findByVersionIds(params: {
    versionIds: string[];
    projectId: string;
  }): Promise<(PromptTagAssignmentRow & { promptTag: PromptTag })[]>;

  /**
   * Get a tag assignment by config ID and tagId, refusing when the config
   * carries no version under that tag.
   * Callers must resolve tag name → tagId before calling this method.
   */
  abstract findByConfigAndTagId(params: {
    configId: string;
    tagId: string;
    projectId: string;
  }): Promise<PromptTagAssignmentRow>;
}
