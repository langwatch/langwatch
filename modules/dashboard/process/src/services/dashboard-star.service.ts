import {
  dashboardStarSchema,
  DashboardNotFoundError,
  projectIdSchema,
  type DashboardStar,
  type StarredDashboard,
} from "@langwatch/dashboard-contract";

import type { DashboardRepository } from "../repositories/dashboard.repository.ts";
import type { DashboardAccessService } from "./dashboard-access.service.ts";

/** The member whose stars these are, and the project they are looking from. */
type Starring = Readonly<{ projectId: string; userId: string }>;

/**
 * Each member's starred boards and From LangWatch boards, in their own order. A board's star is
 * one row under the project that owns it, so it shows in every project that lists the board; a
 * board the member can no longer see keeps its star, unlisted, until its scope widens again.
 */
export class DashboardStarService {
  #repository: DashboardRepository;
  #access: DashboardAccessService;

  private constructor(repository: DashboardRepository, access: DashboardAccessService) {
    this.#repository = repository;
    this.#access = access;
  }

  static create(options: {
    repository: DashboardRepository;
    access: DashboardAccessService;
  }): DashboardStarService {
    return new DashboardStarService(options.repository, options.access);
  }

  /** The member's stars for this project, boards and templates, in their own order. */
  async listStarred(input: Starring): Promise<StarredDashboard[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    const { visibleIds, sharedProjectIds } = await this.#listed({ ...input, projectId });
    const starred = await this.#repository.findStarred({
      projectId,
      userId: input.userId,
      sharedProjectIds,
    });
    return starred.filter((star) => star.kind === "template" || visibleIds.has(star.dashboard.id));
  }

  /** Stars a board the member may open here, or a template, which only the browser can check. */
  async star(input: Starring & { star: DashboardStar }): Promise<{ success: true }> {
    const projectId = projectIdSchema.parse(input.projectId);
    const star = dashboardStarSchema.parse(input.star);
    const storedUnder = star.kind === "board" ? await this.#ownerOf({ ...input, star }) : projectId;
    if (storedUnder === undefined) throw new DashboardNotFoundError(projectId);

    await this.#repository.addStar({
      projectId: storedUnder,
      userId: input.userId,
      star,
      listedInProjectId: projectId,
    });
    return { success: true as const };
  }

  /** Removes the star; a board the member cannot open here has none to remove. */
  async unstar(input: Starring & { star: DashboardStar }): Promise<{ success: true }> {
    const projectId = projectIdSchema.parse(input.projectId);
    const star = dashboardStarSchema.parse(input.star);
    const storedUnder = star.kind === "board" ? await this.#ownerOf({ ...input, star }) : projectId;
    if (storedUnder !== undefined) {
      await this.#repository.removeStar({ projectId: storedUnder, userId: input.userId, star });
    }
    return { success: true as const };
  }

  async reorderStars(input: Starring & { stars: DashboardStar[] }): Promise<{ success: true }> {
    const projectId = projectIdSchema.parse(input.projectId);
    const { sharedProjectIds } = await this.#listed({ ...input, projectId });
    await this.#repository.reorderStars({
      projectId,
      userId: input.userId,
      sharedProjectIds,
      stars: input.stars.map((star) => dashboardStarSchema.parse(star)),
    });
    return { success: true as const };
  }

  /** The project that owns the board, when the member may open the board here. */
  async #ownerOf(
    input: Starring & { star: Extract<DashboardStar, { kind: "board" }> },
  ): Promise<string | undefined> {
    const found = await this.#access.findReadable({
      projectId: input.projectId,
      dashboardId: input.star.dashboardId,
      viewer: { userId: input.userId },
    });
    return found?.board.projectId;
  }

  /** The boards this project lists for the member, and the other projects that own some. */
  async #listed(
    input: Starring,
  ): Promise<{ visibleIds: ReadonlySet<string>; sharedProjectIds: string[] }> {
    const { home, guests } = await this.#access.listBoards({
      projectId: input.projectId,
      viewer: { userId: input.userId },
      graphKinds: [],
    });
    return {
      visibleIds: new Set([...home, ...guests].map((board) => board.id)),
      sharedProjectIds: [...new Set(guests.map((board) => board.projectId))],
    };
  }
}
