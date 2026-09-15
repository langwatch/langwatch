import { generate } from "@langwatch/ksuid";
import {
  SAVED_VIEW_KSUID_RESOURCE,
  SavedViewNotFoundError,
  SavedViewReorderUnknownIdsError,
  type SavedViewJson,
} from "@langwatch/dashboard-contract";
import type {
  SavedViewRecord,
  SavedViewRepository,
} from "../repositories/saved-view.repository.ts";

/**
 * Seed views auto-populated on first access for a project. These become
 * regular saved views that can be renamed, deleted, and reordered.
 */
const SEED_VIEWS = [
  { name: "Application", filters: { "traces.origin": ["application"] } },
  { name: "Evaluations", filters: { "traces.origin": ["evaluation"] } },
  { name: "Simulations", filters: { "traces.origin": ["simulation"] } },
  { name: "Playground", filters: { "traces.origin": ["playground"] } },
  { name: "Gateway", filters: { "traces.origin": ["gateway"] } },
];

/** The saved-view lifecycle: seeding, ordering and the personal-ownership rule. */
export class SavedViewService {
  #repository: SavedViewRepository;

  private constructor(repository: SavedViewRepository) {
    this.#repository = repository;
  }

  static create(options: { repository: SavedViewRepository }): SavedViewService {
    return new SavedViewService(options.repository);
  }

  /**
   * Every view a member sees: the project's own plus their personal ones,
   * auto-seeded with the origin defaults on first access.
   */
  async getAll({
    projectId,
    userId,
    kind,
  }: {
    projectId: string;
    userId?: string;
    kind?: string;
  }): Promise<SavedViewRecord[]> {
    // Only seed origin-bucket defaults for the legacy kind. The traces v2 lens
    // system seeds its built-in lenses client-side from code, so seeding on
    // first access here would double-populate the tab strip.
    const isLegacyKind = !kind || kind === "v1-traces-filter";

    if (isLegacyKind) {
      const count = await this.#repository.count({ projectId, userId, kind });
      if (count === 0) {
        await this.#seedViews({ projectId });
      } else {
        await this.#backfillMissingSeedViews({ projectId });
      }
    }

    return await this.#repository.findAll({ projectId, userId, kind });
  }

  /**
   * A new view with auto-incremented order. When userId is provided, the view
   * becomes personal — visible only to that member.
   */
  async createView({
    projectId,
    input,
  }: {
    projectId: string;
    input: {
      /** Optional client-provided id, so a client-generated lens id survives the save. */
      id?: string;
      name: string;
      filters: SavedViewJson;
      query?: string;
      period?: SavedViewJson;
      userId?: string;
      kind?: string;
    };
  }): Promise<SavedViewRecord> {
    // `order` is scoped to the kind so the two storage shapes maintain
    // independent ordering.
    const lastView = await this.#repository.findLast({ projectId, kind: input.kind });
    const newOrder = (lastView?.order ?? -1) + 1;

    return await this.#repository.create({
      id: input.id ?? generate(SAVED_VIEW_KSUID_RESOURCE).toString(),
      projectId,
      userId: input.userId,
      name: input.name,
      filters: input.filters,
      query: input.query,
      period: input.period,
      order: newOrder,
      kind: input.kind,
    });
  }

  /** Deletes a view; a personal view only for the member who owns it. */
  async delete({
    projectId,
    viewId,
    userId,
  }: {
    projectId: string;
    viewId: string;
    userId: string;
  }): Promise<SavedViewRecord> {
    await this.#reachable({ projectId, viewId, userId });

    return await this.#repository.delete({ id: viewId, projectId });
  }

  /** Renames a view, under the same ownership rule. */
  async rename({
    projectId,
    viewId,
    name,
    userId,
  }: {
    projectId: string;
    viewId: string;
    name: string;
    userId: string;
  }): Promise<SavedViewRecord> {
    await this.#reachable({ projectId, viewId, userId });

    return await this.#repository.update({ id: viewId, projectId, data: { name } });
  }

  /**
   * Reorders views. A personal view is only the owner's to move: another
   * member's reads as one this caller does not have, the same absence `delete`
   * and `rename` answer with, so an ordering cannot be probed for whose views
   * exist.
   */
  async reorder({
    projectId,
    viewIds,
    userId,
  }: {
    projectId: string;
    viewIds: string[];
    userId: string;
  }): Promise<{ success: true }> {
    const existingViews = await this.#repository.findByIds({ ids: viewIds, projectId });

    const reachableIds = new Set(
      existingViews
        .filter((view) => view.userId === null || view.userId === userId)
        .map((view) => view.id),
    );
    const missingIds = viewIds.filter((id) => !reachableIds.has(id));

    if (missingIds.length > 0) throw new SavedViewReorderUnknownIdsError(missingIds);

    await this.#repository.updateOrder({ projectId, viewIds });

    return { success: true as const };
  }

  /** A view this member may change, or the absence they are answered with. */
  async #reachable(input: {
    projectId: string;
    viewId: string;
    userId: string;
  }): Promise<SavedViewRecord> {
    const view = await this.#repository.findById({ id: input.viewId, projectId: input.projectId });

    if (!view) throw new SavedViewNotFoundError();
    if (view.userId !== null && view.userId !== input.userId) throw new SavedViewNotFoundError();

    return view;
  }

  /**
   * Seeds a project with the default origin views. `createMany` skips
   * duplicates, so concurrent first access is safe.
   */
  async #seedViews({ projectId }: { projectId: string }): Promise<void> {
    await this.#repository.createMany({
      views: SEED_VIEWS.map((seed, index) => ({
        id: generate(SAVED_VIEW_KSUID_RESOURCE).toString(),
        projectId,
        name: seed.name,
        filters: seed.filters as SavedViewJson,
        order: index,
      })),
    });
  }

  /**
   * Creates seed views missing from already-seeded projects. Identified by
   * name only, so a renamed view is not re-created.
   */
  async #backfillMissingSeedViews({ projectId }: { projectId: string }): Promise<void> {
    const existing = await this.#repository.findAll({ projectId });
    const existingNames = new Set(existing.map((view) => view.name));
    const missing = SEED_VIEWS.filter((seed) => !existingNames.has(seed.name));
    if (missing.length === 0) return;

    const highestOrder = existing.reduce((acc, view) => (view.order > acc ? view.order : acc), -1);
    await this.#repository.createMany({
      views: missing.map((seed, index) => ({
        id: generate(SAVED_VIEW_KSUID_RESOURCE).toString(),
        projectId,
        name: seed.name,
        filters: seed.filters as SavedViewJson,
        order: highestOrder + 1 + index,
      })),
    });
  }
}
