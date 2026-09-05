import { randomBytes } from "node:crypto";
import {
  IdentityVerificationExpiredError,
  normalizeIdentifierValue,
} from "@langwatch/identity-contract";

/**
 * Sign-up's address confirmation (D13, ADR-117 §6).
 */

/** A single-use address-confirmation token, as storage holds it. */
export interface SignUpVerificationTokenStore {
  issue(input: { identifier: string; token: string; expires: Date }): Promise<void>;
  /**
   * Spends a token: returns the identifier it was issued for and makes it unusable, or
   * answers null for a token that never existed, was already spent, or has expired. One
   * answer for all three on purpose — see `completeVerification`.
   */
  claim(input: { token: string; now: Date }): Promise<{
    identifier: string;
  } | null>;
}

export interface SignUpVerificationMailer {
  sendVerificationLink(input: { email: string; verificationUrl: string }): Promise<void>;
}

/** Whether an address already has an account (epic Q12: sign-up may say so). */
export interface SignUpAccountDirectory {
  hasAccountFor(input: { email: string }): Promise<boolean>;
}

/** Creates the account a confirmed pending credential earned. */
export interface SignUpAccountFactory {
  createCredentialAccount(input: { email: string; passwordHash: string }): Promise<void>;
  /**
   * The link came back, so the address is proven.
   */
  markAddressConfirmed(input: { email: string }): Promise<void>;
}

export interface SignUpVerificationDeps {
  tokens: SignUpVerificationTokenStore;
  mailer: SignUpVerificationMailer;
  directory: SignUpAccountDirectory;
  accounts: SignUpAccountFactory;
  /** Builds the link the email carries, from a minted token. */
  buildVerificationUrl(input: { token: string }): string;
  now?: () => Date;
  mintToken?: () => string;
}

/**
 * The identifier prefix the token rows carry. Namespaced because the same
 * table holds password-reset and other tokens: a sign-up token must never be
 * spendable anywhere else, and nothing else must be spendable here.
 */
const SIGN_UP_TOKEN_NAMESPACE = "identity-signup-verification:";

/** One hour, matching the reset link's lifetime and the email's promise. */
export const SIGN_UP_VERIFICATION_TTL_MS = 60 * 60 * 1000;

/**
 * What a sign-up token stands for: an address, and — only on links minted before both
 * doors converged — a credential.
 */
interface PendingSignUp {
  email: string;
  passwordHash: string | null;
}

export class SignUpVerificationService {
  private readonly deps: SignUpVerificationDeps;

  private constructor(deps: SignUpVerificationDeps) {
    this.deps = deps;
  }

  static create(deps: SignUpVerificationDeps): SignUpVerificationService {
    return new SignUpVerificationService(deps);
  }

  /**
   * Whether the address already holds an account — the one question sign-up
   * is allowed to answer out loud (epic Q12), because refusing to say it is
   * what strands somebody on an account they half-created.
   */
  async addressIsRegistered({ email }: { email: string }): Promise<boolean> {
    return this.deps.directory.hasAccountFor({
      email: normalizeIdentifierValue(email),
    });
  }

  /**
   * Sends a fresh confirmation link. Idempotent from the customer's side:
   * asking twice sends twice and both links work until one is spent, which is
   * the behavior a person who cannot find the first email expects.
   */
  async requestVerification({ email }: { email: string }): Promise<void> {
    await this.issueLink({ email, passwordHash: null });
  }

  /**
   * Spends a link, and answers the address it confirmed. Both doors answer `accountCreated:
   * false` and send the person to the one screen that chooses a password.
   */
  async completeVerification({ token }: { token: string }): Promise<{
    email: string;
    accountCreated: boolean;
    accountExists: boolean;
  }> {
    const claimed = await this.deps.tokens.claim({ token, now: this.now() });
    const pending = claimed ? readPendingSignUp(claimed.identifier) : null;

    if (!pending) {
      throw new IdentityVerificationExpiredError();
    }

    const alreadyRegistered = await this.addressIsRegistered({
      email: pending.email,
    });

    // The ordinary case now: sign-up made the account and this link is the
    // address catching up with it. Confirming is the whole job.
    if (alreadyRegistered) {
      await this.deps.accounts.markAddressConfirmed({ email: pending.email });

      return {
        email: pending.email,
        accountCreated: false,
        accountExists: true,
      };
    }

    // No account, and no credential to make one from: the link came from the
    // log-in door, where a password is asked for once and never kept. The
    // screen takes it from here.
    if (!pending.passwordHash) {
      return {
        email: pending.email,
        accountCreated: false,
        accountExists: false,
      };
    }

    await this.deps.accounts.createCredentialAccount({
      email: pending.email,
      passwordHash: pending.passwordHash,
    });
    await this.deps.accounts.markAddressConfirmed({ email: pending.email });

    return { email: pending.email, accountCreated: true, accountExists: true };
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
      expires: new Date(this.now().getTime() + SIGN_UP_VERIFICATION_TTL_MS),
    });

    await this.deps.mailer.sendVerificationLink({
      email: normalized,
      verificationUrl: this.deps.buildVerificationUrl({ token }),
    });
  }

  private now(): Date {
    return this.deps.now?.() ?? new Date();
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
function readPendingSignUp(identifier: string): PendingSignUp | null {
  if (!identifier.startsWith(SIGN_UP_TOKEN_NAMESPACE)) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(identifier.slice(SIGN_UP_TOKEN_NAMESPACE.length));
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const { email, passwordHash } = parsed as Record<string, unknown>;
    if (typeof email !== "string" || email.length === 0) {
      return null;
    }

    return {
      email,
      passwordHash: typeof passwordHash === "string" ? passwordHash : null,
    };
  } catch {
    return null;
  }
}

function defaultMintToken(): string {
  return randomBytes(32).toString("base64url");
}
