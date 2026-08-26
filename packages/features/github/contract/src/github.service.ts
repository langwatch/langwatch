import type {
  GithubInstallation,
  GithubRepositoryRef,
  GithubPullRequestLiveStatus,
  GithubPullRequest,
  GithubPullRequestEvent,
  GithubInstallStatePayload,
  GithubAppConfig,
  GithubPullRequestRef,
  GithubTurnToken,
} from "./github";

/** The cross-feature GitHub capabilities used by Coding Agent and Langy. */
export abstract class GithubService {
  abstract readonly configured: boolean;
  abstract getAppConfig(): GithubAppConfig;
  abstract getWebBase(): string;
  abstract normalizeRepositoryHost(repositoryHost: string): string;
  abstract canMapRepositoryHost(repositoryHost: string): boolean;
  abstract getAppInstallUrl(): string;
  abstract getInstallStateTtlMs(): number;
  abstract registerInstallNonce(input: {
    nonce: string;
    ttlSec: number;
  }): Promise<boolean>;
  abstract tryConsumeInstallNonce(nonce: string): Promise<boolean | null>;
  abstract signInstallState(payload: GithubInstallStatePayload): string;
  abstract tryVerifyInstallState(
    token: string | null | undefined,
  ): GithubInstallStatePayload | null;
  abstract popupResponseHtml(login: string): string;
  abstract popupErrorHtml(message: string): string;
  abstract tryParsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null;
  abstract getAllForOrganization(
    organizationId: string,
  ): Promise<readonly GithubInstallation[]>;
  abstract tryGetByInstallationId(
    installationId: string,
  ): Promise<GithubInstallation | null>;
  abstract isOrganizationMember(input: {
    userId: string;
    organizationId: string;
  }): Promise<boolean>;
  abstract recordInstallation(input: {
    installationId: string;
    organizationId: string;
  }): Promise<{ accountLogin: string }>;
  abstract handleWebhookEvent(input: {
    action: "created" | "deleted" | "suspend" | "unsuspend" | "added" | "removed";
    installationId: string;
    repositorySelection?: string;
    repositories?: GithubRepositoryRef[] | null;
  }): Promise<void>;
  abstract listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<readonly GithubRepositoryRef[]>;
  abstract tryMintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null>;
  abstract coversRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean>;
  abstract requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void>;
  abstract getLivePullRequestStatuses(input: {
    organizationId: string;
    refs: readonly GithubPullRequestRef[];
  }): Promise<readonly GithubPullRequestLiveStatus[]>;
  abstract applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean>;
  abstract findForBranches(input: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<readonly GithubPullRequest[]>;
  abstract findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]>;
  abstract tryFindByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null>;
  abstract recheckDueBranches(): Promise<number>;
  abstract pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
}
