import {
  DashboardNotFoundError,
  dashboardStanding,
  DashboardsNotEnabledError,
  type DashboardProject,
  type DashboardViewer,
  type OrganizationBoard,
} from "@langwatch/dashboard-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { UserApi } from "@langwatch/user-contract";

import type { BoardRecord, BoardRepository } from "../repositories/board.repository.ts";
import type { DashboardAccessService } from "./dashboard-access.service.ts";

type Reading = Readonly<{ organizationId: string; viewer: DashboardViewer }>;

/** By name, then id, so two projects of one name always list in the same order. */
const byName = (projects: readonly DashboardProject[]): DashboardProject[] =>
  projects.toSorted((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

/**
 * The organization's Dashboards library (ADR-002). The door asks `organization:view`; one grant
 * read names the projects with `analytics:view`, the release flag is read for those and for
 * Organization boards' owners only, and a project with Dashboards off lists nothing.
 */
export class OrganizationBoardService {
  #repository: BoardRepository;
  #access: DashboardAccessService;
  #projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization">;
  #users: Pick<UserApi, "getProfiles">;

  private constructor(options: {
    repository: BoardRepository;
    access: DashboardAccessService;
    projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization">;
    users: Pick<UserApi, "getProfiles">;
  }) {
    this.#repository = options.repository;
    this.#access = options.access;
    this.#projects = options.projects;
    this.#users = options.users;
  }

  static create(options: {
    repository: BoardRepository;
    access: DashboardAccessService;
    projects: Pick<ProjectApi, "findLiveNonGovernanceIdsByOrganization">;
    users: Pick<UserApi, "getProfiles">;
  }): OrganizationBoardService {
    return new OrganizationBoardService(options);
  }

  /**
   * The member's boards in readable projects, and every Organization board, its owner named
   * only where readable. Stars stay stored but no longer place a board, so none is read here.
   * Refused as not enabled when none of the projects it reads has Dashboards on.
   */
  async findBoards({ organizationId, viewer }: Reading): Promise<OrganizationBoard[]> {
    const liveIds = await this.#liveIds({ organizationId });
    const [readable, boards] = await Promise.all([
      this.#access.findProjects({ organizationId, projectIds: liveIds, viewer }),
      this.#repository.findBoardsInProjects({ projectIds: liveIds }),
    ]);
    // With no project to open in, even an Organization board is nowhere the member can read it.
    if (readable.length === 0) return [];
    const sharedOwnerIds = boards
      .filter((board) => board.scope === "ORGANIZATION" && board.organizationId === organizationId)
      .map((board) => board.projectId);
    const enabled = await this.#enabledIds([...readable.map(({ id }) => id), ...sharedOwnerIds]);
    const opensIn = byName(readable.filter(({ id }) => enabled.includes(id)));
    // No readable project with Dashboards on: no board could open, an Organization one included.
    if (opensIn.length === 0) throw new DashboardsNotEnabledError({ scope: "organization" });
    const opensInById = new Map(opensIn.map((project) => [project.id, project]));
    // An unreadable owner's Organization board opens as a guest in a project the member reads.
    const [guestProject] = opensIn;
    const listed = boards.flatMap((board) => {
      if (!enabled.includes(board.projectId)) return [];
      const project = opensInById.get(board.projectId) ?? null;
      if (!isListed({ board, viewer, organizationId, isReadable: project !== null })) return [];
      return [{ board, project }];
    });
    // Only a readable project's author is named; an unreadable owner names nobody.
    const namedAuthors = listed.flatMap(({ board, project }) =>
      project ? [board.createdById] : [],
    );
    const ownerNames = await this.#ownerNames(namedAuthors);
    return listed.map(({ board, project }) => {
      const author = authorOf({ board, isReadable: project !== null, viewer, ownerNames });
      return libraryRow({
        board: {
          ...board,
          createdById: author.createdById,
          // Only the reader's own mark is named; another member's My dashboard reads as any board.
          myDashboardOfUserId:
            board.myDashboardOfUserId === viewer.userId ? board.myDashboardOfUserId : null,
        },
        project,
        openProject: project ?? guestProject ?? null,
        ownerName: author.ownerName,
      });
    });
  }

  /** Each listed author's display name, by user id, read once for the whole list. */
  async #ownerNames(authorIds: readonly (string | null)[]): Promise<Map<string, string>> {
    const userIds = [...new Set(authorIds.flatMap((id) => (id === null ? [] : [id])))];
    if (userIds.length === 0) return new Map();
    const profiles = await this.#users.getProfiles({ userIds });
    return new Map(profiles.flatMap((user) => (user.name ? [[user.id, user.name] as const] : [])));
  }

  /**
   * One board as `findBoards` lists it, so an id never reveals more than the library does: a
   * board it leaves out, another organization's included, answers not found.
   */
  async getBoard({
    organizationId,
    viewer,
    dashboardId,
  }: Reading & { dashboardId: string }): Promise<OrganizationBoard> {
    // The whole list, not one row: the visibility rule then lives in one place (ADR-002).
    const boards = await this.findBoards({ organizationId, viewer });
    const board = boards.find(({ id }) => id === dashboardId);
    if (!board) throw new DashboardNotFoundError({ organizationId });
    return board;
  }

  /**
   * Where a board made outside a project view may be stored: projects with Dashboards on where
   * the member holds `analytics:create`, by name (ADR-002, decision 3). Another member's
   * personal project is never one, even to an admin who may create there.
   */
  async findStoreProjects({ organizationId, viewer }: Reading): Promise<DashboardProject[]> {
    const projectIds = await this.#liveIds({ organizationId });
    const permission = "analytics:create";
    const mayCreate = await this.#access.findProjects({
      organizationId,
      projectIds,
      viewer,
      permission,
      shouldSkipOthersPersonal: true,
    });
    const enabled = await this.#enabledIds(mayCreate.map(({ id }) => id));
    return byName(mayCreate.filter(({ id }) => enabled.includes(id)));
  }

  #liveIds({ organizationId }: { organizationId: string }): Promise<string[]> {
    return this.#projects.findLiveNonGovernanceIdsByOrganization({ organizationId });
  }

  /** Those of these projects with Dashboards on, each read once, in a stable order. */
  async #enabledIds(projectIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(projectIds)].toSorted((a, b) => a.localeCompare(b));
    const enabled = await Promise.all(
      unique.map(async (projectId) =>
        (await this.#access.isDashboardsEnabled({ projectId })) ? [projectId] : [],
      ),
    );
    return enabled.flat();
  }
}

/** In a readable project every board the member may see there; elsewhere Organization boards. */
function isListed({
  board,
  viewer,
  organizationId,
  isReadable,
}: {
  board: BoardRecord;
  viewer: DashboardViewer;
  organizationId: string;
  isReadable: boolean;
}): boolean {
  if (isReadable) {
    const place = { projectId: board.projectId, organizationId: void 0 };
    return dashboardStanding({ board, viewer, place }) === "home";
  }
  return board.scope === "ORGANIZATION" && board.organizationId === organizationId;
}

/**
 * Who a row names as its author. Only a readable project's author is named; an unreadable
 * project's goes unnamed by id too, unless it is the viewer.
 */
function authorOf({
  board,
  isReadable,
  viewer,
  ownerNames,
}: {
  board: BoardRecord;
  isReadable: boolean;
  viewer: DashboardViewer;
  ownerNames: ReadonlyMap<string, string>;
}): { createdById: string | null; ownerName: string | null } {
  if (isReadable) {
    return {
      createdById: board.createdById,
      ownerName: ownerNames.get(board.createdById ?? "") ?? null,
    };
  }
  const isViewers = board.createdById === viewer.userId;
  return { createdById: isViewers ? board.createdById : null, ownerName: null };
}

function libraryRow({
  board,
  project,
  openProject,
  ownerName,
}: {
  board: BoardRecord;
  project: DashboardProject | null;
  openProject: DashboardProject | null;
  ownerName: string | null;
}): OrganizationBoard {
  const { id, name, description, createdById, scope, homeProduct, updatedAt } = board;
  return {
    id,
    name,
    description,
    createdById,
    scope,
    homeProduct,
    myDashboardOfUserId: board.myDashboardOfUserId ?? null,
    updatedAt,
    project,
    openProject,
    ownerName,
  };
}
