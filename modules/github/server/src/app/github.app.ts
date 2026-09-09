import {
  GithubApi,
  type GithubApi as GithubApiContract,
  type GithubAppConfig,
  type GithubConnectionStatus,
  type GithubDisconnectResult,
  type GithubInstallation,
  type GithubInstallStatePayload,
  type GithubPullRequest,
  type GithubPullRequestEvent,
  type GithubPullRequestLiveStatus,
  type GithubPullRequestRef,
  type GithubRepositoryRef,
  type GithubTurnToken,
  type GithubServerConfig,
  githubServerConfigSchema,
} from "@langwatch/github-contract";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { GithubRepositories } from "../repositories/github.repositories.ts";
import type { GithubProjectActivityPort } from "../ports/github-project-activity.port.ts";
import { GithubAppTokenAdapter } from "../adapters/github-app-token.adapter.ts";
import { GithubHostAdapter } from "../adapters/github-host.adapter.ts";
import { GithubInstallResponseAdapter } from "../adapters/github-install-response.adapter.ts";
import { GithubInstallStateAdapter } from "../adapters/github-install-state.adapter.ts";
import { GithubPullRequestEventAdapter } from "../adapters/github-pull-request-event.adapter.ts";
import {
  RedisGithubAdapter,
  type GithubRedisConnection,
} from "../adapters/redis.github.adapter.ts";
import { GithubBranchDemandService } from "../services/github-branch-demand.service.ts";
import { GithubBranchMaintenanceService } from "../services/github-branch-maintenance.service.ts";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service.ts";
import { GithubInstallationAccessService } from "../services/github-installation-access.service.ts";
import { GithubInstallationsService } from "../services/github-installations.service.ts";
import { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service.ts";
import { GithubPullRequestStatusCacheService } from "../services/github-pull-request-status-cache.service.ts";
import { GithubPullRequestStatusService } from "../services/github-pull-request-status.service.ts";
import { GithubFeatureService } from "../services/github.service.ts";

export type GithubInfrastructure = Readonly<{
  redis: GithubRedisConnection | null;
  signingKey: string;
}>;

type GithubSetup = FeatureSetup<
  typeof GithubApp.dependencies,
  GithubInfrastructure,
  GithubServerConfig,
  GithubRepositories
>;

/** What a graph needs beside its rows to answer for a GitHub App. */
export type GithubComposition = Readonly<{
  repositories: GithubRepositories;
  redis: GithubRedisConnection | null;
  organization: OrganizationApiContract;
  project: GithubProjectActivityPort;
  config: {
    appId: string;
    privateKey: string;
    appSlug: string;
    webhookSecret: string;
    signingKey: string;
  };
  hostConfig?: { host?: string };
}>;

/**
 * The whole GitHub capability over one set of rows: the installation reads and
 * writes, the branch mapping behind pull-request linkage, the live status read
 * and the installation flow's own signing and rendering.
 */
export function composeGithubApi(parts: GithubComposition): GithubFeatureService {
  const host = GithubHostAdapter.create(parts.hostConfig);
  const redis = parts.redis ? RedisGithubAdapter.create(parts.redis) : null;
  const appTokens = GithubAppTokenAdapter.create(
    parts.config.appId,
    parts.config.privateKey,
    redis,
    host,
  );
  const { installations: installationsRepository, pullRequests: pullRequestsRepository } =
    parts.repositories;
  const installationAccess = GithubInstallationAccessService.create(
    installationsRepository,
    appTokens,
  );
  const installations = GithubInstallationsService.create(
    installationsRepository,
    appTokens,
    parts.organization,
    installationAccess,
  );
  const branchMapping = GithubBranchMappingService.create({
    repository: pullRequestsRepository,
    installations: installationAccess,
    appTokens,
    host,
  });
  const branchDemand = GithubBranchDemandService.create({
    mapping: branchMapping,
    project: parts.project,
    host,
  });
  const branchMaintenance = GithubBranchMaintenanceService.create({
    repository: pullRequestsRepository,
    mapping: branchMapping,
  });
  const mapping = GithubPullRequestMappingService.create({
    repository: pullRequestsRepository,
    branches: branchMapping,
    demand: branchDemand,
    maintenance: branchMaintenance,
  });
  const status = GithubPullRequestStatusService.create({
    repository: pullRequestsRepository,
    installations,
    appTokens,
    cache: GithubPullRequestStatusCacheService.create(redis),
  });

  return GithubFeatureService.create({
    installations,
    mapping,
    status,
    config: {
      appSlug: parts.config.appSlug,
      webhookSecret: parts.config.webhookSecret,
    },
    host,
    installState: GithubInstallStateAdapter.create({
      signingKey: parts.config.signingKey,
      redis,
    }),
    installResponse: GithubInstallResponseAdapter.create(),
    pullRequestEvents: GithubPullRequestEventAdapter.create(),
  });
}

/** The process-owned GitHub capability; provider and persistence stay private. */
export class GithubApp implements GithubApiContract {
  static readonly contract = GithubApi;
  static readonly dependencies = { organizations: OrganizationApi, projects: ProjectApi };
  static readonly configSchema = githubServerConfigSchema;

  readonly #service: GithubApiContract;

  private constructor(service: GithubApiContract) {
    this.#service = service;
  }

  static create({ repositories, infrastructure, config, dependencies }: GithubSetup): GithubApp {
    return new GithubApp(
      composeGithubApi({
        repositories,
        redis: infrastructure.redis,
        organization: dependencies.organizations,
        project: dependencies.projects,
        config: {
          appId: config.appId ?? "",
          privateKey: config.privateKey ?? "",
          appSlug: config.appSlug ?? "",
          webhookSecret: config.webhookSecret ?? "",
          signingKey: infrastructure.signingKey,
        },
        ...(config.host === undefined ? {} : { hostConfig: { host: config.host } }),
      }),
    );
  }

  getAppConfig(): GithubAppConfig {
    return this.#service.getAppConfig();
  }
  getWebBase(): string {
    return this.#service.getWebBase();
  }
  normalizeRepositoryHost(repositoryHost: string): string {
    return this.#service.normalizeRepositoryHost(repositoryHost);
  }
  canMapRepositoryHost(repositoryHost: string): boolean {
    return this.#service.canMapRepositoryHost(repositoryHost);
  }
  getAppInstallUrl(): string {
    return this.#service.getAppInstallUrl();
  }
  getInstallStateTtlMs(): number {
    return this.#service.getInstallStateTtlMs();
  }
  registerInstallNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    return this.#service.registerInstallNonce(input);
  }
  tryConsumeInstallNonce(nonce: string): Promise<boolean | null> {
    return this.#service.tryConsumeInstallNonce(nonce);
  }
  signInstallState(payload: GithubInstallStatePayload): string {
    return this.#service.signInstallState(payload);
  }
  tryVerifyInstallState(token: string | null | undefined): GithubInstallStatePayload | null {
    return this.#service.tryVerifyInstallState(token);
  }
  popupResponseHtml(login: string): string {
    return this.#service.popupResponseHtml(login);
  }
  popupErrorHtml(message: string): string {
    return this.#service.popupErrorHtml(message);
  }
  tryParsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null {
    return this.#service.tryParsePullRequestEvent(payload);
  }
  getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]> {
    return this.#service.getAllForOrganization(organizationId);
  }
  tryGetByInstallationId(installationId: string): Promise<GithubInstallation | null> {
    return this.#service.tryGetByInstallationId(installationId);
  }
  isOrganizationMember(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.#service.isOrganizationMember(input);
  }
  getConnectionStatus(input: { organizationId: string }): Promise<GithubConnectionStatus> {
    return this.#service.getConnectionStatus(input);
  }
  disconnect(input: {
    organizationId: string;
    installationId: string;
  }): Promise<GithubDisconnectResult> {
    return this.#service.disconnect(input);
  }
  recordInstallation(input: {
    installationId: string;
    organizationId: string;
    flowStartedAt: number;
    expectedAccountLogin?: string;
    expectedInstallationId?: string;
  }): Promise<{ accountLogin: string }> {
    return this.#service.recordInstallation(input);
  }
  handleWebhookEvent(input: {
    action: "created" | "deleted" | "suspend" | "unsuspend" | "added" | "removed";
    installationId: string;
    repositorySelection?: string;
    repositories?: GithubRepositoryRef[] | null;
  }): Promise<void> {
    return this.#service.handleWebhookEvent(input);
  }
  listRepositoriesForOrganization(organizationId: string): Promise<readonly GithubRepositoryRef[]> {
    return this.#service.listRepositoriesForOrganization(organizationId);
  }
  tryMintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    return this.#service.tryMintTurnToken(input);
  }
  coversRepository(input: {
    organizationId: string;
    repositoryFullName: string;
  }): Promise<boolean> {
    return this.#service.coversRepository(input);
  }
  requestBranchMapping(input: {
    tenantId: string;
    repositoryHost: string;
    repositoryOwner: string;
    repositoryName: string;
    headBranch: string;
  }): Promise<void> {
    return this.#service.requestBranchMapping(input);
  }
  getLivePullRequestStatuses(input: {
    organizationId: string;
    refs: readonly GithubPullRequestRef[];
  }): Promise<readonly GithubPullRequestLiveStatus[]> {
    return this.#service.getLivePullRequestStatuses(input);
  }
  applyPullRequestEvent(event: GithubPullRequestEvent): Promise<boolean> {
    return this.#service.applyPullRequestEvent(event);
  }
  findForBranches(input: {
    organizationId: string;
    keys: ReadonlyArray<{ repositoryHost: string; repositoryFullName: string; headBranch: string }>;
  }): Promise<readonly GithubPullRequest[]> {
    return this.#service.findForBranches(input);
  }
  findAllByBranches(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    headBranches: readonly string[];
  }): Promise<readonly GithubPullRequest[]> {
    return this.#service.findAllByBranches(input);
  }
  tryFindByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null> {
    return this.#service.tryFindByNumber(input);
  }
  recheckDueBranches(): Promise<number> {
    return this.#service.recheckDueBranches();
  }
  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return this.#service.pruneStaleBranchLinkage();
  }
}
