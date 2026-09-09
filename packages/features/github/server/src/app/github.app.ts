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
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { PrismaGithubInstallationsDatabase } from "../repositories/prisma/github-installations.repository.ts";
import type { PrismaGithubPullRequestsDatabase } from "../repositories/prisma/github-pull-requests.repository.ts";
import { PostgresGithubAdapter } from "../adapters/postgres.github.adapter.ts";
import type { GithubRedisConnection } from "../adapters/redis.github.adapter.ts";

export type GithubInfrastructure = Readonly<{
  database: PrismaGithubInstallationsDatabase & PrismaGithubPullRequestsDatabase;
  redis: GithubRedisConnection | null;
  signingKey: string;
}>;

type GithubSetup = FeatureSetup<
  typeof GithubApp.dependencies,
  GithubInfrastructure,
  GithubServerConfig
>;

/** The process-owned GitHub capability; provider and persistence stay private. */
export class GithubApp implements GithubApiContract {
  static readonly contract = GithubApi;
  static readonly dependencies = { organizations: OrganizationApi, projects: ProjectApi };
  static readonly configSchema = githubServerConfigSchema;

  readonly #service: GithubApiContract;

  private constructor(service: GithubApiContract) {
    this.#service = service;
  }

  static create({ infrastructure, config, dependencies }: GithubSetup): GithubApp {
    const service = PostgresGithubAdapter.create({
      database: infrastructure.database,
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
    });
    return new GithubApp(service);
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
