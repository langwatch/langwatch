import type {
  GithubApi,
  GithubConnectionStatus,
  GithubDisconnectResult,
  GithubInstallation,
  GithubRepositoryRef,
  GithubPullRequestLiveStatus,
  GithubPullRequestRef,
  GithubTurnToken,
  GithubPullRequest,
  GithubPullRequestEvent,
  GithubWebhookEnvelope,
  GithubInstallStatePayload,
  GithubAppConfig,
  GithubUsageCount,
} from "@langwatch/github-contract";
import { createLogger } from "@langwatch/observability";
import { z } from "zod";

import type {
  GithubHost,
  GithubInstallResponse,
  GithubInstallState,
  GithubPullRequestEventParser,
} from "../app/github.members.ts";
import { GithubConnectionService } from "./github-connection.service.ts";
import { GithubInstallationsService } from "./github-installations.service.ts";
import {
  type BranchMappingRequest,
  GithubPullRequestMappingService,
} from "./github-pull-request-mapping.service.ts";
import { GithubPullRequestStatusService } from "./github-pull-request-status.service.ts";

const logger = createLogger("langwatch:github:webhook");
const installationEnvelopeSchema = z.object({
  action: z.unknown().optional(),
  installation: z.object({ id: z.number().optional() }).nullish(),
});
const webhookActionSchema = z.enum([
  "created",
  "deleted",
  "suspend",
  "unsuspend",
  "added",
  "removed",
]);

type GithubServiceDependencies = {
  installations: GithubInstallationsService;
  mapping: GithubPullRequestMappingService;
  status: GithubPullRequestStatusService;
  config: {
    appSlug: string;
    webhookSecret: string;
  };
  host: GithubHost;
  installState: GithubInstallState;
  installResponse: GithubInstallResponse;
  pullRequestEvents: GithubPullRequestEventParser;
};

/**
 * The single process-facing GitHub capability. The focused collaborators are
 * implementation details of this service; Coding Agent, Langy and transports
 * depend on this facade rather than constructing repositories or sub-services.
 */
export class GithubFeatureService implements GithubApi {
  private readonly connection: GithubConnectionService;

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
    private readonly host: GithubHost,
    private readonly installState: GithubInstallState,
    private readonly installResponse: GithubInstallResponse,
    private readonly pullRequestEvents: GithubPullRequestEventParser,
  ) {
    this.connection = GithubConnectionService.create({
      installations,
      getAppConfig: () => this.getAppConfig(),
      getWebBase: () => this.getWebBase(),
    });
  }

  getConnectionStatus(input: { organizationId: string }): Promise<GithubConnectionStatus> {
    return this.connection.getConnectionStatus(input);
  }

  disconnect(input: {
    organizationId: string;
    installationId: string;
  }): Promise<GithubDisconnectResult> {
    return this.connection.disconnect(input);
  }

  getAllForOrganization(organizationId: string): Promise<readonly GithubInstallation[]> {
    return this.installations.getAllForOrganization(organizationId);
  }

  get configured(): boolean {
    return this.getAppConfig().configured;
  }

  findByInstallationId(installationId: string): Promise<GithubInstallation | null> {
    return this.installations.findByInstallationId(installationId);
  }

  isOrganizationMember(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.installations.isOrganizationMember(input);
  }

  recordInstallation(input: {
    installationId: string;
    organizationId: string;
    flowStartedAt: number;
    expectedAccountLogin?: string | undefined;
    expectedInstallationId?: string | undefined;
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

  listRepositoriesForOrganization(organizationId: string): Promise<readonly GithubRepositoryRef[]> {
    return this.installations.listRepositoriesForOrganization(organizationId);
  }

  mintTurnToken(input: {
    organizationId: string;
    repositoryFullName?: string;
  }): Promise<GithubTurnToken | null> {
    return this.installations.mintTurnToken(input);
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

  consumeInstallNonce(nonce: string): Promise<boolean | null> {
    return this.installState.consumeNonce(nonce);
  }

  signInstallState(payload: GithubInstallStatePayload): string {
    return this.installState.sign(payload);
  }

  verifyInstallState(token: string | null | undefined): GithubInstallStatePayload | null {
    return this.installState.verify(token);
  }

  popupResponseHtml(login: string): string {
    return this.installResponse.successHtml(login);
  }

  popupErrorHtml(message: string): string {
    return this.installResponse.errorHtml(message);
  }

  parsePullRequestEvent(payload: unknown): GithubPullRequestEvent | null {
    return this.pullRequestEvents.parse(payload);
  }

  async applyWebhookPayload(input: {
    payload: GithubWebhookEnvelope;
    eventType: string | undefined;
    deliveryId: string | undefined;
  }): Promise<void> {
    if (input.eventType === "pull_request") {
      const event = this.pullRequestEvents.parse(input.payload);
      if (!event) {
        logger.info(
          { deliveryId: input.deliveryId },
          "github pull request delivery dropped before linkage",
        );
        return;
      }

      try {
        await this.mapping.applyPullRequestEvent(event);
      } catch (error) {
        logger.warn(
          { error, action: event.action, installationId: event.installationId },
          "github pull request webhook handling failed",
        );
      }
      return;
    }

    if (input.eventType !== "installation" && input.eventType !== "installation_repositories") {
      return;
    }

    const event = installationEnvelopeSchema.safeParse(input.payload).data;
    const action = webhookActionSchema.safeParse(event?.action).data;
    const installationId = event?.installation?.id != null ? String(event.installation.id) : null;
    if (!installationId || !action) return;

    try {
      await this.installations.handleWebhookEvent({ action, installationId });
    } catch (error) {
      logger.warn({ error, action, installationId }, "github webhook handling failed");
    }
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
    keys: readonly {
      repositoryHost: string;
      repositoryFullName: string;
      headBranch: string;
    }[];
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

  findByNumber(input: {
    organizationId: string;
    repositoryHost: string;
    repositoryFullName: string;
    prNumber: number;
  }): Promise<GithubPullRequest | null> {
    return this.mapping.findByNumber(input);
  }

  recheckDueBranches(): Promise<number> {
    return this.mapping.recheckDueBranches();
  }

  countUsage(input: {
    organizationIds: readonly string[];
    since?: number;
  }): Promise<GithubUsageCount> {
    return this.mapping.countUsage(input);
  }

  pruneStaleBranchLinkage(): Promise<{ branchChecks: number }> {
    return this.mapping.pruneStaleBranchLinkage();
  }
}
