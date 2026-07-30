import type {
  ClaimExchangeResponse,
  ClaimHandoffDescribeResponse,
  ClaimHandoffStartResponse,
  ClaimResult,
  PasskeyRegistrationOptionsResponse,
  PasskeyVerifyResponse,
} from "@langwatch/contracts/agent-onboarding";
import { createLogger } from "@langwatch/observability";
import {
  deriveState,
  type EphemeralAccount,
  toAccountRef,
} from "../domain/account.js";
import type { OnboardingConfig } from "../domain/config.js";
import {
  ClaimHandoffNotFoundError,
  ClaimHandoffVerifierMismatchError,
  EphemeralAccountAlreadyClaimedError,
  EphemeralAccountExpiredError,
  EphemeralAccountNotFoundError,
  OnboardingRateLimitedError,
  PasskeyChallengeMissingError,
  PasskeyRegistrationFailedError,
} from "../domain/errors.js";
import { type ClaimHandoff, isHandoffExpired } from "../domain/handoff.js";
import {
  mintSecret,
  mintUserCode,
  peppered,
  verifyCodeChallenge,
} from "../domain/tokens.js";
import {
  type Clock,
  type EphemeralAccountRepository,
  type HandoffStore,
  type PasskeyRepository,
  systemClock,
  type WebAuthnCeremony,
  type WorkspaceProvisioner,
} from "./ports.js";
import type { CallerIdentity, RateLimitGuard } from "./rate-limit.guard.js";

const logger = createLogger("langwatch:ai-onboarding:claim");

/**
 * Turning a temporary account into a real one.
 *
 * Two entrances. A CLI that already has an identity claims directly. One that
 * doesn't starts a PKCE handoff, prints a URL, and polls while a human signs
 * in and approves in a browser.
 *
 * Neither reissues the ingestion key. The agent is mid-session with that key
 * already exported into its environment; rotating it on claim would break the
 * very session the claim exists to rescue.
 */
export interface ClaimServiceDeps {
  accounts: EphemeralAccountRepository;
  handoffs: HandoffStore;
  workspaces: WorkspaceProvisioner;
  guard: RateLimitGuard;
  config: OnboardingConfig;
  /** Keyed-hash secret for claim tokens and handoff codes. */
  pepper: string;
  passkeys: PasskeyRepository;
  ceremony: WebAuthnCeremony;
  clock?: Clock;
}

export class ClaimService {
  private readonly accounts: EphemeralAccountRepository;
  private readonly handoffs: HandoffStore;
  private readonly workspaces: WorkspaceProvisioner;
  private readonly guard: RateLimitGuard;
  private readonly config: OnboardingConfig;
  private readonly pepper: string;
  private readonly passkeys: PasskeyRepository;
  private readonly ceremony: WebAuthnCeremony;
  private readonly clock: Clock;

  constructor(deps: ClaimServiceDeps) {
    this.accounts = deps.accounts;
    this.handoffs = deps.handoffs;
    this.workspaces = deps.workspaces;
    this.guard = deps.guard;
    this.config = deps.config;
    this.pepper = deps.pepper;
    this.passkeys = deps.passkeys;
    this.ceremony = deps.ceremony;
    this.clock = deps.clock ?? systemClock;
  }

  // -------------------------------------------------------------------------
  // Passkey enrollment — the phone half of the QR handoff
  // -------------------------------------------------------------------------

  /**
   * Issue registration options for the phone that scanned the QR.
   *
   * The credential is enrolled against the placeholder user, which already
   * owns the organization — so when enrollment completes there is nothing to
   * transfer, and the passkey is the account's login from that moment on.
   */
  async beginPasskeyEnrollment(params: {
    handoffCode: string;
  }): Promise<PasskeyRegistrationOptionsResponse> {
    const handoff = await this.loadLiveHandoff(params.handoffCode);
    const account = await this.accounts.findById(handoff.accountId);
    if (account === null) throw new EphemeralAccountNotFoundError();
    this.assertClaimable(account);

    const { options, challenge } = await this.ceremony.buildRegistrationOptions(
      {
        userId: account.userId,
        // The placeholder has no email, so the project name is the only thing
        // the phone can show that means anything to the person holding it.
        userName: account.projectSlug,
        userDisplayName: account.projectName,
      },
    );

    const stored = await this.handoffs.setPasskeyChallenge({
      codeHash: peppered(params.handoffCode, this.pepper),
      challenge,
    });
    if (stored === null) throw new ClaimHandoffNotFoundError();

    return { options, userCode: handoff.userCode };
  }

  /**
   * Verify the attestation and, in the same step, claim the account.
   *
   * Enrolling and claiming are one action on purpose: the human just proved
   * possession of the code the CLI printed and is standing there with their
   * phone unlocked. Making them come back for a separate claim would be
   * ceremony for its own sake. Anyone who never scans still has the 30-day
   * claim-token path.
   */
  async completePasskeyEnrollment(params: {
    handoffCode: string;
    response: Record<string, unknown>;
    label?: string;
  }): Promise<PasskeyVerifyResponse> {
    const codeHash = peppered(params.handoffCode, this.pepper);
    const handoff = await this.loadLiveHandoff(params.handoffCode);
    if (!handoff.passkeyChallenge) throw new PasskeyChallengeMissingError();

    const account = await this.accounts.findById(handoff.accountId);
    if (account === null) throw new EphemeralAccountNotFoundError();
    this.assertClaimable(account);

    const credential = await this.ceremony.verifyRegistration({
      response: params.response,
      expectedChallenge: handoff.passkeyChallenge,
    });
    if (credential === null) throw new PasskeyRegistrationFailedError();

    await this.passkeys.create({
      userId: account.userId,
      label: params.label ?? null,
      credential,
    });

    // The claimer IS the placeholder, so this takes the promote-in-place path:
    // nothing changes hands, `unclaimedAt` clears, and the passkey that was
    // just enrolled becomes the way back in.
    const claimed = await this.attach({ account, userId: account.userId });

    await this.handoffs.approve({ codeHash, userId: account.userId });

    logger.info(
      { projectId: account.projectId, userId: account.userId },
      "claimed ephemeral account by passkey enrollment",
    );

    return { credentialId: credential.credentialId, claimed };
  }

  // -------------------------------------------------------------------------
  // Direct — the CLI already carries an identity
  // -------------------------------------------------------------------------

  async claimDirect(params: {
    claimToken: string;
    userId: string;
    identity: CallerIdentity;
  }): Promise<ClaimResult> {
    await this.guard.guardClaim(params.identity);
    const account = await this.resolveClaimable({
      claimToken: params.claimToken,
      identity: params.identity,
    });
    return this.attach({ account, userId: params.userId });
  }

  // -------------------------------------------------------------------------
  // PKCE handoff — the CLI has no identity yet
  // -------------------------------------------------------------------------

  async startHandoff(params: {
    claimToken: string;
    codeChallenge: string;
    identity: CallerIdentity;
  }): Promise<ClaimHandoffStartResponse> {
    await this.guard.guardClaim(params.identity);
    const account = await this.resolveClaimable({
      claimToken: params.claimToken,
      identity: params.identity,
    });

    const now = this.clock.now();
    const handoffCode = mintSecret();
    const expiresAt = new Date(
      now.getTime() + this.config.handoffTtlSeconds * 1000,
    );

    const handoff: ClaimHandoff = {
      accountId: account.id,
      userCode: mintUserCode(),
      codeChallenge: params.codeChallenge,
      // Denormalised so the browser page can explain the handoff without
      // reading the account — the page renders a decision, it does not need
      // the capability behind it.
      projectName: account.projectName,
      agent: account.agent,
      provisionedAt: account.provisionedAt.toISOString(),
      claimableUntil:
        account.deleteAfter?.toISOString() ?? expiresAt.toISOString(),
      createdAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
      status: "pending",
      approvedByUserId: null,
    };

    await this.handoffs.put({
      // Keyed by hash: the plaintext code travels in a URL that gets pasted
      // into chat and logged by browsers, and should not also be sitting in
      // the store next to the account it unlocks.
      codeHash: peppered(handoffCode, this.pepper),
      handoff,
      ttlSeconds: this.config.handoffTtlSeconds,
    });

    return {
      handoffCode,
      userCode: handoff.userCode,
      claimUrl: `${this.config.appBaseUrl}/claim/${handoffCode}`,
      expiresAt: handoff.expiresAt,
      pollIntervalSeconds: this.config.rateLimits.pollIntervalSeconds,
    };
  }

  /** What the signed-in browser page needs to explain the handoff. */
  async describeHandoff(params: {
    handoffCode: string;
  }): Promise<ClaimHandoffDescribeResponse> {
    const handoff = await this.loadLiveHandoff(params.handoffCode);
    return {
      userCode: handoff.userCode,
      projectName: handoff.projectName,
      agent: handoff.agent,
      provisionedAt: handoff.provisionedAt,
      claimableUntil: handoff.claimableUntil,
      expiresAt: handoff.expiresAt,
    };
  }

  /**
   * The browser half. Attaches the signed-in identity immediately rather than
   * waiting for the CLI's next poll: the claim is what the human just
   * consented to, and leaving it to a poll would mean a CLI that dies between
   * approval and poll loses an account the user believes they claimed.
   */
  async approveHandoff(params: {
    handoffCode: string;
    userId: string;
  }): Promise<ClaimResult> {
    const codeHash = peppered(params.handoffCode, this.pepper);
    const handoff = await this.loadLiveHandoff(params.handoffCode);

    const account = await this.accounts.findById(handoff.accountId);
    if (account === null) throw new EphemeralAccountNotFoundError();
    this.assertClaimable(account);

    const result = await this.attach({ account, userId: params.userId });
    const approved = await this.handoffs.approve({
      codeHash,
      userId: params.userId,
    });
    if (approved === null) throw new ClaimHandoffNotFoundError();

    return result;
  }

  /**
   * The CLI's poll. `pending` is a 200, not an error: it is the expected
   * answer for most of the poll's life, and a CLI forced to tell "not yet"
   * from "broken" by status code gets it wrong the first time the network
   * hiccups.
   */
  async exchange(params: {
    handoffCode: string;
    codeVerifier: string;
  }): Promise<ClaimExchangeResponse> {
    const codeHash = peppered(params.handoffCode, this.pepper);

    const allowed = await this.handoffs.allowPoll({
      codeHash,
      intervalSeconds: this.config.rateLimits.pollIntervalSeconds,
    });
    if (!allowed) {
      throw new OnboardingRateLimitedError({
        axis: "poll",
        retryAfterSeconds: this.config.rateLimits.pollIntervalSeconds,
      });
    }

    const handoff = await this.loadLiveHandoff(params.handoffCode);

    // PKCE is checked before the status is revealed, so a stolen code cannot
    // even be used to watch whether the human has approved yet.
    if (
      !verifyCodeChallenge({
        codeVerifier: params.codeVerifier,
        codeChallenge: handoff.codeChallenge,
      })
    ) {
      // Deliberately not consumed: a failed guess must not be able to kill a
      // handoff the legitimate CLI is still polling.
      throw new ClaimHandoffVerifierMismatchError();
    }

    if (handoff.status === "pending") {
      return {
        status: "pending",
        pollIntervalSeconds: this.config.rateLimits.pollIntervalSeconds,
      };
    }

    const account = await this.accounts.findById(handoff.accountId);
    if (account === null) throw new EphemeralAccountNotFoundError();

    await this.handoffs.consume(codeHash);

    return {
      status: "approved",
      result: {
        account: toAccountRef(account),
        claimedAt: (account.claimedAt ?? this.clock.now()).toISOString(),
      },
    };
  }

  // -------------------------------------------------------------------------
  // Shared
  // -------------------------------------------------------------------------

  /**
   * Resolve a claim token to an account that can still be claimed.
   *
   * A token that does not resolve gets one answer whatever the reason, so the
   * endpoint is not an oracle for "did an account with this token exist". A
   * token that DOES resolve but is past its deadline gets the truth: holding
   * a 256-bit token is itself proof of ownership, nobody reaches that branch
   * by guessing, and the owner deserves to be told their data is gone.
   */
  private async resolveClaimable(params: {
    claimToken: string;
    identity: CallerIdentity;
  }): Promise<EphemeralAccount> {
    const account = await this.accounts.findByClaimTokenHash(
      peppered(params.claimToken, this.pepper),
    );
    if (account === null) {
      await this.guard.recordClaimFailure(params.identity);
      throw new EphemeralAccountNotFoundError();
    }
    this.assertClaimable(account);
    return account;
  }

  private assertClaimable(account: EphemeralAccount): void {
    const state = deriveState(account, this.clock.now());
    if (state === "claimed") throw new EphemeralAccountAlreadyClaimedError();
    if (state === "expired") throw new EphemeralAccountExpiredError();
  }

  private async loadLiveHandoff(handoffCode: string): Promise<ClaimHandoff> {
    const handoff = await this.handoffs.get(peppered(handoffCode, this.pepper));
    if (handoff === null) throw new ClaimHandoffNotFoundError();
    if (isHandoffExpired(handoff, this.clock.now())) {
      throw new ClaimHandoffNotFoundError();
    }
    return handoff;
  }

  /**
   * Settle the claim and clear the deadlines. The unclaimed condition lives in
   * the UPDATE, so two tabs approving the same handoff resolve to one winner
   * and a reaper racing a claim resolves in the claim's favour.
   *
   * Two shapes, decided by whether the claimer is the placeholder itself:
   *
   *   - It is (the passkey path). Nothing changes hands — the organization was
   *     always theirs. Promoting just turns the placeholder into a real person.
   *   - It is not (a CLI already logged in as somebody). Ownership moves to
   *     that user and the placeholder is retired.
   */
  private async attach(params: {
    account: EphemeralAccount;
    userId: string;
    email?: string | null;
    name?: string | null;
  }): Promise<ClaimResult> {
    if (params.userId === params.account.userId) {
      await this.workspaces.promotePlaceholder({
        placeholderUserId: params.account.userId,
        email: params.email ?? null,
        name: params.name ?? null,
      });
    } else {
      await this.workspaces.transferToExistingUser({
        organizationId: params.account.organizationId,
        placeholderUserId: params.account.userId,
        claimingUserId: params.userId,
      });
    }

    const claimedAt = this.clock.now();
    const claimed = await this.accounts.markClaimed({
      id: params.account.id,
      userId: params.userId,
      claimedAt,
    });
    if (claimed === null) throw new EphemeralAccountAlreadyClaimedError();

    logger.info(
      {
        projectId: claimed.projectId,
        organizationId: claimed.organizationId,
        userId: params.userId,
      },
      "claimed ephemeral account",
    );

    return {
      account: toAccountRef(claimed),
      claimedAt: (claimed.claimedAt ?? claimedAt).toISOString(),
    };
  }
}
