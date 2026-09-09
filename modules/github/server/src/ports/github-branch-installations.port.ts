/**
 * The installation reads pull-request linkage performs, and nothing else.
 *
 * Branch mapping used to reach these two through `GithubInstallationsService`,
 * which also answers organization membership and records an installation — so
 * every graph that wanted the branch sweep had to compose an
 * `OrganizationService` the sweep never calls. This port is the pair the
 * mapping actually reads: one to attribute a verified webhook, one to find the
 * installation that covers a repository.
 *
 * `GithubInstallationAccessService` satisfies it; so does anything else that
 * can answer both without a database.
 */
export abstract class GithubBranchInstallationsPort {
  /**
   * The organization a webhook's installation belongs to.
   *
   * Attribution of a verified delivery, so it stays valid with no App
   * credentials configured at all.
   */
  abstract tryGetByInstallationId(
    installationId: string,
  ): Promise<{ organizationId: string } | null>;

  /** The installation and repository id that can be asked about a branch. */
  abstract tryResolveInstallationForRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<{ installationId: string; repositoryId: string } | null>;
}
