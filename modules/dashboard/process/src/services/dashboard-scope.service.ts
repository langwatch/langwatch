import {
  dashboardHomeProductSchema,
  DashboardHomeNeedsOrgScopeError,
  dashboardScopeAfterMove,
  dashboardScopeSchema,
  DashboardScopeAuthorOnlyError,
  homeAllowsScope,
  isDashboardAuthor,
  type Board,
  type DashboardHomeProduct,
  type DashboardScope,
  type DashboardScopeImpact,
  type DashboardViewer,
} from "@langwatch/dashboard-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { BoardRepository } from "../repositories/board.repository.ts";
import type { DashboardAccessService } from "./dashboard-access.service.ts";

/** A board named by a member, from the project they are in. */
type BoardAsk = Readonly<{ projectId: string; dashboardId: string; viewer: DashboardViewer }>;

/**
 * Changing who sees a board, and the product it is homed in. Only its author changes the scope,
 * in the project that owns it; a project administrator is refused like any other member.
 * Spec: dashboards-v2.feature AC174 to AC182; dashboards-organization-area.feature (Move).
 */
export class DashboardScopeService {
  #repository: BoardRepository;
  #access: DashboardAccessService;
  #projects: ProjectApi;

  private constructor(options: {
    repository: BoardRepository;
    access: DashboardAccessService;
    projects: ProjectApi;
  }) {
    this.#repository = options.repository;
    this.#access = options.access;
    this.#projects = options.projects;
  }

  static create(options: {
    repository: BoardRepository;
    access: DashboardAccessService;
    projects: ProjectApi;
  }): DashboardScopeService {
    return new DashboardScopeService(options);
  }

  async setScope(input: BoardAsk & { scope: DashboardScope }): Promise<Board> {
    const scope = dashboardScopeSchema.parse(input.scope);
    const board = await this.#authored(input);
    if (board.scope === scope) return board;
    if (!homeAllowsScope({ homeProduct: board.homeProduct, scope })) {
      throw new DashboardHomeNeedsOrgScopeError(board.homeProduct);
    }

    return this.#repository.updateBoard({
      projectId: board.projectId,
      dashboardId: board.id,
      data: { scope, ...(await this.#organizationStamp({ board, scope })) },
    });
  }

  /**
   * Rehomes a board the member may write here; its owning project never changes. A Project board
   * leaving LLM Ops becomes Only me in the same write, its author's call alone, as setScope is.
   */
  async move(input: BoardAsk & { homeProduct: DashboardHomeProduct }): Promise<Board> {
    const homeProduct = dashboardHomeProductSchema.parse(input.homeProduct);
    const board = await this.#access.getWritable(input);
    if (board.homeProduct === homeProduct) return board;

    const scope = dashboardScopeAfterMove({ board, viewer: input.viewer, homeProduct });
    if (scope === "author-only") throw new DashboardScopeAuthorOnlyError();
    return this.#repository.updateBoard({
      projectId: board.projectId,
      dashboardId: board.id,
      data: { homeProduct, ...(scope === board.scope ? {} : { scope }) },
    });
  }

  /** Stamped once and kept: it is what lists the board in the organization's other projects. */
  async #organizationStamp({
    board,
    scope,
  }: {
    board: Board;
    scope: DashboardScope;
  }): Promise<{ organizationId?: string }> {
    if (scope !== "ORGANIZATION") return {};
    return { organizationId: await this.#projects.getOrganizationId(board.projectId) };
  }

  /** What a narrower scope would take from other members; the author's to read. */
  async getImpact(input: BoardAsk): Promise<DashboardScopeImpact> {
    const board = await this.#authored(input);
    const otherStars = await this.#repository.countOtherStars({
      projectId: board.projectId,
      dashboardId: board.id,
      userId: input.viewer.userId,
    });
    return { otherStars };
  }

  /** The member's own board, in the project that owns it; anyone else is refused by name. */
  async #authored(input: BoardAsk): Promise<Board> {
    const board = await this.#access.getWritable(input);
    if (!isDashboardAuthor({ board, viewer: input.viewer })) {
      throw new DashboardScopeAuthorOnlyError();
    }
    return board;
  }
}
