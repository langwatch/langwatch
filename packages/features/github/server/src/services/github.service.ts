import { GithubService as GithubServiceContract } from "@langwatch/github-contract";
import type {
  GithubInstallation,
  GithubRepositoryRef,
  GithubPullRequestLiveStatus,
  GithubPullRequestRef,
  GithubTurnToken,
  GithubPullRequest,
  GithubPullRequestEvent,
  GithubInstallStatePayload,
  GithubAppConfig,
} from "@langwatch/github-contract";
import type { GithubHostPort } from "../ports/github-host.port";
import type { GithubInstallResponsePort } from "../ports/github-install-response.port";
import type { GithubInstallStatePort } from "../ports/github-install-state.port";
import type { GithubPullRequestEventPort } from "../ports/github-pull-request-event.port";

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
  config: {
    appSlug: string;
    webhookSecret: string;
  };
  host: GithubHostPort;
  installState: GithubInstallStatePort;
  installResponse: GithubInstallResponsePort;
  pullRequestEvents: GithubPullRequestEventPort;
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
      dependencies.config,
      dependencies.host,
      dependencies.installState,
      dependencies.installResponse,
      dependencies.pullRequestEvents,
    );
  }

  private constructor(
    private readonly installations: GithubInstallationsService,
    private readonly mapping: GithubPullRequestMappingService,
    private readonly status: GithubPullRequestStatusService,
    private readonly config: GithubServiceDependencies["config"],
    private readonly host: GithubHostPort,
    private readonly installState: GithubInstallStatePort,
    private readonly installResponse: GithubInstallResponsePort,
    private readonly pullRequestEvents: GithubPullRequestEventPort,
  ) {
    super();
  }

  getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]> {
    return this.installations.getAllForOrganization(organizationId);
  }

  get configured(): boolean {
    return this.getAppConfig().configured;
  }

  tryGetByInstallationId(installationId: string): Promise<GithubInstallation | null> {
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
    repositories?: GithubRepositoryRef[] | null;
  }): Promise<void> {
    return this.installations.handleWebhookEvent(input);
  }

  listRepositoriesForOrganization(
    organizationId: string,
  ): Promise<readonly GithubRepositoryRef[]> {
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
    return this.installations.coversRepository(input);
  }

  getAppConfig(): GithubAppConfig {
    return {
      appSlug: this.config.appSlug,
      webhookSecret: this.config.webhookSecret,
      configured: Boolean(this.installations.configured && this.config.appSlug),
    };
  }

  getWebBase(): string {
    return this.host.getWebBase();
  }

  normalizeRepositoryHost(repositoryHost: string): string {
    return this.host.normalize(repositoryHost);
  }

  canMapRepositoryHost(repositoryHost: string): boolean {
    return this.host.isMappable(repositoryHost);
  }

  getAppInstallUrl(): string {
    return this.host.getAppInstallUrl(this.config.appSlug);
  }

  getInstallStateTtlMs(): number {
    return this.installState.getTtlMs();
  }

  registerInstallNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    return this.installState.registerNonce(input);
  }

  tryConsumeInstallNonce(nonce: string): Promise<boolean | null> {
    return this.installState.tryConsumeNonce(nonce);
  }

  signInstallState(payload: GithubInstallStatePayload): string {
    return this.installState.sign(payload);
  }

  tryVerifyInstallState(
    token: string | null | undefined,
  ): GithubInstallStatePayload | null {
    return this.installState.tryVerify(token);
  }

  popupResponseHtml(login: string): string {
    return this.installResponse.successHtml(login);
  }

  popupErrorHtml(message: string): string {
    return this.installResponse.errorHtml(message);
  }

  tryParsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null {
    return this.pullRequestEvents.tryParse(payload);
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
