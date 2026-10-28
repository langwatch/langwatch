import {
  DASHBOARD_KSUID_RESOURCE,
  dashboardCreateInputSchema,
  dashboardDetailsUpdateSchema,
  dashboardIdSchema,
  DashboardNotFoundError,
  MY_DASHBOARD_NAME,
  newDashboardScope,
  projectIdSchema,
  type Board,
  type BoardSummary,
  type DashboardViewer,
} from "@langwatch/dashboard-contract";
import { generate } from "@langwatch/ksuid";

import type { BoardRepository } from "../repositories/board.repository.ts";
import type { DashboardAccessService } from "./dashboard-access.service.ts";

type BoardRef = Readonly<{ projectId: string; dashboardId: string; viewer?: DashboardViewer }>;

/**
 * The Dashboards area's boards (DashboardsV2): listing, opening, making, editing and deleting
 * them. Who sees a board is its scope's to say, through the access service; the Analytics
 * Reports boards are DashboardService's. Spec: dashboards-v2.feature AC170 to AC173, AC199.
 */
export class BoardService {
  #repository: BoardRepository;
  #access: DashboardAccessService;

  private constructor(options: { repository: BoardRepository; access: DashboardAccessService }) {
    this.#repository = options.repository;
    this.#access = options.access;
  }

  static create(options: {
    repository: BoardRepository;
    access: DashboardAccessService;
  }): BoardService {
    return new BoardService(options);
  }

  /** The boards the viewer may see here; `includeOrganization` adds the organization's. */
  async findBoards(input: {
    projectId: string;
    viewer?: DashboardViewer;
    includeOrganization?: boolean;
  }): Promise<BoardSummary[]> {
    const projectId = projectIdSchema.parse(input.projectId);
    const listed = await this.#access.listBoards({ projectId, viewer: input.viewer });
    const guests = input.includeOrganization === true ? listed.guests : [];
    const sharedProjectIds = [...new Set(guests.map((board) => board.projectId))];
    // Every guest is a board of the reader's own organization.
    const organizationId = guests[0]?.organizationId ?? null;

    const [starred, owners] = await Promise.all([
      this.#starredIds({ projectId, viewer: input.viewer, sharedProjectIds }),
      this.#access.findProjects({
        organizationId,
        projectIds: sharedProjectIds,
        viewer: input.viewer,
      }),
    ]);
    const ownerById = new Map(owners.map((owner) => [owner.id, owner]));

    return [...listed.home, ...guests].map((board) => ({
      ...board,
      isStarred: starred.has(board.id),
      ownerProject: board.projectId === projectId ? null : (ownerById.get(board.projectId) ?? null),
    }));
  }

  /** The board the viewer may open here, at home or as the organization's guest. */
  async getBoard(input: BoardRef): Promise<Board> {
    const ref = boardRef(input);
    const found = await this.#access.findReadable({ ...ref, viewer: input.viewer });
    if (!found) throw new DashboardNotFoundError(ref.projectId);
    return found.board;
  }

  /**
   * A new board at the scope Project. A member's own My dashboard alone starts starred for them,
   * at Only me (AC160b, AC170); the app refuses it where Dashboards is switched off (AC189).
   */
  async createBoard(input: {
    projectId: string;
    name: string;
    createdById?: string;
  }): Promise<Board> {
    const { createdById, ...fields } = input;
    const parsed = dashboardCreateInputSchema.parse(fields);

    const board = await this.#repository.createBoard({
      id: generate(DASHBOARD_KSUID_RESOURCE).toString(),
      projectId: parsed.projectId,
      name: parsed.name,
      createdById: createdById ?? null,
      scope: newDashboardScope({ name: parsed.name, createdById }),
    });
    // Stored as an ordinary star, so unstarring it later removes it for good.
    if (createdById !== undefined && parsed.name === MY_DASHBOARD_NAME) {
      await this.#repository.addStar({
        projectId: parsed.projectId,
        userId: createdById,
        star: { kind: "board", dashboardId: board.id },
      });
    }
    return board;
  }

  /**
   * The board's name, description and left-out origins; an absent field is left as it is. Only
   * a member who may edit the board changes them (AC200d).
   */
  async updateBoard(
    input: BoardRef & {
      name?: string;
      description?: string | null;
      excludedOrigins?: readonly string[] | null;
    },
  ): Promise<Board> {
    const ref = boardRef(input);
    await this.#access.getWritable({ ...ref, viewer: input.viewer });
    const details = dashboardDetailsUpdateSchema.parse({
      ...(input.name === undefined ? {} : { name: input.name }),
      ...(input.description === undefined ? {} : { description: input.description }),
      ...(input.excludedOrigins === undefined ? {} : { excludedOrigins: input.excludedOrigins }),
    });

    return this.#repository.updateBoard({
      ...ref,
      data: {
        ...details,
        // An emptied description is no description, not an empty paragraph.
        ...(details.description === "" ? { description: null } : {}),
      },
    });
  }

  /** The board, its widgets, every star on it and its stale legacy copy (AC199b). */
  async deleteBoard(input: BoardRef): Promise<Board> {
    const ref = boardRef(input);
    await this.#access.getWritable({ ...ref, viewer: input.viewer });
    return this.#repository.deleteBoard(ref);
  }

  async #starredIds(input: {
    projectId: string;
    viewer?: DashboardViewer;
    sharedProjectIds: readonly string[];
  }): Promise<ReadonlySet<string>> {
    if (input.viewer === undefined) return new Set();
    return new Set(
      await this.#repository.findStarredDashboardIds({
        projectId: input.projectId,
        userId: input.viewer.userId,
        sharedProjectIds: input.sharedProjectIds,
      }),
    );
  }
}

const boardRef = (input: { projectId: string; dashboardId: string }) => ({
  projectId: projectIdSchema.parse(input.projectId),
  dashboardId: dashboardIdSchema.parse(input.dashboardId),
});
