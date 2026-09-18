// Organization's projects split by caller's traces:view and cost:view
// permissions; projects enumerated from org, never from request; both cuts
// through batched probe to prevent REST/page drift.
import type {
  CodingAgentCallerScopeDirectory,
  CodingAgentScopeCaller,
  CodingAgentScopePermissions,
} from "../app/coding-agent.members.ts";

/** How one permitted project is named to a reader. */
export interface CallerProjectDisplay {
  /** The project's own name. */
  name: string;
  /** The project's slug, which addresses its pages. */
  slug: string;
  /** Whether the project is one person's workspace rather than a shared one. */
  isPersonal: boolean;
  /**
   * Who work in this project is attributed to: a personal workspace is named
   * by its one person; a shared project is named by itself, since the work
   * belongs to the project, not to anyone the platform can identify.
   */
  contributorLabel: string;
  /**
   * Whether `contributorLabel` names a project a reader can open, rather than
   * a person. Personal workspaces never link: the label is somebody's name,
   * and the workspace behind it is theirs alone.
   */
  isLinkable: boolean;
}

export interface CallerProjectScope {
  /** Projects the caller may read. Work outside it never appears. */
  permittedProjectIds: string[];
  /** The subset of those the caller may also price. */
  costProjectIds: string[];
  /** How each permitted project is named to a reader, keyed by project id. */
  projects: Record<string, CallerProjectDisplay>;
}

export interface CodingAgentCallerScopeDependencies {
  directory: CodingAgentCallerScopeDirectory;
  permissions: CodingAgentScopePermissions;
}

/** Resolves one caller's reach across an organization's projects. */
export class CodingAgentCallerScopeService {
  static create(dependencies: CodingAgentCallerScopeDependencies): CodingAgentCallerScopeService {
    return new CodingAgentCallerScopeService(dependencies);
  }

  private constructor(private readonly dependencies: CodingAgentCallerScopeDependencies) {}

  async resolve(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
  }): Promise<CallerProjectScope> {
    const { directory, permissions } = this.dependencies;
    const projects = await directory.listOrganizationProjects({
      organizationId: input.organizationId,
    });
    if (projects.length === 0) {
      return { permittedProjectIds: [], costProjectIds: [], projects: {} };
    }

    // ONE ask for both cuts over every project: the decision is made off a
    // single grant snapshot, so a large organization costs the same number of
    // queries as a small one.
    const cuts = await permissions.projectCuts({
      caller: input.caller,
      organizationId: input.organizationId,
      projects,
      permissions: ["traces:view", "cost:view"],
    });
    // A permission the batch did not answer for denies rather than passes:
    // a short answer may only narrow the scope.
    const viewable = cuts.get("traces:view") ?? new Set<string>();
    const priceable = cuts.get("cost:view") ?? new Set<string>();

    const permitted = projects.filter((project) => viewable.has(project.id));
    const permittedProjectIds = permitted.map((project) => project.id);
    const ownerNames = await directory.listPersonalTeamOwnerNames({
      teamIds: permitted.filter((project) => project.isPersonal).map((project) => project.teamId),
    });

    return {
      permittedProjectIds,
      costProjectIds: permittedProjectIds.filter((id) => priceable.has(id)),
      projects: Object.fromEntries(
        permitted.map((project) => [
          project.id,
          {
            name: project.name,
            slug: project.slug,
            isPersonal: project.isPersonal,
            contributorLabel: project.isPersonal
              ? (ownerNames.get(project.teamId) ?? project.name)
              : project.name,
            isLinkable: !project.isPersonal,
          } satisfies CallerProjectDisplay,
        ]),
      ),
    };
  }
}
