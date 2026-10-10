import type { AuthzApi } from "@langwatch/authz-contract";
import {
  dashboardScopeSchema,
  DashboardNotFoundError,
  DashboardScopeAuthorOnlyError,
  isDashboardAuthor,
  type Dashboard,
  type DashboardProject,
  type DashboardScope,
  type DashboardScopeImpact,
  type DashboardScopeProjects,
  type DashboardViewer,
} from "@langwatch/dashboard-contract";
import type { ProjectApi } from "@langwatch/project-contract";

import type { DashboardRepository } from "../repositories/dashboard.repository.ts";
import type { DashboardAccessService } from "./dashboard-access.service.ts";

/** A board named by a member, from the project they are in. */
type BoardAsk = Readonly<{ projectId: string; dashboardId: string; viewer: DashboardViewer }>;

/** The most projects one Project chip lists; an organization with more shows its first by name. */
const MAX_SCOPE_PROJECTS = 500;

/**
 * Changing who sees a board. Only its author does, in the project that owns it; a project
 * administrator is refused like any other member. Spec: dashboards-v2.feature AC174 to AC182.
 */
export class DashboardScopeService {
  #repository: DashboardRepository;
  #access: DashboardAccessService;
  #projects: ProjectApi;
  #authz: AuthzApi;

  private constructor(options: {
    repository: DashboardRepository;
    access: DashboardAccessService;
    projects: ProjectApi;
    authz: AuthzApi;
  }) {
    this.#repository = options.repository;
    this.#access = options.access;
    this.#projects = options.projects;
    this.#authz = options.authz;
  }

  static create(options: {
    repository: DashboardRepository;
    access: DashboardAccessService;
    projects: ProjectApi;
    authz: AuthzApi;
  }): DashboardScopeService {
    return new DashboardScopeService(options);
  }

  async setScope(input: BoardAsk & { scope: DashboardScope }): Promise<Dashboard> {
    const scope = dashboardScopeSchema.parse(input.scope);
    const board = await this.#authored(input);
    if (board.scope === scope) return board;

    // Stamped once and kept: it is what lists the board in the organization's other projects.
    const organizationId =
      scope === "ORGANIZATION" ? await this.#projects.getOrganizationId(board.projectId) : void 0;

    return this.#repository.updateDashboard({
      projectId: board.projectId,
      dashboardId: board.id,
      data: { scope, ...(organizationId === void 0 ? {} : { organizationId }) },
    });
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

  /**
   * The projects an Organization board opens under for this member: those of its organization
   * where they hold `analytics:view`, by name, with the project that owns it named either way.
   */
  async listProjects(input: BoardAsk): Promise<DashboardScopeProjects> {
    const found = await this.#access.findReadable(input);
    const organizationId = found?.board.organizationId ?? null;
    if (!found || found.board.scope !== "ORGANIZATION" || organizationId === null) {
      throw new DashboardNotFoundError(input.projectId);
    }

    const projectIds = await this.#projects.findLiveNonGovernanceIdsByOrganization({
      organizationId,
    });
    const candidates = await this.#projects.listNamesByIds({
      projectIds: [...new Set([found.board.projectId, ...projectIds.slice(0, MAX_SCOPE_PROJECTS)])],
    });
    const decision = await this.#authz.canBatchByIds({
      principal: { type: "user", id: input.viewer.userId },
      permission: "analytics:view",
      organizationId,
      teams: [],
      projects: candidates.map(({ id, teamId }) => ({ projectId: id, teamId })),
    });

    const owner = candidates.find(({ id }) => id === found.board.projectId);
    if (!owner) throw new DashboardNotFoundError(input.projectId);
    return {
      ownerProject: projectOf(owner),
      projects: candidates
        .filter(({ id }) => decision.projects.get(id) === true)
        .map(projectOf)
        .toSorted((left, right) => left.name.localeCompare(right.name)),
    };
  }

  /** The member's own board, in the project that owns it; anyone else is refused by name. */
  async #authored(input: BoardAsk): Promise<Dashboard> {
    const board = await this.#access.getWritable(input);
    if (!isDashboardAuthor({ board, viewer: input.viewer })) {
      throw new DashboardScopeAuthorOnlyError();
    }
    return board;
  }
}

const projectOf = ({ id, name, slug }: DashboardProject): DashboardProject => ({ id, name, slug });
