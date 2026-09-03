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

/** The two cuts a pull-request rollup is resolved over. */
export type CodingAgentScopePermission = "traces:view" | "cost:view";

/**
 * Who a cross-project cut is resolved for.
 *
 * A person reads with their own bindings. A CREDENTIAL reads with its own,
 * and that is not the same reach: a key can carry bindings NARROWER than its
 * holder's, which is the whole point of a restricted key, so a scope resolved
 * from the holder alone would let a deliberately narrowed key read with the
 * holder's full access. An organization SERVICE key owns no user at all - the
 * credential a continuous-integration job holds - and reads with its bindings
 * alone, which is what `userId: null` says.
 */
export type CodingAgentScopeCaller =
  | { readonly kind: "user"; readonly userId: string }
  | { readonly kind: "apiKey"; readonly apiKeyId: string; readonly userId: string | null };

/**
 * Which of a set of projects one caller holds each permission on, answered in
 * a fixed number of queries rather than one per project.
 *
 * A batch rather than a probe per project on purpose, and ONE batch for both
 * permissions rather than one each: the cuts run over every project in an
 * organization, and a fan-out of individual decisions is what starves the
 * connection pool on a large tenant. Two single-permission batches would
 * collect the same grant snapshot twice for the same answer.
 *
 * Absent answers deny. A project the batch did not answer for is refused
 * rather than assumed, so a short answer can only narrow the scope.
 */
export abstract class CodingAgentScopePermissionsPort {
  abstract projectCuts(input: {
    caller: CodingAgentScopeCaller;
    organizationId: string;
    projects: readonly CodingAgentScopeProject[];
    permissions: readonly CodingAgentScopePermission[];
  }): Promise<ReadonlyMap<CodingAgentScopePermission, ReadonlySet<string>>>;
}
