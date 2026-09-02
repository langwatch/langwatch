/**
 * What resolving one caller's project scope needs from the deployment.
 *
 * Two ports rather than one, because they answer two different questions and
 * a process satisfies them from two different services: which projects an
 * organization holds, and which of those this caller may read or price.
 */

/** One project of an organization, as the scope rule reads it. */
export type CodingAgentScopeProject = Readonly<{
  id: string;
  name: string;
  slug: string;
  teamId: string;
  /** Whether the project is one person's workspace rather than a shared one. */
  isPersonal: boolean;
}>;

/**
 * The organization's projects, and the person behind each personal workspace.
 *
 * The project list is enumerated from the ORGANIZATION and never taken from a
 * request: a caller that could name the projects to count could count one it
 * may not read.
 */
export abstract class CodingAgentCallerScopeDirectoryPort {
  /** Every live project of one organization. */
  abstract listOrganizationProjects(input: {
    organizationId: string;
  }): Promise<readonly CodingAgentScopeProject[]>;

  /**
   * Who each personal workspace belongs to, keyed by team id.
   *
   * Asked only for personal teams, and never for a shared one: a shared team's
   * members are not an answer to "who worked here", so reading them would cost
   * a query nothing displays.
   */
  abstract listPersonalTeamOwnerNames(input: {
    teamIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;
}

/**
 * Which of a set of projects one caller holds a permission on, answered in a
 * fixed number of queries rather than one per project.
 *
 * A batch rather than a probe per project on purpose: the two cuts below run
 * over every project in an organization, and a fan-out of individual decisions
 * is what starves the connection pool on a large tenant.
 */
export abstract class CodingAgentScopePermissionsPort {
  abstract permittedProjectIds(input: {
    userId: string;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permission: "traces:view" | "cost:view";
  }): Promise<ReadonlySet<string>>;
}
