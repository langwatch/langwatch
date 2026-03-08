import type { Prisma, PrismaClient } from "@prisma/client";
import { nanoid } from "nanoid";
import { SavedViewNotFoundError, SavedViewReorderError } from "./errors";
import { SavedViewRepository } from "./saved-view.repository";

/**
 * Seed views auto-populated on first access for a project.
 * These become regular saved views that can be renamed, deleted, and reordered.
 */
const SEED_VIEWS = [
  { name: "Application", filters: { "traces.origin": ["application"] } },
  { name: "Evaluations", filters: { "traces.origin": ["evaluation"] } },
  { name: "Simulations", filters: { "traces.origin": ["simulation"] } },
  { name: "Playground", filters: { "traces.origin": ["playground"] } },
];

/**
 * Service layer for saved view business logic.
 * Single Responsibility: Saved view lifecycle management.
 *
 * Framework-agnostic - no tRPC dependencies.
 * Throws domain-specific errors that can be mapped by the router layer.
 */
export class SavedViewService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly repository: SavedViewRepository,
  ) {}

  /**
   * Static factory method for creating a SavedViewService with proper DI.
   */
  static create(prisma: PrismaClient): SavedViewService {
    const repository = new SavedViewRepository(prisma);
    return new SavedViewService(prisma, repository);
  }

  /**
   * Gets all saved views for a project visible to a user.
   * Returns project-level views (userId IS NULL) plus the user's personal views.
   * Auto-seeds with default origin views on first access.
   */
  async getAll(projectId: string, userId?: string) {
    const count = await this.repository.count({ projectId, userId });

    if (count === 0) {
      await this.seedViews(projectId);
    }

    return await this.repository.findAll({ projectId, userId });
  }

  /**
   * Creates a new saved view with auto-incremented order.
   * When userId is provided, the view becomes personal (only visible to that user).
   */
  // biome-ignore lint/suspicious/useAdjacentOverloadSignatures: not an overload - static create() creates service, instance create() creates view
  async create(
    projectId: string,
    input: {
      name: string;
      filters: Prisma.InputJsonValue;
      query?: string;
      period?: Prisma.InputJsonValue;
      userId?: string;
    },
  ) {
    const lastView = await this.repository.findLast({ projectId });
    const newOrder = (lastView?.order ?? -1) + 1;

    return await this.repository.create({
      id: nanoid(),
      projectId,
      userId: input.userId,
      name: input.name,
      filters: input.filters,
      query: input.query,
      period: input.period,
      order: newOrder,
    });
  }

  /**
   * Deletes a saved view.
   * @throws {SavedViewNotFoundError} if view doesn't exist
   */
  async delete(projectId: string, viewId: string) {
    const view = await this.repository.findById({
      id: viewId,
      projectId,
    });

    if (!view) {
      throw new SavedViewNotFoundError();
    }

    return await this.repository.delete({
      id: viewId,
      projectId,
    });
  }

  /**
   * Renames a saved view.
   * @throws {SavedViewNotFoundError} if view doesn't exist
   */
  async rename(projectId: string, viewId: string, name: string) {
    const view = await this.repository.findById({
      id: viewId,
      projectId,
    });

    if (!view) {
      throw new SavedViewNotFoundError();
    }

    return await this.repository.update({
      id: viewId,
      projectId,
      data: { name },
    });
  }

  /**
   * Reorders saved views by updating their order field.
   * @throws {SavedViewReorderError} if any view doesn't exist
   */
  async reorder(projectId: string, viewIds: string[]) {
    const existingViews = await this.repository.findByIds({
      ids: viewIds,
      projectId,
    });

    const existingIds = new Set(existingViews.map((v) => v.id));
    const missingIds = viewIds.filter((id) => !existingIds.has(id));

    if (missingIds.length > 0) {
      throw new SavedViewReorderError(missingIds);
    }

    await this.repository.updateOrder({ projectId, viewIds });

    return { success: true };
  }

  /**
   * Seeds a project with default origin-based views.
   */
  private async seedViews(projectId: string) {
    for (let i = 0; i < SEED_VIEWS.length; i++) {
      const seed = SEED_VIEWS[i]!;
      await this.repository.create({
        id: nanoid(),
        projectId,
        name: seed.name,
        filters: seed.filters as Prisma.InputJsonValue,
        order: i,
      });
    }
  }
}
