import { savedViewSchema } from "@langwatch/dashboard-contract";
import { Temporal, toDate } from "@langwatch/time";

import type {
  CreateSavedViewInput,
  SavedViewRecord,
  SavedViewRepository,
  UpdateSavedViewInput,
} from "../saved-view.repository.ts";

const DEFAULT_KIND = "v1-traces-filter";

/** The same observable behaviour as the Prisma twin, over one array. */
export class MemorySavedViewRepository implements SavedViewRepository {
  #views: SavedViewRecord[] = [];
  #clock = 0;

  private constructor() {}

  static create(): MemorySavedViewRepository {
    return new MemorySavedViewRepository();
  }

  async findAll(input: {
    projectId: string;
    userId?: string;
    kind?: string;
  }): Promise<SavedViewRecord[]> {
    return this.#visible(input).sort((left, right) => left.order - right.order);
  }

  async findById(input: { id: string; projectId: string }): Promise<SavedViewRecord | undefined> {
    return this.#views.find((view) => view.id === input.id && view.projectId === input.projectId);
  }

  async findLast(input: {
    projectId: string;
    kind?: string;
  }): Promise<SavedViewRecord | undefined> {
    return this.#views
      .filter(
        (view) =>
          view.projectId === input.projectId &&
          (input.kind === undefined || view.kind === input.kind),
      )
      .sort((left, right) => right.order - left.order)[0];
  }

  async findByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<Array<{ id: string; userId: string | null }>> {
    return this.#views
      .filter((view) => view.projectId === input.projectId && input.ids.includes(view.id))
      .map((view) => ({ id: view.id, userId: view.userId }));
  }

  async create(input: CreateSavedViewInput): Promise<SavedViewRecord> {
    const view = this.#row(input);
    this.#views.push(view);
    return view;
  }

  async createMany(input: { views: CreateSavedViewInput[] }): Promise<void> {
    for (const candidate of input.views) {
      // `skipDuplicates`, as the Prisma twin asks for.
      if (this.#views.some((view) => view.id === candidate.id)) continue;
      this.#views.push(this.#row(candidate));
    }
  }

  async update(input: UpdateSavedViewInput): Promise<SavedViewRecord> {
    const view = this.#require(input.id, input.projectId);
    const updated = savedViewSchema.parse({
      ...view,
      ...input.data,
      updatedAt: this.#now(),
    });
    this.#views = this.#views.map((row) => (row.id === view.id ? updated : row));
    return updated;
  }

  async delete(input: { id: string; projectId: string }): Promise<SavedViewRecord> {
    const view = this.#require(input.id, input.projectId);
    this.#views = this.#views.filter((row) => row.id !== view.id);
    return view;
  }

  async updateOrder(input: { projectId: string; viewIds: string[] }): Promise<void> {
    for (const [order, viewId] of input.viewIds.entries()) {
      const view = this.#require(viewId, input.projectId);
      this.#views = this.#views.map((row) =>
        row.id === view.id ? { ...row, order, updatedAt: this.#now() } : row,
      );
    }
  }

  async count(input: { projectId: string; userId?: string; kind?: string }): Promise<number> {
    return this.#visible(input).length;
  }

  #visible(input: { projectId: string; userId?: string; kind?: string }): SavedViewRecord[] {
    return this.#views.filter(
      (view) =>
        view.projectId === input.projectId &&
        (input.kind === undefined || view.kind === input.kind) &&
        (view.userId === null || view.userId === input.userId),
    );
  }

  #row(input: CreateSavedViewInput): SavedViewRecord {
    return savedViewSchema.parse({
      id: input.id,
      projectId: input.projectId,
      userId: input.userId ?? null,
      name: input.name,
      filters: input.filters,
      query: input.query ?? null,
      period: input.period ?? null,
      order: input.order,
      kind: input.kind ?? DEFAULT_KIND,
      createdAt: this.#now(),
      updatedAt: this.#now(),
    });
  }

  /** The Prisma twin's `update` and `delete` refuse an unmatched row; this does too. */
  #require(id: string, projectId: string): SavedViewRecord {
    const view = this.#views.find((row) => row.id === id && row.projectId === projectId);
    if (!view) throw new Error("Saved view row not found");
    return view;
  }

  /** A monotonic clock, so "the newest row" is the one written last. */
  #now(): SavedViewRecord["createdAt"] {
    this.#clock += 1;
    return toDate(Temporal.Instant.fromEpochMilliseconds(this.#clock));
  }
}
