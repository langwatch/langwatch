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
  githubConfig,
  type GithubRepository,
  type GithubUsageCount,
} from "@langwatch/github-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import { reads, type ProcessMembers } from "@langwatch/process-stores/members";
import { ProjectApi } from "@langwatch/project-contract";
import { Secret } from "@langwatch/secrets";

import type { GithubRepositories } from "../repositories/github.repositories.ts";
import {
  RedisGithubAdapter,
  type GithubRedisConnection,
} from "../repositories/redis/github-redis.connection.ts";
import { GithubInstallNonceRedisRepository } from "../repositories/redis/redis.github-install-nonce.repository.ts";
import { GithubPullRequestStatusCacheRedisRepository } from "../repositories/redis/redis.github-pull-request-status-cache.repository.ts";
import { GithubInstallResponseRules } from "../rules/github-install-response.rules.ts";
import { GithubPullRequestEventRules } from "../rules/github-pull-request-event.rules.ts";
import { GithubBranchDemandService } from "../services/github-branch-demand.service.ts";
import type { BranchMappingRequest } from "../services/github-branch-demand.service.ts";
import { GithubBranchMaintenanceService } from "../services/github-branch-maintenance.service.ts";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service.ts";
import { GithubHostService } from "../services/github-host.service.ts";
import { GithubInstallStateService } from "../services/github-install-state.service.ts";
import { GithubInstallationAccessService } from "../services/github-installation-access.service.ts";
import { GithubInstallationsService } from "../services/github-installations.service.ts";
import { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service.ts";
import { GithubPullRequestStatusService } from "../services/github-pull-request-status.service.ts";
import { GithubFeatureService } from "../services/github.service.ts";
import {
  type GithubProjectActivity,
  type GithubHost,
  type GithubBranchDemand,
  type GithubBranchMaintenance,
} from "./github.members.ts";
import { RedisGithubAppTokenCache } from "./redis-github-app-token-cache.ts";

export type GithubInstallationToken = {
  token: string;
  expiresAt: string;
  repositorySelection?: string;
};

export type GithubInstallationDetails = {
  installationId: string;
  accountLogin: string;
  accountType: string;
  accountId: string;
  repositorySelection: string;
  /** When GitHub says the installation was created; null when it does not say. */
  createdAt: string | null;
};

export type GithubPullRequestSummary = {
  number: number;
  htmlUrl: string;
  title: string;
  state: string;
  draft: boolean;
  mergedAt: string | null;
  closedAt: string | null;
  createdAt: string;
  updatedAt: string;
  authorLogin: string | null;
};

export type MintInstallationTokenInput = {
  installationId: string;
  repositoryIds?: string[];
  permissions?: Record<string, string>;
};

/** The raw GitHub App HTTP client this feature needs, keyed by an App JWT. */
export interface GithubAppClient {
  readonly configured: boolean;
  signAppJwt(nowSec?: number): string;
  getInstallation(installationId: string): Promise<GithubInstallationDetails>;
  mintInstallationToken(input: MintInstallationTokenInput): Promise<GithubInstallationToken>;
  listInstallationRepositories(token: string): Promise<GithubRepository[]>;
  listPullRequestsForHead(input: {
    token: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]>;
  getPullRequest(input: {
    token: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary>;
}

/** The shared cache in front of the raw client's App JWT and installation tokens. */
export interface GithubAppTokenCache {
  readonly configured: boolean;
  getInstallation(installationId: string): Promise<GithubInstallationDetails>;
  mintInstallationToken(input: MintInstallationTokenInput): Promise<GithubInstallationToken>;
  listInstallationRepositories(installationId: string): Promise<GithubRepository[]>;
  listPullRequestsForHead(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    branch: string;
  }): Promise<GithubPullRequestSummary[]>;
  getPullRequest(input: {
    installationId: string;
    repositoryId: string;
    owner: string;
    repo: string;
    number: number;
  }): Promise<GithubPullRequestSummary>;
  computeRepoScopeKey(input: {
    repositoryIds?: string[];
    permissions?: Record<string, string>;
  }): string;
}

export type GithubInfrastructure = Readonly<{
  redis: GithubRedisConnection | null;
  secrets: ProcessMembers["secrets"];
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
  project: GithubProjectActivity;
  config: {
    appId: string;
    privateKey: string;
    appSlug: string;
    webhookSecret: string;
    signingKey: string;
  };
  hostConfig?: { host?: string };
}>;

/** What the fleet-wide branch sweep needs beside its rows. */
export type GithubBranchMaintenanceComposition = Readonly<{
  repositories: GithubRepositories;
  redis: GithubRedisConnection | null;
  config: { appId: string; privateKey: string };
  hostConfig?: { host?: string };
}>;

/** What branch demand needs beside its rows: the project fact the demand call reads. */
export type GithubBranchDemandComposition = Readonly<{
  repositories: GithubRepositories;
  redis: GithubRedisConnection | null;
  config: { appId: string; privateKey: string };
  hostConfig?: { host?: string };
  project: GithubProjectActivity;
}>;

/**
 * The demand service under the two names its cross-feature consumers know.
 * `GithubService` answers the host question from the same `GithubHostApi`
 * this composition resolved and routes into the same demand service.
 */
class ComposedGithubBranchDemand implements GithubBranchDemand {
  static create(parts: {
    demand: GithubBranchDemandService;
    host: GithubHost;
  }): ComposedGithubBranchDemand {
    return new ComposedGithubBranchDemand(parts.demand, parts.host);
  }

  private constructor(
    private readonly demand: GithubBranchDemandService,
    private readonly host: GithubHost,
  ) {}

  canMapRepositoryHost(repositoryHost: string): boolean {
    return this.host.isMappable(repositoryHost);
  }

  requestBranchMapping(input: BranchMappingRequest): Promise<void> {
    return this.demand.request(input);
  }
}

/** The process-owned GitHub capability; provider and persistence stay private. */
export class GithubApp implements GithubApiContract {
  static readonly reads = reads("redis", "secrets");
  static readonly contract = GithubApi;
  static readonly dependencies = { organizations: OrganizationApi, projects: ProjectApi };
  static readonly config = githubConfig;
  static readonly secrets = {
    privateKey: Secret.load("GITHUB_LANGY_PRIVATE_KEY", { optional: true }),
    webhookSecret: Secret.load("GITHUB_LANGY_WEBHOOK_SECRET", { optional: true }),
  } as const;

  readonly #service: GithubApiContract;
  readonly #branchMaintenance: GithubBranchMaintenance;

  private constructor(service: GithubApiContract, branchMaintenance: GithubBranchMaintenance) {
    this.#service = service;
    this.#branchMaintenance = branchMaintenance;
  }

  /**
   * The whole GitHub capability over one set of rows: the installation reads and
   * writes, the branch mapping behind pull-request linkage, the live status read
   * and the installation flow's own signing and rendering.
   */
  static composeApi(parts: GithubComposition): GithubFeatureService {
    const host = GithubHostService.create(parts.hostConfig);
    const redis = parts.redis ? RedisGithubAdapter.create(parts.redis) : null;
    const appTokens = RedisGithubAppTokenCache.create(
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
      cache: GithubPullRequestStatusCacheRedisRepository.create({ redis }),
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
      installState: GithubInstallStateService.create({
        signingKey: parts.config.signingKey,
        nonces: GithubInstallNonceRedisRepository.create({ redis }),
      }),
      installResponse: GithubInstallResponseRules.create(),
      pullRequestEvents: GithubPullRequestEventRules.create(),
    });
  }

  /**
   * The fleet-wide branch sweep alone: the pull-request rows, the
   * installation reads, an App token minter and the host — without composing
   * the organization or project services {@link GithubApp.composeApi} needs.
   */
  static composeBranchMaintenance(
    parts: GithubBranchMaintenanceComposition,
  ): GithubBranchMaintenance {
    const host = GithubHostService.create(parts.hostConfig);
    const redis = parts.redis ? RedisGithubAdapter.create(parts.redis) : null;
    const appTokens = RedisGithubAppTokenCache.create(
      parts.config.appId,
      parts.config.privateKey,
      redis,
      host,
    );
    const { installations, pullRequests } = parts.repositories;
    const installationAccess = GithubInstallationAccessService.create(installations, appTokens);
    const mapping = GithubBranchMappingService.create({
      repository: pullRequests,
      installations: installationAccess,
      appTokens,
      host,
    });

    return GithubBranchMaintenanceService.create({ repository: pullRequests, mapping });
  }

  /**
   * The demand half of pull-request linkage alone. Composes the same four
   * objects as the sweep, deliberately — demand needs a project seam, the
   * sweep must be composable without one, and either may be mounted alone.
   */
  static composeBranchDemand(parts: GithubBranchDemandComposition): GithubBranchDemand {
    const host = GithubHostService.create(parts.hostConfig);
    const redis = parts.redis ? RedisGithubAdapter.create(parts.redis) : null;
    const appTokens = RedisGithubAppTokenCache.create(
      parts.config.appId,
      parts.config.privateKey,
      redis,
      host,
    );
    const { installations, pullRequests } = parts.repositories;
    const installationAccess = GithubInstallationAccessService.create(installations, appTokens);
    const mapping = GithubBranchMappingService.create({
      repository: pullRequests,
      installations: installationAccess,
      appTokens,
      host,
    });
    const demand = GithubBranchDemandService.create({ mapping, project: parts.project, host });

    return ComposedGithubBranchDemand.create({ demand, host });
  }

  static create({ repositories, members, config, dependencies }: GithubSetup): GithubApp {
    const branchConfig = {
      appId: config.appId ?? "",
      privateKey: members.secrets.find("GITHUB_LANGY_PRIVATE_KEY") ?? "",
    };
    const hostConfig = config.host === undefined ? {} : { hostConfig: { host: config.host } };

    return new GithubApp(
      GithubApp.composeApi({
        repositories,
        redis: members.redis,
        organization: dependencies.organizations,
        project: dependencies.projects,
        config: {
          ...branchConfig,
          appSlug: config.appSlug ?? "",
          webhookSecret: members.secrets.find("GITHUB_LANGY_WEBHOOK_SECRET") ?? "",
          // Shares the deployment's one CREDENTIALS_SECRET with the secret
          // module — both read it, neither owns it exclusively.
          signingKey: members.secrets.find("CREDENTIALS_SECRET") ?? "",
        },
        ...hostConfig,
      }),
      // `github_maintenance` (ADR-144), ported from the deleted
      // `GithubWorkerFeatureInstaller`: composed here, not received, so the
      // sweep runs over this same graph's rows.
      GithubApp.composeBranchMaintenance({
        repositories,
        redis: members.redis,
        config: branchConfig,
        ...hostConfig,
      }),
    );
  }

  /** The fleet-wide branch sweep `github_maintenance` schedules. */
  branchMaintenance(): GithubBranchMaintenance {
    return this.#branchMaintenance;
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
  consumeInstallNonce(nonce: string): Promise<boolean | null> {
    return this.#service.consumeInstallNonce(nonce);
  }
  signInstallState(payload: GithubInstallStatePayload): string {
    return this.#service.signInstallState(payload);
  }
  verifyInstallState(token: string | null | undefined): GithubInstallStatePayload | null {
    return this.#service.verifyInstallState(token);
  }
  popupResponseHtml(login: string): string {
    return this.#service.popupResponseHtml(login);
  }
  popupErrorHtml(message: string): string {
    return this.#service.popupErrorHtml(message);
  }
  parsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null {
    return this.#service.parsePullRequestEvent(payload);
  }
  applyWebhookPayload(input: Parameters<GithubApi["applyWebhookPayload"]>[0]): Promise<void> {
    return this.#service.applyWebhookPayload(input);
  }
  getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]> {
    return this.#service.getAllForOrganization(organizationId);
  }
  findByInstallationId(installationId: string): Promise<GithubInstallation | null> {
    return this.#service.findByInstallationId(installationId);
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
  mintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    return this.#service.mintTurnToken(input);
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
    keys: readonly { repositoryHost: string; repositoryFullName: string; headBranch: string }[];
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
  findByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null> {
    return this.#service.findByNumber(input);
  }
  recheckDueBranches(): Promise<number> {
    return this.#service.recheckDueBranches();
  }
  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<GithubUsageCount> {
    return this.#service.countUsage(input);
  }

  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return this.#service.pruneStaleBranchLinkage();
  }
}
