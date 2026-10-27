/**
 * The password doors (D-A1U-4): auth decides whether a password may be written, Better Auth's own
 * account storage stores it, then auth ends every other session.
 * Spec: modules/auth/specs/account-lifecycle.feature.
 */
import type { AuthApi } from "@langwatch/auth-contract";
import { ValidationError } from "@langwatch/handled-error";
import {
  describePasswordProblem,
  routesToOrganizationConnection,
} from "@langwatch/identity-contract";
import {
  type ChangeOwnPasswordInput,
  ImpersonationCannotChangeCredentialsError,
  type SetOwnFirstPasswordInput,
  type UserApi,
  UserPasswordAlreadySetError,
  UserPasswordAttemptsThrottledError,
  UserPasswordAuthUnavailableError,
  UserPasswordIncorrectError,
  UserPasswordNotSetError,
} from "@langwatch/user-contract";

type PasswordReads = Pick<UserApi, "findById">;

/**
 * Better Auth's own account storage: its adapter routes a user moved onto the identity branch to
 * `AccountCredential`, where sign-in reads (ADR-116), and mirrors the legacy `Account` row.
 */
export interface CredentialAccounts {
  /** The local password account, with its hash; null where the person holds none. */
  findCredential(input: {
    userId: string;
  }): Promise<{ id: string; passwordHash: string | null } | null>;
  /** Every sign-in account this person holds, by id. */
  listAccountIds(input: { userId: string }): Promise<string[]>;
  writePassword(input: { accountId: string; passwordHash: string }): Promise<void>;
  /** A new local password account, for somebody who holds none. */
  linkPassword(input: { userId: string; passwordHash: string }): Promise<void>;
  deleteAccount(input: { accountId: string }): Promise<void>;
  hashPassword(input: { password: string }): Promise<string>;
  passwordMatches(input: { password: string; hash: string }): Promise<boolean>;
}
/** The forced-reset mark a newly written password lifts
 *  (modules/auth/specs/forced-password-reset.feature). */
export interface PasswordResetMarks {
  clearPasswordResetRequirement(input: { userId: string }): Promise<void>;
}
type PasswordDoors = Pick<
  AuthApi,
  "resolveAuthProvider" | "route" | "isWithinBudget" | "revokeOtherBrowserSessions"
>;

const PASSWORD_BUDGET = { windowSeconds: 60 * 15, max: 5 } as const;

export class OwnPasswordService {
  private readonly users: PasswordReads;
  private readonly credentials: CredentialAccounts;
  private readonly auth: PasswordDoors;
  private readonly issuesOwnPasswords: () => boolean;
  private readonly passwordResetMarks: PasswordResetMarks;

  private constructor(deps: {
    users: PasswordReads;
    credentials: CredentialAccounts;
    auth: PasswordDoors;
    issuesOwnPasswords: () => boolean;
    passwordResetMarks: PasswordResetMarks;
  }) {
    this.users = deps.users;
    this.credentials = deps.credentials;
    this.auth = deps.auth;
    this.issuesOwnPasswords = deps.issuesOwnPasswords;
    this.passwordResetMarks = deps.passwordResetMarks;
  }

  static create(deps: {
    users: PasswordReads;
    credentials: CredentialAccounts;
    auth: PasswordDoors;
    issuesOwnPasswords: () => boolean;
    passwordResetMarks: PasswordResetMarks;
  }): OwnPasswordService {
    return new OwnPasswordService(deps);
  }

  /** Fills an empty credential slot. Never while impersonating: the account is the subject's. */
  async setFirst(input: SetOwnFirstPasswordInput): Promise<void> {
    if (input.caller.impersonated) throw new ImpersonationCannotChangeCredentialsError();

    const problem = describePasswordProblem(input.password);

    if (problem) {
      throw new ValidationError(problem, { meta: { fieldErrors: { password: [problem] } } });
    }

    // Under a broker the password lives in its tenant unless this deployment issues its own
    // (D09); an address an organization routes through its own provider never takes one.
    const emailMode = (await this.auth.resolveAuthProvider()) === "email";

    if (!emailMode && !this.issuesOwnPasswords()) throw new UserPasswordAuthUnavailableError();

    const address = (await this.users.findById({ id: input.userId }))?.email;

    if (address && (await this.#routesToConnection(address))) {
      throw new UserPasswordAuthUnavailableError();
    }

    await this.#meter(`user.setPassword:${input.userId}`);

    const credential = await this.credentials.findCredential({ userId: input.userId });

    if (credential?.passwordHash) throw new UserPasswordAlreadySetError();

    const passwordHash = await this.credentials.hashPassword({ password: input.password });

    if (credential) {
      await this.credentials.writePassword({ accountId: credential.id, passwordHash });
    } else {
      await this.credentials.linkPassword({ userId: input.userId, passwordHash });
    }

    await this.passwordResetMarks.clearPasswordResetRequirement({ userId: input.userId });
    await this.#endOtherSessions(input);
  }

  /** Verifies the current password and replaces it; throttled, as no reauthentication gates it. */
  async change(input: ChangeOwnPasswordInput): Promise<void> {
    if (input.caller.impersonated) throw new ImpersonationCannotChangeCredentialsError();

    const provider = await this.auth.resolveAuthProvider();

    // A denied SSO deployment is coerced to email mode (ADR-027); the current password is
    // demanded, so a recovered credential account may always be changed. An Auth0 user's
    // password was imported into our own rows (D10), so it changes here like any other.
    if (provider !== "email" && provider !== "auth0" && !this.issuesOwnPasswords()) {
      throw new UserPasswordAuthUnavailableError();
    }

    await this.#meter(`user.changePassword:${input.userId}`);

    const credential = await this.credentials.findCredential({ userId: input.userId });

    if (!credential?.passwordHash) throw new UserPasswordNotSetError();

    const proven = await this.credentials.passwordMatches({
      password: input.currentPassword,
      hash: credential.passwordHash,
    });

    if (!proven) throw new UserPasswordIncorrectError();

    await this.credentials.writePassword({
      accountId: credential.id,
      passwordHash: await this.credentials.hashPassword({ password: input.newPassword }),
    });

    await this.passwordResetMarks.clearPasswordResetRequirement({ userId: input.userId });
    await this.#endOtherSessions(input);
  }

  /** Left to throw: for an address a company signs in, "could not tell" is no password. */
  async #routesToConnection(email: string): Promise<boolean> {
    return routesToOrganizationConnection(
      await this.auth.route({ identifier: email, breakGlass: false }),
    );
  }

  async #meter(key: string): Promise<void> {
    const allowance = await this.auth.isWithinBudget({ key, ...PASSWORD_BUDGET });

    if (!allowance.allowed) throw new UserPasswordAttemptsThrottledError();
  }

  /** A credential write ends every session but the one that made it. */
  async #endOtherSessions(input: { userId: string; keepSessionId: string | null }): Promise<void> {
    if (!input.keepSessionId) return;

    await this.auth.revokeOtherBrowserSessions({
      userId: input.userId,
      keepSessionId: input.keepSessionId,
    });
  }
}
