import {
  DashboardNotFoundError,
  dashboardSchema,
  type DashboardScope,
  type DashboardStar,
  type StarredDashboard,
} from "@langwatch/dashboard-contract";

import type {
  BoardReach,
  BoardRecord,
  BoardRepository,
  BoardSummaryRecord,
  BoardUpdate,
  MemberStars,
} from "../board.repository.ts";
import { MemoryDashboardDatabase, type StoredFavourite } from "./memory.dashboard.database.ts";

/** The same observable behaviour as the Prisma twin, over the shared memory tables. */
export class MemoryBoardRepository implements BoardRepository {
  #database: MemoryDashboardDatabase;

  private constructor(database: MemoryDashboardDatabase) {
    this.#database = database;
  }

  /** `database` is shared with the module's other memory repositories; a fresh one otherwise. */
  static create(options: { database?: MemoryDashboardDatabase } = {}): MemoryBoardRepository {
    return new MemoryBoardRepository(options.database ?? MemoryDashboardDatabase.create());
  }

  async findBoards(input: BoardReach): Promise<BoardSummaryRecord[]> {
    const reached = this.#database.boards.filter((board) => reaches(input, board));
    const isOwn = (board: BoardRecord) => board.projectId === input.projectId;
    return [...reached.filter(isOwn), ...reached.filter((board) => !isOwn(board))].map((board) => ({
      ...board,
      graphCount: this.#database.widgets.filter(
        (widget) => widget.projectId === board.projectId && widget.dashboardId === board.id,
      ).length,
    }));
  }

  async findBoardsByIds(
    input: BoardReach & { dashboardIds: readonly string[] },
  ): Promise<BoardRecord[]> {
    return this.#database.boards.filter(
      (board) => input.dashboardIds.includes(board.id) && reaches(input, board),
    );
  }

  async createBoard(input: {
    id: string;
    projectId: string;
    name: string;
    createdById?: string | null;
    scope?: DashboardScope;
  }): Promise<BoardRecord> {
    const board = dashboardSchema.parse({
      ...input,
      order: 0,
      description: null,
      createdById: input.createdById ?? null,
      scope: input.scope ?? "PROJECT",
      organizationId: null,
      createdAt: this.#database.now(),
      updatedAt: this.#database.now(),
    });
    this.#database.boards.push(board);
    return board;
  }

  async updateBoard(input: {
    projectId: string;
    dashboardId: string;
    data: BoardUpdate;
  }): Promise<BoardRecord> {
    const board = this.#requireBoard(input);
    const updated = dashboardSchema.parse({
      ...board,
      ...Object.fromEntries(Object.entries(input.data).filter(([, value]) => value !== undefined)),
      updatedAt: this.#database.now(),
    });
    this.#database.boards = this.#database.boards.map((row) => (row === board ? updated : row));
    return updated;
  }

  async deleteBoard(input: { projectId: string; dashboardId: string }): Promise<BoardRecord> {
    const board = this.#database.boards.find(
      (row) => row.id === input.dashboardId && row.projectId === input.projectId,
    );
    if (!board) throw new DashboardNotFoundError(input.projectId);
    const database = this.#database;
    const onBoard = (row: { projectId: string; dashboardId: string | null }) =>
      row.projectId === board.projectId && row.dashboardId === board.id;
    database.boards = database.boards.filter((row) => row !== board);
    database.widgets = database.widgets.filter((row) => !onBoard(row));
    database.favourites = database.favourites.filter((row) => !onBoard(row));
    database.charts = database.charts.filter(
      (row) => !(onBoard(row) && row.kind === "dashboard_srcdoc"),
    );
    if (!database.charts.some(onBoard)) {
      database.dashboards = database.dashboards.filter(
        (row) => !(row.id === board.id && row.projectId === board.projectId),
      );
    }
    return board;
  }

  async findStarred(input: MemberStars): Promise<StarredDashboard[]> {
    const owners = starProjects(input);
    return this.#starred(input).flatMap((favourite): StarredDashboard[] => {
      if (favourite.templateId !== null) {
        return [{ kind: "template", templateId: favourite.templateId }];
      }
      const dashboard = this.#database.boards.find(
        (row) => row.id === favourite.dashboardId && owners.includes(row.projectId),
      );
      return dashboard ? [{ kind: "board", dashboard }] : [];
    });
  }

  async findStarredDashboardIds(input: MemberStars): Promise<string[]> {
    return this.#starred(input).flatMap((favourite) =>
      favourite.dashboardId === null ? [] : [favourite.dashboardId],
    );
  }

  async addStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
    listedInProjectId?: string;
  }): Promise<void> {
    if (this.#favourite(input)) return;
    const listedIn = [input.projectId, input.listedInProjectId ?? input.projectId];
    const positions = this.#database.favourites
      .filter((row) => row.userId === input.userId && listedIn.includes(row.projectId))
      .map((row) => row.position);
    this.#database.favourites.push({
      id: this.#database.nextFavouriteId(),
      userId: input.userId,
      projectId: input.projectId,
      dashboardId: input.star.kind === "board" ? input.star.dashboardId : null,
      templateId: input.star.kind === "template" ? input.star.templateId : null,
      position: Math.max(-1, ...positions) + 1,
    });
  }

  async removeStar(input: {
    projectId: string;
    userId: string;
    star: DashboardStar;
  }): Promise<void> {
    const found = this.#favourite(input);
    this.#database.favourites = this.#database.favourites.filter((row) => row !== found);
  }

  async reorderStars(input: MemberStars & { stars: DashboardStar[] }): Promise<void> {
    for (const [position, star] of input.stars.entries()) {
      const favourite = this.#favourite({ ...input, star });
      if (favourite) favourite.position = position;
    }
  }

  async countOtherStars(input: {
    projectId: string;
    dashboardId: string;
    userId: string;
  }): Promise<number> {
    return this.#database.favourites.filter(
      (row) =>
        row.projectId === input.projectId &&
        row.dashboardId === input.dashboardId &&
        row.userId !== input.userId,
    ).length;
  }

  /** The member's favourites as this project lists them, in position order. */
  #starred(input: MemberStars): StoredFavourite[] {
    const owners = starProjects(input);
    return this.#database.favourites
      .filter(
        (row) =>
          row.userId === input.userId &&
          (row.projectId === input.projectId ||
            (row.dashboardId !== null && owners.includes(row.projectId))),
      )
      .toSorted((left, right) => left.position - right.position);
  }

  #favourite(input: MemberStars & { star: DashboardStar }): StoredFavourite | undefined {
    return this.#starred(input).find((row) =>
      input.star.kind === "board"
        ? row.dashboardId === input.star.dashboardId
        : row.templateId === input.star.templateId,
    );
  }

  /** The Prisma twin's `update` refuses an unmatched row; this does too. */
  #requireBoard(input: { projectId: string; dashboardId: string }): BoardRecord {
    const board = this.#database.boards.find(
      (row) => row.id === input.dashboardId && row.projectId === input.projectId,
    );
    if (!board) throw new Error("DashboardsV2 row not found");
    return board;
  }
}

/** Whether a read from this project, and its organization's live projects, reaches the board. */
function reaches({ projectId, organization }: BoardReach, board: BoardRecord): boolean {
  if (board.projectId === projectId) return true;
  return (
    organization !== undefined &&
    board.scope === "ORGANIZATION" &&
    board.organizationId === organization.organizationId &&
    organization.liveProjectIds.includes(board.projectId)
  );
}

/** Every project whose stars this project lists: its own, then the shared boards' owners. */
const starProjects = ({ projectId, sharedProjectIds = [] }: MemberStars): string[] => [
  projectId,
  ...sharedProjectIds,
];
