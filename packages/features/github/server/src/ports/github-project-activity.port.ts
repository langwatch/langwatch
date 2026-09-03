/**
 * The project facts branch demand needs, and nothing else.
 *
 * Demand is the only side of pull-request linkage that knows a project: a
 * caller arrives with a tenant, the organization has to be resolved from it,
 * and a mapping that finds a pull request marks the project as having seen
 * coding-agent activity. Two operations — and to reach them the service used
 * to take the whole `ProjectService`, which is composed from a Prisma
 * repository, an authorization service, a topic clustering port, a credentials
 * adapter and both transports' collaborators. A worker that maps a branch
 * needs neither, and naming the pair here is what lets it compose demand from
 * its own database without also composing the App.
 *
 * `ProjectService` satisfies it: the published service carries both methods
 * with these signatures, which is what keeps `PostgresGithubAdapter` and the
 * App's own composition compiling.
 */
export abstract class GithubProjectActivityPort {
  /** The organization an active project belongs to; throws when there is none. */
  abstract getOrganizationId(projectId: string): Promise<string>;

  /** Stamps a project as having just had a coding-agent pull request mapped. */
  abstract touchCodingAgentPullRequestSeen(input: { projectId: string; at: Date }): Promise<void>;
}
