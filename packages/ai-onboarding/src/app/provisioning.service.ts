import type {
  ProvisionRequest,
  ProvisionResponse,
  StatusResponse,
} from "@langwatch/contracts/agent-onboarding";
import { createLogger } from "@langwatch/observability";
import {
  computeDeadlines,
  defaultProjectName,
  toAccountRef,
  toLifecycle,
} from "../domain/account.js";
import type { OnboardingConfig } from "../domain/config.js";
import { buildLifecycleNotice } from "../domain/copy.js";
import {
  AnonymousProvisioningDisabledError,
  EphemeralAccountNotFoundError,
} from "../domain/errors.js";
import { mintSecret, peppered } from "../domain/tokens.js";
import {
  type Clock,
  type EphemeralAccountRepository,
  systemClock,
  type WorkspaceProvisioner,
} from "./ports.js";
import type { CallerIdentity, RateLimitGuard } from "./rate-limit.guard.js";

const logger = createLogger("langwatch:ai-onboarding:provisioning");

/**
 * The anonymous front door: mints an org, a project and a write-only key from
 * an unauthenticated POST, and reports the countdown afterwards.
 *
 * The zero-auth shape is the feature, not an oversight — an agent cannot fill
 * in a signup form, open a browser or pay. Everything that makes it safe is
 * the rate-limit guard in front and the deadlines behind.
 */
export interface ProvisioningServiceDeps {
  accounts: EphemeralAccountRepository;
  workspaces: WorkspaceProvisioner;
  guard: RateLimitGuard;
  config: OnboardingConfig;
  /** Keyed-hash secret for claim tokens, fingerprints and addresses. */
  pepper: string;
  clock?: Clock;
}

export class ProvisioningService {
  private readonly accounts: EphemeralAccountRepository;
  private readonly workspaces: WorkspaceProvisioner;
  private readonly guard: RateLimitGuard;
  private readonly config: OnboardingConfig;
  private readonly pepper: string;
  private readonly clock: Clock;

  constructor(deps: ProvisioningServiceDeps) {
    this.accounts = deps.accounts;
    this.workspaces = deps.workspaces;
    this.guard = deps.guard;
    this.config = deps.config;
    this.pepper = deps.pepper;
    this.clock = deps.clock ?? systemClock;
  }

  async provision(params: {
    request: ProvisionRequest;
    identity: CallerIdentity;
  }): Promise<ProvisionResponse> {
    if (!this.config.provisioningEnabled) {
      throw new AnonymousProvisioningDisabledError();
    }

    // Metered before anything is created, so a refused request leaves no
    // organization, project or key behind.
    await this.guard.guardProvision(params.identity);

    const { request, identity } = params;
    const provisionedAt = this.clock.now();
    const projectName =
      request.projectName ?? defaultProjectName(request.agent);

    const workspace = await this.workspaces.provision({
      projectName,
      agent: request.agent,
    });

    const claimToken = mintSecret();
    const deadlines = computeDeadlines({
      provisionedAt,
      ingestionDays: this.config.ingestionDays,
      retentionDays: this.config.retentionDays,
    });

    const account = await this.accounts.create({
      organizationId: workspace.organizationId,
      projectId: workspace.projectId,
      projectSlug: workspace.projectSlug,
      projectName: workspace.projectName,
      agent: request.agent,
      claimTokenHash: peppered(claimToken, this.pepper),
      // Peppered, never raw: a database dump must not be reversible into
      // "which machines and addresses tried LangWatch".
      fingerprintHash: identity.fingerprint
        ? peppered(identity.fingerprint, this.pepper)
        : null,
      ipHash: identity.ip ? peppered(identity.ip, this.pepper) : null,
      provisionedAt,
      ...deadlines,
    });

    logger.info(
      {
        projectId: account.projectId,
        organizationId: account.organizationId,
        agent: account.agent,
      },
      "provisioned ephemeral account",
    );

    return {
      account: toAccountRef(account),
      ingestion: {
        apiKey: workspace.ingestionKey.token,
        keyPrefix: workspace.ingestionKey.prefix,
        endpoint: this.config.appBaseUrl,
        otlpEndpoint: this.config.otlpEndpoint,
      },
      claim: {
        token: claimToken,
        url: `${this.config.appBaseUrl}/claim`,
        claimableUntil: deadlines.deleteAfter.toISOString(),
      },
      lifecycle: toLifecycle(account, provisionedAt),
      notice: buildLifecycleNotice(this.config),
    };
  }

  /**
   * The countdown the CLI prints. An expired-but-not-yet-reaped account
   * reports `expired` rather than erroring — the CLI has something useful to
   * say about it, which it would not have about a 410.
   */
  async status(params: { claimToken: string }): Promise<StatusResponse> {
    const account = await this.accounts.findByClaimTokenHash(
      peppered(params.claimToken, this.pepper),
    );
    if (account === null) throw new EphemeralAccountNotFoundError();

    return {
      account: toAccountRef(account),
      lifecycle: toLifecycle(account, this.clock.now()),
      notice: buildLifecycleNotice(this.config),
    };
  }
}
