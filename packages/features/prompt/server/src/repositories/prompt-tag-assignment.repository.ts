/**
 * Tag assignments, as the services see them. An assignment links a prompt
 * config and one of its versions to a tag definition; tag validation is the
 * service layer's responsibility.
 */
import type { PromptTag } from "@langwatch/prompt-contract";

export class TagValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TagValidationError";
  }
}

/** A stored assignment row. */
export type PromptTagAssignmentRow = {
  id: string;
  configId: string;
  versionId: string;
  tagId: string;
  projectId: string;
  createdAt: Date;
  updatedAt: Date;
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

  abstract getTagsForConfig(params: {
    configId: string;
    projectId: string;
  }): Promise<(PromptTagAssignmentRow & { promptTag: PromptTag })[]>;

  abstract findByVersionIds(params: {
    versionIds: string[];
    projectId: string;
  }): Promise<(PromptTagAssignmentRow & { promptTag: PromptTag })[]>;

  /**
   * Get a tag assignment by config ID and tagId.
   * Callers must resolve tag name → tagId before calling this method.
   */
  abstract tryGetByConfigAndTagId(params: {
    configId: string;
    tagId: string;
    projectId: string;
  }): Promise<PromptTagAssignmentRow | null>;
}
