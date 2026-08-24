import { randomBytes } from "node:crypto";
import {
  IdentityVerificationExpiredError,
  normalizeIdentifierValue,
} from "@langwatch/identity";

/**
 * Sign-up's address confirmation (D13, ADR-117 §6).
 *
 * The front door verifies the address BEFORE any sign-in method is chosen, so
 * this is the first thing sign-up does and the only thing it does until the
 * emailed link comes back. Nothing is created for the address in between: the
 * only state a request leaves behind is a single-use token with an hour on it,
 * which is what makes an abandoned sign-up cost nothing and an expired one
 * recoverable by asking again.
 *
 * A token may carry a PENDING CREDENTIAL: the password somebody typed into the
 * log-in form for an address nobody holds. That is the same journey arriving
 * from the other door — they meant to get in, and there is no account yet — so
 * it is answered the same way, with a confirmation link, and the account is
 * created when the link comes back. Only the hash is held, never the password,
 * so an abandoned attempt leaves nothing worth stealing.
 *
 * The service holds no Prisma and no mailer of its own: both are ports,
 * composed in `runtime.ts`, so the whole flow is exercised by a unit test with
 * no datastore in sight.
 */

/** A single-use address-confirmation token, as storage holds it. */
export interface SignUpVerificationTokenStore {
  issue(input: {
    identifier: string;
    token: string;
    expires: Date;
  }): Promise<void>;
  /**
   * Spends a token: returns the identifier it was issued for and makes it
   * unusable, or answers null for a token that never existed, was already
   * spent, or has expired. One answer for all three on purpose — see
   * `completeVerification`.
   */
  claim(input: { token: string; now: Date }): Promise<{
    identifier: string;
  } | null>;
}

export interface SignUpVerificationMailer {
  sendVerificationLink(input: {
    email: string;
    verificationUrl: string;
  }): Promise<void>;
}

/** Whether an address already has an account (epic Q12: sign-up may say so). */
export interface SignUpAccountDirectory {
  hasAccountFor(input: { email: string }): Promise<boolean>;
}

/** Creates the account a confirmed pending credential earned. */
export interface SignUpAccountFactory {
  createCredentialAccount(input: {
    email: string;
    passwordHash: string;
  }): Promise<void>;
}

export interface SignUpVerificationDeps {
  tokens: SignUpVerificationTokenStore;
  mailer: SignUpVerificationMailer;
  directory: SignUpAccountDirectory;
  accounts: SignUpAccountFactory;
  /** Hashes a password the way every other credential here is hashed. */
  hashPassword(password: string): Promise<string>;
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

/** What a sign-up token stands for: an address, and sometimes a credential. */
interface PendingSignUp {
  email: string;
  passwordHash: string | null;
}

export type PasswordSignUpOutcome =
  /** The address has an account: this was a wrong password, not a sign-up. */
  | { outcome: "account_exists" }
  /** Nobody holds the address: a confirmation link is on its way. */
  | { outcome: "verification_sent" };

export class SignUpVerificationService {
  private readonly deps: SignUpVerificationDeps;

  constructor(deps: SignUpVerificationDeps) {
    this.deps = deps;
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
   * A password typed into the log-in form for an address that turns out to
   * have no account. It is a sign-up that came in the other door, so it is
   * answered like one: the credential is held as a hash, a confirmation link
   * goes out, and the account exists once the link comes back.
   */
  async startPasswordSignUp({
    email,
    password,
  }: {
    email: string;
    password: string;
  }): Promise<PasswordSignUpOutcome> {
    if (await this.addressIsRegistered({ email })) {
      return { outcome: "account_exists" };
    }

    await this.issueLink({
      email,
      passwordHash: await this.deps.hashPassword(password),
    });
    return { outcome: "verification_sent" };
  }

  /**
   * Spends a link, and answers the address it confirmed. A link that carried a
   * pending credential also creates the account, which is the whole of what
   * "the link finishes setting it up" means.
   *
   * A token that expired, one that was already spent and one that never
   * existed all raise the same refusal. They are the same thing to the person
   * holding the link — the way on is to ask for a new one — and distinguishing
   * them would turn this into a probe for which links were ever issued.
   */
  async completeVerification({ token }: { token: string }): Promise<{
    email: string;
    accountCreated: boolean;
  }> {
    const claimed = await this.deps.tokens.claim({ token, now: this.now() });
    const pending = claimed ? readPendingSignUp(claimed.identifier) : null;

    if (!pending) {
      throw new IdentityVerificationExpiredError();
    }

    if (!pending.passwordHash) {
      return { email: pending.email, accountCreated: false };
    }

    // Between the link going out and coming back, the address may have gained
    // an account by another door. The link confirms an ADDRESS; it does not
    // entitle it to overwrite whatever now answers for it.
    if (await this.addressIsRegistered({ email: pending.email })) {
      return { email: pending.email, accountCreated: false };
    }

    await this.deps.accounts.createCredentialAccount({
      email: pending.email,
      passwordHash: pending.passwordHash,
    });
    return { email: pending.email, accountCreated: true };
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
  if (!identifier.startsWith(SIGN_UP_TOKEN_NAMESPACE)) return null;

  try {
    const parsed: unknown = JSON.parse(
      identifier.slice(SIGN_UP_TOKEN_NAMESPACE.length),
    );
    if (typeof parsed !== "object" || parsed === null) return null;
    const { email, passwordHash } = parsed as Record<string, unknown>;
    if (typeof email !== "string" || email.length === 0) return null;
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
