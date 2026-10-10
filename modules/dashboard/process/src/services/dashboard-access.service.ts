import {
  dashboardsListedFor,
  dashboardStanding,
  DashboardNotFoundError,
  DashboardReadOnlyHereError,
  type DashboardPlace,
  type DashboardProject,
  type DashboardStanding,
  type DashboardViewer,
} from "@langwatch/dashboard-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type {
  DashboardGraphKind,
  DashboardRecord,
  DashboardRepository,
  DashboardSummaryRecord,
  GraphRecord,
} from "../repositories/dashboard.repository.ts";

/** The `release_dashboards` rollout, resolved for one project. */
export interface DashboardsRollout {
  isDashboardsEnabled(input: { projectId: string }): Promise<boolean>;
}

/** Who is reading, from which project; no viewer is a project credential. */
export type BoardReading = Readonly<{ projectId: string; viewer?: DashboardViewer }>;

/** A board the reader may open here, and how they stand to it. */
export type ReadableBoard = Readonly<{
  board: DashboardRecord;
  standing: Exclude<DashboardStanding, "none">;
}>;

/**
 * The scope rules applied to stored boards: who sees which board from which project, and who
 * may write it. A board the reader may not see answers exactly as one that does not exist.
 * Spec: dashboards-v2.feature AC171 to AC173.
 */
export class DashboardAccessService {
  #repository: DashboardRepository;
  #projects: ProjectApi;
  #rollout: DashboardsRollout;

  private constructor(options: {
    repository: DashboardRepository;
    projects: ProjectApi;
    rollout: DashboardsRollout;
  }) {
    this.#repository = options.repository;
    this.#projects = options.projects;
    this.#rollout = options.rollout;
  }

  static create(options: {
    repository: DashboardRepository;
    projects: ProjectApi;
    rollout: DashboardsRollout;
  }): DashboardAccessService {
    return new DashboardAccessService(options);
  }

  /** Whether Dashboards is switched on for the project: where it is off, scope offers nothing. */
  isDashboardsEnabled({ projectId }: { projectId: string }): Promise<boolean> {
    return this.#rollout.isDashboardsEnabled({ projectId });
  }

  /**
   * The project a read is made from, with the organization whose shared boards it lists. A
   * project with Dashboards off has none, so another project's board is not there for it.
   */
  async placeOf({ projectId }: { projectId: string }): Promise<DashboardPlace> {
    const enabled = await this.isDashboardsEnabled({ projectId });
    return {
      projectId,
      organizationId: enabled ? await this.#projects.findOrganizationId(projectId) : void 0,
    };
  }

  /** The boards the reader's project lists: its own they may see, then the organization's. */
  async listBoards(
    input: BoardReading & { graphKinds: readonly DashboardGraphKind[] },
  ): Promise<{ home: DashboardSummaryRecord[]; guests: DashboardSummaryRecord[] }> {
    const place = await this.placeOf(input);
    const boards = await this.#repository.findAllDashboards({
      ...reachOf(place),
      graphKinds: input.graphKinds,
    });
    return dashboardsListedFor({ boards, viewer: input.viewer, place });
  }

  /** The board when the reader may open it here: at home, or as the organization's guest. */
  async findReadable(
    input: BoardReading & { dashboardId: string },
  ): Promise<ReadableBoard | undefined> {
    const atHome = await this.#findAtHome(input);
    if (atHome !== "elsewhere") return atHome;

    const place = await this.placeOf(input);
    const [board] = await this.#repository.findDashboards({
      ...reachOf(place),
      dashboardIds: [input.dashboardId],
    });
    if (!board) return undefined;

    const standing = dashboardStanding({ board, viewer: input.viewer, place });
    return standing === "none" ? undefined : { board, standing };
  }

  /** The board with its builder graphs, when the reader may open it here. */
  async findWithGraphs(
    input: BoardReading & { dashboardId: string },
  ): Promise<(DashboardRecord & { graphs: GraphRecord[] }) | undefined> {
    const place = await this.placeOf(input);
    const board = await this.#repository.findDashboard({
      ...reachOf(place),
      dashboardId: input.dashboardId,
    });
    if (!board) return undefined;
    return dashboardStanding({ board, viewer: input.viewer, place }) === "none" ? undefined : board;
  }

  /**
   * The project's own board, for a write. A board the reader may not see is not found; one the
   * organization shows here is refused as read-only, since they can plainly read it.
   */
  async getWritable(input: BoardReading & { dashboardId: string }): Promise<DashboardRecord> {
    const found = await this.findReadable(input);
    if (!found) throw new DashboardNotFoundError(input.projectId);
    if (found.standing === "guest") throw new DashboardReadOnlyHereError(input.projectId);
    return found.board;
  }

  /** Whether the project holds this board and the reader may write it. */
  async isWritable(input: BoardReading & { dashboardId: string }): Promise<boolean> {
    const found = await this.#findAtHome(input);
    return found !== undefined && found !== "elsewhere";
  }

  /** Whether the project holds this board and the reader may not see it. */
  async isHidden(input: BoardReading & { dashboardId: string }): Promise<boolean> {
    return (await this.#findAtHome(input)) === undefined;
  }

  /** The project's own boards the reader may not see: another member's Only me boards. */
  async findHiddenBoardIds(input: BoardReading): Promise<ReadonlySet<string>> {
    const boards = await this.#repository.findAllDashboards({
      projectId: input.projectId,
      graphKinds: [],
    });
    const place = { projectId: input.projectId, organizationId: void 0 };
    const hidden = boards.filter(
      (board) => dashboardStanding({ board, viewer: input.viewer, place }) === "none",
    );
    return new Set(hidden.map((board) => board.id));
  }

  /** The projects that own these boards, as a list names them. */
  async findProjects({ projectIds }: { projectIds: string[] }): Promise<DashboardProject[]> {
    if (projectIds.length === 0) return [];
    const projects = await this.#projects.listNamesByIds({ projectIds });
    return projects.map(({ id, name, slug }) => ({ id, name, slug }));
  }

  /** Read without asking the project peer: most reads and every write are of an own board. */
  async #findAtHome(
    input: BoardReading & { dashboardId: string },
  ): Promise<ReadableBoard | undefined | "elsewhere"> {
    const [board] = await this.#repository.findDashboards({
      projectId: input.projectId,
      dashboardIds: [input.dashboardId],
    });
    if (!board) return "elsewhere";

    const place = { projectId: input.projectId, organizationId: void 0 };
    const visible = dashboardStanding({ board, viewer: input.viewer, place }) === "home";
    return visible ? { board, standing: "home" } : undefined;
  }
}

/** The repository reach of a place: its organization's shared boards when it has one. */
function reachOf(place: DashboardPlace): { projectId: string; organizationId?: string } {
  return place.organizationId === undefined
    ? { projectId: place.projectId }
    : { projectId: place.projectId, organizationId: place.organizationId };
}
