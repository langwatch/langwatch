import { NotFoundError } from "@langwatch/prompt-contract";
import type { PromptTag } from "@langwatch/prompt-contract";
import { nowInstant, toDate, toEpochMs } from "@langwatch/time";
import { nanoid } from "nanoid";

import {
  PromptTagAssignmentRepository,
  TagValidationError,
  type PromptTagAssignmentRow,
} from "../prompt-tag-assignment.repository.ts";
import type { MemoryPromptState } from "./memory-prompt.state.ts";
import { clone, type StoredAssignment } from "./memory-prompt.state.ts";

export class MemoryPromptTagAssignmentRepository extends PromptTagAssignmentRepository {
  readonly #state: MemoryPromptState;

  private constructor(state: MemoryPromptState) {
    super();
    this.#state = state;
  }
  static create(state: MemoryPromptState): MemoryPromptTagAssignmentRepository {
    return new MemoryPromptTagAssignmentRepository(state);
  }
  async validateVersionBelongsToConfig(params: {
    versionId: string;
    configId: string;
    projectId: string;
  }): Promise<void> {
    const version = this.#state.versions.get(params.versionId);
    if (!version || version.configId !== params.configId || version.projectId !== params.projectId)
      throw new TagValidationError("Version does not belong to this prompt config");
  }
  async assignTag(params: {
    configId: string;
    versionId: string;
    tagId: string;
    projectId: string;
    userId?: string;
  }): Promise<PromptTagAssignmentRow & { promptTag: PromptTag }> {
    await this.validateVersionBelongsToConfig(params);
    const tag = this.#state.tags.get(params.tagId);
    if (!tag) {
      throw new NotFoundError(`Prompt tag not found. ID: ${params.tagId}`);
    }
    const current = [...this.#state.assignments.values()].find(
      (row) =>
        row.projectId === params.projectId &&
        row.configId === params.configId &&
        row.tagId === params.tagId,
    );
    const now = toDate(nowInstant());
    const assignment: StoredAssignment = {
      id: current?.id ?? `vtag_${nanoid()}`,
      configId: params.configId,
      versionId: params.versionId,
      tagId: params.tagId,
      projectId: params.projectId,
      createdAt: current?.createdAt ?? now,
      updatedAt: now,
      createdById: current?.createdById ?? params.userId ?? null,
      updatedById: params.userId ?? null,
      promptTag: clone(tag),
    };
    this.#state.assignments.set(assignment.id, assignment);
    return clone(assignment);
  }
  async findTagsForConfig(params: {
    configId: string;
    projectId: string;
  }): Promise<(PromptTagAssignmentRow & { promptTag: PromptTag })[]> {
    return [...this.#state.assignments.values()]
      .filter((row) => row.configId === params.configId && row.projectId === params.projectId)
      .map((row) => this.#withCurrentTag(row))
      .map(clone);
  }
  async findByVersionIds(params: {
    versionIds: string[];
    projectId: string;
  }): Promise<(PromptTagAssignmentRow & { promptTag: PromptTag })[]> {
    return [...this.#state.assignments.values()]
      .filter(
        (row) => row.projectId === params.projectId && params.versionIds.includes(row.versionId),
      )
      .toSorted((a, b) => toEpochMs(a.createdAt) - toEpochMs(b.createdAt))
      .map((row) => this.#withCurrentTag(row))
      .map(clone);
  }
  async findByConfigAndTagId(params: {
    configId: string;
    tagId: string;
    projectId: string;
  }): Promise<PromptTagAssignmentRow> {
    const row = [...this.#state.assignments.values()].find(
      (value) =>
        value.configId === params.configId &&
        value.tagId === params.tagId &&
        value.projectId === params.projectId,
    );
    if (!row)
      throw new NotFoundError(
        `No prompt version carries this tag. Prompt config: ${params.configId}`,
      );
    return clone(row);
  }

  #withCurrentTag(assignment: StoredAssignment): StoredAssignment {
    const promptTag = this.#state.tags.get(assignment.tagId);
    if (!promptTag) return assignment;
    return { ...assignment, promptTag: clone(promptTag) };
  }
}
