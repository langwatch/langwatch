import { GithubService as GithubServiceContract } from "@langwatch/github-contract";
import type {
  GithubInstallation,
  GithubRepository,
  GithubPullRequestLiveStatus,
  GithubPullRequestRef,
  GithubTurnToken,
  GithubPullRequest,
  GithubPullRequestEvent,
  GithubInstallStatePayload,
  GithubAppConfig,
} from "@langwatch/github-contract";
import {
  consumeGithubInstallNonce,
  registerGithubInstallNonce,
  type GithubNonceRedis,
} from "../adapters/github.github-install-nonce.adapter";
import {
  signGithubInstallState,
  verifyGithubInstallState,
  STATE_TTL_MS,
} from "../adapters/github.github-install-state.adapter";
import {
  popupErrorHtml,
  popupResponseHtml,
} from "../adapters/github.github-install-popup-html.adapter";
import {
  parseGithubPullRequestEvent,
} from "../adapters/github.github-pull-request-event.adapter";
import {
  getGithubAppInstallUrl,
  getGithubWebBase,
  type GithubHostConfig,
} from "../adapters/github.github-host.adapter";
import type { RedisLike } from "../adapters/github.github-app-token.adapter";

import { GithubInstallationsService } from "./github-installations.service";
import {
  type BranchMappingRequest,
  GithubPullRequestMappingService,
} from "./github-pull-request-mapping.service";
import { GithubPullRequestStatusService } from "./github-pull-request-status.service";

type GithubServiceDependencies = {
  installations: GithubInstallationsService;
  mapping: GithubPullRequestMappingService;
  status: GithubPullRequestStatusService;
  protocol: {
    appSlug: string;
    webhookSecret: string;
    signingKey: string;
    hostConfig: GithubHostConfig;
    redis: (RedisLike & GithubNonceRedis) | null;
  };
};

/**
 * The single process-facing GitHub capability. The focused collaborators are
 * implementation details of this service; Coding Agent, Langy and transports
 * depend on this facade rather than constructing repositories or sub-services.
 */
export class GithubFeatureService extends GithubServiceContract {
  static create(dependencies: GithubServiceDependencies): GithubFeatureService {
    return new GithubFeatureService(
      dependencies.installations,
      dependencies.mapping,
      dependencies.status,
      dependencies.protocol,
    );
  }

  private constructor(
    private readonly installations: GithubInstallationsService,
    private readonly mapping: GithubPullRequestMappingService,
    private readonly status: GithubPullRequestStatusService,
    private readonly protocol: GithubServiceDependencies["protocol"],
  ) {
    super();
  }

  getAllForOrganization(
    organizationId: string,
  ): Promise<readonly GithubInstallation[]> {
    return this.installations.getAllForOrganization(organizationId);
  }

  get configured(): boolean {
    return this.getAppConfig().configured;
  }

  tryGetByInstallationId(
    installationId: string,
  ): Promise<GithubInstallation | null> {
    return this.installations.tryGetByInstallationId(installationId);
  }

  isOrganizationMember(input: {
    userId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.installations.isOrganizationMember(input);
  }

  recordInstallation(input: {
    installationId: string;
    organizationId: string;
  }): Promise<{ accountLogin: string }> {
    return this.installations.recordInstallation(input);
  }

  handleWebhookEvent(input: {
    action: "created" | "deleted" | "suspend" | "unsuspend" | "added" | "removed";
    installationId: string;
    repositorySelection?: string;
    repositories?: GithubRepository[] | null;
  }): Promise<void> {
    return this.installations.handleWebhookEvent(input);
  }

  listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<readonly GithubRepository[]> {
    return this.installations.listRepositoriesForOrganization(organizationId);
  }

  tryMintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    return this.installations.tryMintTurnToken(input);
  }

  coversRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean> {
    return this.installations.tryResolveInstallationForRepository(input).then(
      (installation) => installation !== null,
    );
  }

  getAppConfig(): GithubAppConfig {
    return {
      appSlug: this.protocol.appSlug,
      webhookSecret: this.protocol.webhookSecret,
      configured: Boolean(
        this.installations.configured && this.protocol.appSlug,
      ),
    };
  }

  getWebBase(): string {
    return getGithubWebBase(this.protocol.hostConfig);
  }

  getAppInstallUrl(): string {
    return getGithubAppInstallUrl(
      this.protocol.appSlug,
      this.protocol.hostConfig,
    );
  }

  getInstallStateTtlMs(): number {
    return STATE_TTL_MS;
  }

  registerInstallNonce(input: {
    nonce: string;
    ttlSec: number;
  }): Promise<boolean> {
    return registerGithubInstallNonce(
      this.protocol.redis,
      input.nonce,
      input.ttlSec,
    );
  }

  tryConsumeInstallNonce(nonce: string): Promise<boolean | null> {
    return consumeGithubInstallNonce(this.protocol.redis, nonce);
  }

  signInstallState(payload: GithubInstallStatePayload): string {
    return signGithubInstallState(payload, this.protocol.signingKey);
  }

  tryVerifyInstallState(
    token: string | null | undefined,
  ): GithubInstallStatePayload | null {
    return verifyGithubInstallState(token, this.protocol.signingKey);
  }

  popupResponseHtml(login: string): string {
    return popupResponseHtml(login);
  }

  popupErrorHtml(message: string): string {
    return popupErrorHtml(message);
  }

  tryParsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null {
    return parseGithubPullRequestEvent(payload);
  }

  requestBranchMapping(input: BranchMappingRequest): Promise<void> {
    return this.mapping.requestBranchMapping(input);
  }

  getLivePullRequestStatuses(input: {
    organizationId: string;
    refs: readonly GithubPullRequestRef[];
  }): Promise<readonly GithubPullRequestLiveStatus[]> {
    return this.status.getLiveStatuses(input);
  }

  applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean> {
    return this.mapping.applyPullRequestEvent(event);
  }

  findForBranches(input: {
    organizationId: string;
    keys: ReadonlyArray<{
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }>;
  }): Promise<readonly GithubPullRequest[]> {
    return this.mapping.findForBranches(input);
  }

  findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]> {
    return this.mapping.findAllByBranches(input);
  }

  tryFindByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null> {
    return this.mapping.tryFindByNumber(input);
  }

  recheckDueBranches(): Promise<number> {
    return this.mapping.recheckDueBranches();
  }

  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return this.mapping.pruneStaleBranchLinkage();
  }
}
