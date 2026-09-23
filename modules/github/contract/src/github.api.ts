import { moduleApi } from "@langwatch/kernel/module-api";

import type { GithubConnectionStatus, GithubDisconnectResult } from "./github.connection.ts";
import type {
  GithubAppConfig,
  GithubInstallation,
  GithubInstallStatePayload,
  GithubPullRequest,
  GithubPullRequestEvent,
  GithubPullRequestLiveStatus,
  GithubPullRequestRef,
  GithubRepositoryRef,
  GithubTurnToken,
  GithubWebhookEnvelope,
} from "./github.ts";

/**
 * What the install-wide usage report counts here (ADR-156, section 10): how
 * many pull requests were opened, since `since` where one is given (epoch
 * milliseconds, on the day GitHub opened them, not the day we noticed).
 */
export interface GithubUsageCount {
  readonly pullRequests: number;
}

/** Callable GitHub installation, webhook and pull-request capabilities. */
export interface GithubApi {
  getAppConfig(): GithubAppConfig;
  getWebBase(): string;
  normalizeRepositoryHost(repositoryHost: string): string;
  canMapRepositoryHost(repositoryHost: string): boolean;
  getAppInstallUrl(): string;
  getInstallStateTtlMs(): number;
  registerInstallNonce(input: { nonce: string; ttlSec: number }): Promise<boolean>;
  consumeInstallNonce(nonce: string): Promise<boolean | null>;
  signInstallState(payload: GithubInstallStatePayload): string;
  verifyInstallState(token: string | null | undefined): GithubInstallStatePayload | null;
  popupResponseHtml(login: string): string;
  popupErrorHtml(message: string): string;
  parsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null;
  applyWebhookPayload(input: {
    payload: GithubWebhookEnvelope;
    eventType: string | undefined;
    deliveryId: string | undefined;
  }): Promise<void>;
  getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]>;
  findByInstallationId(installationId: string): Promise<GithubInstallation | null>;
  isOrganizationMember(input: { userId: string; organizationId: string }): Promise<boolean>;
  getConnectionStatus(input: { organizationId: string }): Promise<GithubConnectionStatus>;
  disconnect(input: {
    organizationId: string;
    installationId: string;
  }): Promise<GithubDisconnectResult>;
  recordInstallation(input: {
    installationId: string;
    organizationId: string;
    flowStartedAt: number;
    expectedAccountLogin?: string | undefined;
    expectedInstallationId?: string | undefined;
  }): Promise<{ accountLogin: string }>;
  handleWebhookEvent(input: {
    action: "created" | "deleted" | "suspend" | "unsuspend" | "added" | "removed";
    installationId: string;
    repositorySelection?: string;
    repositories?: GithubRepositoryRef[] | null;
  }): Promise<void>;
  listRepositoriesForOrganization(organizationId: string): Promise<readonly GithubRepositoryRef[]>;
  mintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null>;
  coversRepository(input: { organizationId: string; repositoryFullName: string }): Promise<boolean>;
  requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void>;
  getLivePullRequestStatuses(input: {
    organizationId: string;
    refs: readonly GithubPullRequestRef[];
  }): Promise<readonly GithubPullRequestLiveStatus[]>;
  applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean>;
  findForBranches(input: {
    organizationId: string;
    keys: readonly { repositoryHost: string; repositoryFullName: string; headBranch: string }[];
  }): Promise<readonly GithubPullRequest[]>;
  findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]>;
  findByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null>;
  recheckDueBranches(): Promise<number>;
  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }>;
  /** The usage report's figures (ADR-156, section 10). */
  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<GithubUsageCount>;
}

export const GithubApi = moduleApi<GithubApi>()("github");
