import { randomBytes } from "node:crypto";

import {
  DirectRegistrationUnavailableError,
  FrontDoorRateLimitedError,
} from "@langwatch/auth-contract";
import {
  IdentityVerificationExpiredError,
  isOrganizationManagedDecision,
  normalizeIdentifierValue,
  type RoutingDecision,
} from "@langwatch/identity-contract";
import { nowInstant, type Instant } from "@langwatch/time";
import { EmailAlreadyRegisteredError, type UserApi } from "@langwatch/user-contract";

import type { SignUpVerificationMailChannel } from "../channels/sign-up-verification-mail.channel.ts";
import type { SignUpVerificationTokenRepository } from "../repositories/signup-verification.repository.ts";

/**
 * Sign-up's address confirmation (D13, ADR-117 §6), main's current service: the link proves
 * an address before an account exists, and never adopts an account that already does.
 */

/** What an address already is to us: no account, an unconfirmed one, or a confirmed one. */
export type SignUpAddressState = "unknown" | "awaiting_confirmation" | "confirmed";

export interface SignUpVerificationDeps {
  tokens: SignUpVerificationTokenRepository;
  mailer: SignUpVerificationMailChannel;
  users: Pick<UserApi, "findByEmail">;
  /** Where the address signs in; an organization's own connection refuses a password sign-up. */
  route(input: Readonly<{ identifier: string; breakGlass: boolean }>): Promise<RoutingDecision>;
  isWithinBudget(
    input: Readonly<{ key: string; windowSeconds: number; max: number }>,
  ): Promise<Readonly<{ allowed: boolean; retryAfterSeconds?: number | undefined }>>;
  /** Builds the link the email carries, from a minted token. */
  buildVerificationUrl(input: { token: string }): string;
  now?: () => Instant;
  mintToken?: () => string;
}

/** Namespaced: the same table holds other tokens, and none may be spent across features. */
const SIGN_UP_TOKEN_NAMESPACE = "identity-signup-verification:";

/** One hour, matching the reset link's lifetime and the email's promise. */
export const SIGN_UP_VERIFICATION_TTL_MS = 60 * 60 * 1000;

/** A link confirmed an address with no account behind it; `user.register` spends this proof. */
const CONFIRMED_ADDRESS_NAMESPACE = "identity-signup-confirmed:";

/** Long enough to choose a password on the next screen; worthless in a closed tab. */
export const CONFIRMED_ADDRESS_TTL_MS = 30 * 60 * 1000;

/** How long a spent link, opened again, still answers as it did the first time. */
export const SPENT_LINK_GRACE_MS = 24 * 60 * 60 * 1000;

/** The per-address budget: at most this many links an hour, whoever asks. */
const LINKS_PER_ADDRESS_PER_HOUR = 5;

/** A token's address, and a credential only on links minted before both doors converged. */
interface PendingSignUp {
  email: string;
  passwordHash: string | null;
}

type CompletedVerification = {
  email: string;
  accountCreated: boolean;
  accountExists: boolean;
  addressProof: string | null;
};

export class SignUpVerificationService {
  private readonly deps: SignUpVerificationDeps;

  private constructor(deps: SignUpVerificationDeps) {
    this.deps = deps;
  }

  static create(deps: SignUpVerificationDeps): SignUpVerificationService {
    return new SignUpVerificationService(deps);
  }

  /** What the address already is: the one question sign-up may answer out loud (epic Q12). */
  async addressState({ email }: { email: string }): Promise<SignUpAddressState> {
    const account = await this.deps.users.findByEmail({ email: normalizeIdentifierValue(email) });
    if (!account) return "unknown";

    return account.emailVerified ? "confirmed" : "awaiting_confirmation";
  }

  /** Whether the address holds an account, confirmed or not. */
  async addressIsRegistered({ email }: { email: string }): Promise<boolean> {
    return (await this.addressState({ email })) !== "unknown";
  }

  /** Sends a fresh confirmation link; asking twice sends twice and both links work. */
  async requestVerification({ email }: { email: string }): Promise<void> {
    await this.issueLink({ email, passwordHash: null });
  }

  /**
   * A signed-out sign-up's link, as main's router answers it: an organization's connection
   * refuses, a confirmed address is told so, and each address gets its own hourly budget.
   */
  async requestNewAccountVerification({ email }: { email: string }): Promise<void> {
    const decision = await this.deps.route({ identifier: email, breakGlass: false });
    if (isOrganizationManagedDecision(decision)) {
      throw new DirectRegistrationUnavailableError();
    }
    if ((await this.addressState({ email })) === "confirmed") {
      throw new EmailAlreadyRegisteredError();
    }

    const budget = await this.deps.isWithinBudget({
      key: `auth.requestSignUpVerification:address:${email.toLowerCase()}`,
      windowSeconds: 60 * 60,
      max: LINKS_PER_ADDRESS_PER_HOUR,
    });
    if (!budget.allowed) {
      throw new FrontDoorRateLimitedError("Too many signup attempts. Please try again later.", {
        retryAfterSeconds: budget.retryAfterSeconds,
      });
    }

    await this.requestVerification({ email });
  }

  /**
   * Spends a link and answers the address it proved, with the proof `user.register` spends.
   * An address that already holds an account is refused: the link never adopts it.
   */
  async completeVerification({ token }: { token: string }): Promise<CompletedVerification> {
    const now = this.now();
    const claimed = await this.deps.tokens.claim({
      token,
      now,
      keepSpentUntil: now.add({ milliseconds: SPENT_LINK_GRACE_MS }),
    });
    const pending = claimed.claimed ? parsePendingSignUp(claimed.identifier) : null;

    if (!pending) {
      const reopened = await this.reopenSpentLink({ token });
      if (reopened) return reopened;
      throw new IdentityVerificationExpiredError();
    }

    if (await this.addressIsRegistered({ email: pending.email })) {
      throw new IdentityVerificationExpiredError();
    }

    // A credential on an old link is untrusted: the mailbox proves the address, not the hash.
    return {
      email: pending.email,
      accountCreated: false,
      accountExists: false,
      addressProof: await this.issueAddressProof({ email: pending.email }),
    };
  }

  /**
   * Spends a proof `completeVerification` minted. Single-use and bound to the
   * address: missing, expired, spent or another address's proof all answer false.
   */
  async claimAddressProof({ token, email }: { token: string; email: string }): Promise<boolean> {
    return this.deps.tokens.claimExpected({
      token,
      identifier: `${CONFIRMED_ADDRESS_NAMESPACE}${normalizeIdentifierValue(email)}`,
      now: this.now(),
    });
  }

  /** Whether the proof is live for this address, spending nothing: a ceremony checks
   *  before it starts. */
  async validateAddressProof({ token, email }: { token: string; email: string }): Promise<boolean> {
    return this.deps.tokens.hasExpected({
      token,
      identifier: `${CONFIRMED_ADDRESS_NAMESPACE}${normalizeIdentifierValue(email)}`,
      now: this.now(),
    });
  }

  /** The same link opened again inside its grace: status only, no fresh proof. */
  private async reopenSpentLink({
    token,
  }: {
    token: string;
  }): Promise<CompletedVerification | null> {
    const spent = await this.deps.tokens.findSpent({ token, now: this.now() });
    const pending = spent ? parsePendingSignUp(spent.identifier) : null;
    if (!pending) return null;

    return {
      email: pending.email,
      accountCreated: false,
      accountExists: await this.addressIsRegistered({ email: pending.email }),
      addressProof: null,
    };
  }

  private async issueAddressProof({ email }: { email: string }): Promise<string> {
    const token = this.mintToken();

    await this.deps.tokens.issue({
      identifier: `${CONFIRMED_ADDRESS_NAMESPACE}${email}`,
      token,
      expires: this.now().add({ milliseconds: CONFIRMED_ADDRESS_TTL_MS }),
    });

    return token;
  }

  private async issueLink({
    email,
    passwordHash,
  }: {
    email: string;
    passwordHash: string | null;
  }): Promise<void> {
    const normalized = normalizeIdentifierValue(email);
    const token = this.mintToken();

    await this.deps.tokens.issue({
      identifier: writePendingSignUp({ email: normalized, passwordHash }),
      token,
      expires: this.now().add({ milliseconds: SIGN_UP_VERIFICATION_TTL_MS }),
    });

    await this.deps.mailer.sendVerificationLink({
      email: normalized,
      verificationUrl: this.deps.buildVerificationUrl({ token }),
    });
  }

  private now(): Instant {
    return this.deps.now?.() ?? nowInstant();
  }

  private mintToken(): string {
    return this.deps.mintToken?.() ?? defaultMintToken();
  }
}

function writePendingSignUp(pending: PendingSignUp): string {
  return `${SIGN_UP_TOKEN_NAMESPACE}${JSON.stringify(pending)}`;
}

/**
 * Reads a token row back, refusing anything that is not one of ours. A row
 * written by another feature, or by an older shape of this one, is not a
 * sign-up: answering null sends it down the same path as an expired link.
 */
function parsePendingSignUp(identifier: string): PendingSignUp | null {
  if (!identifier.startsWith(SIGN_UP_TOKEN_NAMESPACE)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(identifier.slice(SIGN_UP_TOKEN_NAMESPACE.length));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    if (!("email" in parsed) || typeof parsed.email !== "string" || parsed.email.length === 0) {
      return null;
    }
    const passwordHash = "passwordHash" in parsed ? parsed.passwordHash : null;

    return {
      email: parsed.email,
      passwordHash: typeof passwordHash === "string" ? passwordHash : null,
    };
  } catch {
    return null;
  }
}

function defaultMintToken(): string {
  return randomBytes(32).toString("base64url");
}
