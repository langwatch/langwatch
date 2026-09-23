import type { PromptTag } from "@langwatch/prompt-contract";
import { toDate, nowInstant } from "@langwatch/time";
import { nanoid } from "nanoid";

import { PromptTagRepository } from "../prompt-tag.repository.ts";
import { type MemoryPromptState, clone, type StoredTag } from "./memory-prompt.state.ts";

export class MemoryPromptTagRepository extends PromptTagRepository {
  readonly #state: MemoryPromptState;

  private constructor(state: MemoryPromptState) {
    super();
    this.#state = state;
  }
  static create(state: MemoryPromptState): MemoryPromptTagRepository {
    return new MemoryPromptTagRepository(state);
  }
  async create(params: {
    organizationId: string;
    name: string;
    createdById?: string;
  }): Promise<PromptTag> {
    const now = toDate(nowInstant());
    const tag: StoredTag = {
      id: `ptag_${nanoid()}`,
      organizationId: params.organizationId,
      name: params.name,
      createdById: params.createdById ?? null,
      createdAt: now,
      updatedAt: now,
    };
    this.#state.tags.set(tag.id, tag);
    return clone(tag);
  }
  async findAll(params: { organizationId: string }): Promise<PromptTag[]> {
    return [...this.#state.tags.values()]
      .filter((tag) => tag.organizationId === params.organizationId)
      .toSorted((a, b) => (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0))
      .map(clone);
  }
  async findById(params: { id: string; organizationId: string }): Promise<PromptTag | null> {
    const tag = this.#state.tags.get(params.id);
    return tag?.organizationId === params.organizationId ? clone(tag) : null;
  }
  async delete(params: { id: string; organizationId: string }): Promise<void> {
    const tag = await this.findById(params);
    if (!tag) return;
    this.#delete(tag.id);
  }
  async findByName(params: { organizationId: string; name: string }): Promise<PromptTag | null> {
    const tag = [...this.#state.tags.values()].find(
      (value) => value.organizationId === params.organizationId && value.name === params.name,
    );
    return tag ? clone(tag) : null;
  }
  async deleteByName(params: { organizationId: string; name: string }): Promise<void> {
    const tag = await this.findByName(params);
    if (tag) this.#delete(tag.id);
  }
  async rename(params: {
    organizationId: string;
    oldName: string;
    newName: string;
  }): Promise<PromptTag> {
    const tag = await this.findByName({
      organizationId: params.organizationId,
      name: params.oldName,
    });
    if (!tag) {
      throw new Error(`Tag "${params.oldName}" not found`);
    }
    const updated: StoredTag = { ...tag, name: params.newName, updatedAt: toDate(nowInstant()) };
    this.#state.tags.set(updated.id, updated);
    return clone(updated);
  }
  async existsForOrg(params: { tag: string; organizationId: string }): Promise<boolean> {
    return (
      (await this.findByName({ organizationId: params.organizationId, name: params.tag })) !== null
    );
  }
  async findByOrgAndName(params: {
    organizationId: string;
    name: string;
  }): Promise<PromptTag | null> {
    return this.findByName(params);
  }
  async seedForOrg(params: { organizationId: string }): Promise<void> {
    for (const name of ["production", "staging"]) {
      if (!(await this.findByName({ ...params, name }))) await this.create({ ...params, name });
    }
  }
  #delete(tagId: string): void {
    this.#state.tags.delete(tagId);
    for (const [id, assignment] of this.#state.assignments)
      if (assignment.tagId === tagId) this.#state.assignments.delete(id);
  }
}
