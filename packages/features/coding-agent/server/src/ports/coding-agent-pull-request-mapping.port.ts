/**
 * The GitHub demand path, as the session fold's mapping subscriber uses it.
 *
 * The subscriber asks two questions and no more: whether a repository host is
 * one this instance's GitHub App can answer for, and — for a branch somebody
 * is looking at right now — which pull requests have hosted it. The published
 * `GithubService` carries thirty methods composed from an organization
 * service, a project service and both transports' collaborators, so taking it
 * whole is what kept this subscriber unmountable outside the App.
 *
 * `GithubService` satisfies it, and so does the branch-demand composition a
 * worker builds from its own database: both carry these two methods with these
 * signatures, which is what keeps the frozen registration in `platform/app`
 * compiling.
 */
export abstract class CodingAgentPullRequestMappingPort {
  /** Whether this instance's GitHub App can answer for that repository host. */
  abstract canMapRepositoryHost(repositoryHost: string): boolean;

  /** Asks the organization's connection which pull requests host this branch. */
  abstract requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void>;
}
