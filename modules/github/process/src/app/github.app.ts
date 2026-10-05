import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import {
  GithubApi,
  type GithubApi as GithubApiContract,
  type GithubAppConfig,
  type GithubConnectionAuditEntry,
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
  type GithubWebhookEnvelope,
} from "@langwatch/github-contract";
import {
  OrganizationApi,
  type OrganizationApi as OrganizationApiContract,
} from "@langwatch/organization-contract";
import type { FeatureSetup } from "@langwatch/process";
import { ProjectApi, type ProjectApi as ProjectApiContract } from "@langwatch/project-contract";
import { credentialsSecret, Secret, sessionSecret } from "@langwatch/secrets";

import type { GithubRepositories } from "../repositories/github.repositories.ts";
import { installErrorHtml, installSuccessHtml } from "../rules/github-install-response.rules.ts";
import { parsePullRequestEvent } from "../rules/github-pull-request-event.rules.ts";
import type { GithubWebhookDelivery, GithubWebhookReceipt } from "../rules/github-webhook.rules.ts";
import { GithubAppTokenService } from "../services/github-app-token.service.ts";
import { GithubBranchDemandService } from "../services/github-branch-demand.service.ts";
import type { BranchMappingRequest } from "../services/github-branch-demand.service.ts";
import {
  GithubBranchMaintenanceService,
  type GithubBranchMaintenance,
} from "../services/github-branch-maintenance.service.ts";
import { GithubBranchMappingService } from "../services/github-branch-mapping.service.ts";
import { GithubHostService, type GithubHost } from "../services/github-host.service.ts";
import { GithubInstallStateService } from "../services/github-install-state.service.ts";
import { GithubInstallationAccessService } from "../services/github-installation-access.service.ts";
import { GithubInstallationsService } from "../services/github-installations.service.ts";
import { GithubPullRequestMappingService } from "../services/github-pull-request-mapping.service.ts";
import { GithubPullRequestStatusService } from "../services/github-pull-request-status.service.ts";
import { GithubFeatureService } from "../services/github.service.ts";

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

type GithubSetup = FeatureSetup<
  typeof GithubModule.dependencies,
  never,
  GithubServerConfig,
  GithubRepositories
>;

/** What a graph needs beside its rows to answer for a GitHub App. */
export type GithubComposition = Readonly<{
  repositories: GithubRepositories;
  organization: OrganizationApiContract;
  project: Pick<ProjectApiContract, "getOrganizationId" | "touchCodingAgentPullRequestSeen">;
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
  config: { appId: string; privateKey: string };
  hostConfig?: { host?: string };
}>;

/** What branch demand needs beside its rows: the project fact the demand call reads. */
export type GithubBranchDemandComposition = Readonly<{
  repositories: GithubRepositories;
  config: { appId: string; privateKey: string };
  hostConfig?: { host?: string };
  project: Pick<ProjectApiContract, "getOrganizationId" | "touchCodingAgentPullRequestSeen">;
}>;

/**
 * The demand service under the two names its cross-feature consumers know.
 * `GithubService` answers the host question from the same `GithubHostApi`
 * this composition resolved and routes into the same demand service.
 */
class ComposedGithubBranchDemand {
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

export type GithubBranchDemand = Pick<
  ComposedGithubBranchDemand,
  "canMapRepositoryHost" | "requestBranchMapping"
>;

/** The process-owned GitHub capability; provider and persistence stay private. */
export class GithubModule implements GithubApiContract {
  static readonly contract = GithubApi;
  static readonly dependencies = {
    organizations: OrganizationApi,
    projects: ProjectApi,
    permissions: AuthzApi,
    auth: AuthApi,
    auditLog: AuditLogApi,
    codingAgents: CodingAgentApi,
  };
  static readonly config = githubConfig;
  static readonly secrets = {
    privateKey: Secret.load("GITHUB_LANGY_PRIVATE_KEY", { optional: true }),
    webhookSecret: Secret.load("GITHUB_LANGY_WEBHOOK_SECRET", { optional: true }),
    /** Main's install-state key: CREDENTIALS_SECRET, else NEXTAUTH_SECRET. */
    signingKey: credentialsSecret,
    signingKeyFallback: sessionSecret,
  } as const;

  readonly #service: GithubFeatureService;
  readonly #branchMaintenance: GithubBranchMaintenance;
  readonly #projects: ProjectApiContract;
  readonly #permissions: AuthzApi;
  readonly #auth: AuthApi;
  readonly #auditLog: AuditLogApi;
  readonly #codingAgents: CodingAgentApi;

  private constructor(parts: {
    service: GithubFeatureService;
    branchMaintenance: GithubBranchMaintenance;
    projects: ProjectApiContract;
    permissions: AuthzApi;
    auth: AuthApi;
    auditLog: AuditLogApi;
    codingAgents: CodingAgentApi;
  }) {
    this.#service = parts.service;
    this.#branchMaintenance = parts.branchMaintenance;
    this.#projects = parts.projects;
    this.#permissions = parts.permissions;
    this.#auth = parts.auth;
    this.#auditLog = parts.auditLog;
    this.#codingAgents = parts.codingAgents;
  }

  /**
   * The whole GitHub capability over one set of rows: the installation reads and
   * writes, the branch mapping behind pull-request linkage, the live status read
   * and the installation flow's own signing and rendering.
   */
  static composeApi(parts: GithubComposition): GithubFeatureService {
    const host = GithubHostService.create(parts.hostConfig);
    const appTokens = GithubAppTokenService.create({
      appId: parts.config.appId,
      privateKey: parts.config.privateKey,
      tokenCache: parts.repositories.tokenCache,
      host,
    });
    const { installations: installationsRepository, pullRequests: pullRequestsRepository } =
      parts.repositories;
    const installationAccess = GithubInstallationAccessService.create(
      installationsRepository,
      appTokens,
    );
    const installations = GithubInstallationsService.create({
      repository: installationsRepository,
      appTokens,
      organization: parts.organization,
      access: installationAccess,
    });
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
      cache: parts.repositories.pullRequestStatusCache,
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
        nonces: parts.repositories.installNonces,
      }),
      installResponse: { successHtml: installSuccessHtml, errorHtml: installErrorHtml },
      pullRequestEvents: { parse: parsePullRequestEvent },
    });
  }

  /**
   * The fleet-wide branch sweep alone: the pull-request rows, the
   * installation reads, an App token minter and the host — without composing
   * the organization or project services {@link GithubModule.composeApi} needs.
   */
  static composeBranchMaintenance(
    parts: GithubBranchMaintenanceComposition,
  ): GithubBranchMaintenance {
    const host = GithubHostService.create(parts.hostConfig);
    const appTokens = GithubAppTokenService.create({
      appId: parts.config.appId,
      privateKey: parts.config.privateKey,
      tokenCache: parts.repositories.tokenCache,
      host,
    });
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
    const appTokens = GithubAppTokenService.create({
      appId: parts.config.appId,
      privateKey: parts.config.privateKey,
      tokenCache: parts.repositories.tokenCache,
      host,
    });
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

  static async create({
    repositories,
    secrets,
    config,
    dependencies,
  }: GithubSetup): Promise<GithubModule> {
    const branchConfig = {
      appId: config.appId ?? "",
      privateKey: await secrets.into(GithubModule.secrets.privateKey, (value) => value ?? ""),
    };
    const signingKey =
      (await secrets.into(GithubModule.secrets.signingKey, (value) => value ?? "")) ||
      (await secrets.into(GithubModule.secrets.signingKeyFallback, (value) => value ?? ""));
    const hostConfig = config.host === undefined ? {} : { hostConfig: { host: config.host } };

    return new GithubModule({
      service: GithubModule.composeApi({
        repositories,
        organization: dependencies.organizations,
        project: dependencies.projects,
        config: {
          ...branchConfig,
          appSlug: config.appSlug ?? "",
          webhookSecret: await secrets.into(
            GithubModule.secrets.webhookSecret,
            (value) => value ?? "",
          ),
          signingKey,
        },
        ...hostConfig,
      }),
      // `github_maintenance` (ADR-144), ported from the deleted
      // `GithubWorkerFeatureInstaller`: composed here, not received, so the
      // sweep runs over this same graph's rows.
      branchMaintenance: GithubModule.composeBranchMaintenance({
        repositories,
        config: branchConfig,
        ...hostConfig,
      }),
      projects: dependencies.projects,
      permissions: dependencies.permissions,
      auth: dependencies.auth,
      auditLog: dependencies.auditLog,
      codingAgents: dependencies.codingAgents,
    });
  }

  /** The capability the installation and connection doors read: this module itself. */
  github(): GithubApiContract {
    return this;
  }
  /** Connecting grants the whole organization's repository access, so it takes management. */
  canManageOrganization(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.#permissions.hasPermission({ ...input, permission: "organization:manage" });
  }
  /** The organization is derived from the project, never taken from the caller. */
  async getProjectPullRequestLiveStatuses(input: {
    projectId: string;
    refs: readonly GithubPullRequestRef[];
  }): Promise<{ statuses: GithubPullRequestLiveStatus[] }> {
    const organizationId = await this.#projects.findOrganizationId(input.projectId);
    if (!organizationId) return { statuses: [] };

    const statuses = await this.getLivePullRequestStatuses({ organizationId, refs: input.refs });
    return { statuses: [...statuses] };
  }
  /** Whether the person who started the install flow is the one signed in on this request. */
  async isSignedInAs(input: { request: Request; userId: string }): Promise<boolean> {
    const verification = await this.#auth.verifyBrowserSession({
      headers: input.request.headers,
    });
    if (verification.kind === "anonymous") return false;
    const resolution = await this.#auth.resolveBrowserSession({
      verified: verification.verified,
    });

    return resolution.kind === "signed_in" && resolution.session.user.id === input.userId;
  }
  async recordAudit(entry: GithubConnectionAuditEntry): Promise<void> {
    await this.#auditLog.record(entry);
  }
  async backfillPullRequestMappings(input: { organizationId: string }): Promise<void> {
    await this.#codingAgents.backfillPullRequestMappings(input);
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
  consumeInstallNonce(nonce: string): Promise<"consumed" | "spent" | "unavailable"> {
    return this.#service.consumeInstallNonce(nonce);
  }
  signInstallState(payload: GithubInstallStatePayload): string {
    return this.#service.signInstallState(payload);
  }
  parseInstallState(token: string | null | undefined): GithubInstallStatePayload | null {
    return this.#service.parseInstallState(token);
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
  receiveWebhook(delivery: GithubWebhookDelivery): Promise<GithubWebhookReceipt> {
    return this.#service.receiveWebhook(delivery);
  }
  applyWebhookPayload(input: {
    payload: GithubWebhookEnvelope;
    eventType: string | undefined;
    deliveryId: string | undefined;
  }): Promise<void> {
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
  findTurnTokens(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken[]> {
    return this.#service.findTurnTokens(input);
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
