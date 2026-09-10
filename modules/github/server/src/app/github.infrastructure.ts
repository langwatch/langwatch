import type { GithubInstallStatePayload, GithubPullRequestEvent } from "@langwatch/github-contract";
export interface GithubInfrastructure {  githubBranchDemand: GithubBranchDemand;
  githubBranchMaintenance: GithubBranchMaintenance;
  githubHost: GithubHost;
  githubInstallResponse: GithubInstallResponse;
  githubInstallState: GithubInstallState;
  githubProjectActivity: GithubProjectActivity;
  githubPullRequestEvent: GithubPullRequestEventParser;
}

/**
 * The demand half of pull-request linkage, as its cross-feature consumers use
 * it.
 *
 * A folded coding-agent session asks two questions and no more: whether a
 * repository host is one this instance's GitHub App can answer for, and — for
 * a branch somebody is looking at right now — which pull requests have hosted
 * it. The published `GithubService` carries thirty methods composed from an
 * organization service, a project service and both transports' collaborators,
 * so taking it whole is what kept those two unreachable outside the App.
 *
 * `GithubService` satisfies it, and so does the composition
 * `composeGithubBranchDemand` builds: both carry these two methods
 * with these signatures.
 */
export interface GithubBranchDemand {
  /** Whether this instance's GitHub App can answer for that repository host. */
  canMapRepositoryHost(repositoryHost: string): boolean;

  /** Asks the organization's connection which pull requests host this branch. */
  requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void>;
}

/**
 * The fleet-wide sweep, as the maintenance pipeline consumes it.
 *
 * The pipeline used to take the whole `GithubService` facade — 30 methods,
 * every one of them composed from an organization service, a project service
 * and the transports' collaborators — to call these two. A worker that mounts
 * the sweep needs neither, and naming the pair here is what lets it compose
 * the sweep from its own database without also composing the App.
 *
 * `GithubBranchMaintenanceService` satisfies it, and so does the published
 * `GithubService`: both carry these two methods with these signatures, which
 * is what keeps the frozen registration in `platform/app` compiling.
 */
export interface GithubBranchMaintenance {
  /** Re-asks GitHub about branches whose mapping is due; answers how many. */
  recheckDueBranches(): Promise<number>;

  /** Drops branch bookkeeping past the activity horizon. */
  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
}


export interface GithubHost {
  getHost(): string;
  getApiBase(): string;
  getWebBase(): string;
  getAppInstallUrl(appSlug: string): string;
  isMappable(repositoryHost: string): boolean;
  normalize(repositoryHost: string): string;
}


export interface GithubInstallResponse {
  successHtml(login: string): string;
  errorHtml(message: string): string;
}


export interface GithubInstallState {
  getTtlMs(): number;
  registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean>;
  tryConsumeNonce(nonce: string): Promise<boolean | null>;
  sign(payload: GithubInstallStatePayload): string;
  tryVerify(token: string | null | undefined): GithubInstallStatePayload | null;
}


export interface GithubProjectActivity {
  /** The organization an active project belongs to; throws when there is none. */
  getOrganizationId(projectId: string): Promise<string>;

  /** Stamps a project as having just had a coding-agent pull request mapped. */
  touchCodingAgentPullRequestSeen(input: {
    projectId: string;
    at: Instant;
  }): Promise<void>;
}


export interface GithubPullRequestEventParser {
  tryParse(payload: unknown): GithubPullRequestEvent | null;
}
