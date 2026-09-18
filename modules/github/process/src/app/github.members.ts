import type { GithubInstallStatePayload, GithubPullRequestEvent } from "@langwatch/github-contract";
import type { Instant } from "@langwatch/time";
/**
 * Two methods consumers need to avoid the full GithubService composition:
 * checking hosts and mapping branches.
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
 * Two methods the maintenance worker needs. Naming them lets the worker
 * compose without the full App.
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
  consumeNonce(nonce: string): Promise<boolean | null>;
  sign(payload: GithubInstallStatePayload): string;
  verify(token: string | null | undefined): GithubInstallStatePayload | null;
}

export interface GithubProjectActivity {
  /** The organization an active project belongs to; throws when there is none. */
  getOrganizationId(projectId: string): Promise<string>;

  /** Stamps a project as having just had a coding-agent pull request mapped. */
  touchCodingAgentPullRequestSeen(input: { projectId: string; at: Instant }): Promise<void>;
}

export interface GithubPullRequestEventParser {
  parse(payload: unknown): GithubPullRequestEvent | null;
}
