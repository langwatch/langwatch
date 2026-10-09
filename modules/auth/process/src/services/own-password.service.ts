/**
 * The password doors (D-A1U-4): auth decides whether a password may be written, user stores it,
 * then auth ends every other session. Spec: modules/auth/specs/account-lifecycle.feature.
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
  UserFederatedPasswordAccountMissingError,
  UserFederatedPasswordChangeUnavailableError,
  UserPasswordAlreadySetError,
  UserPasswordAttemptsThrottledError,
  UserPasswordAuthUnavailableError,
  UserPasswordIncorrectError,
  UserPasswordNotSetError,
} from "@langwatch/user-contract";
import { hash } from "bcrypt";

import { changeTargetsBrokeredPassword } from "../rules/password-change-target.rules.ts";

type PasswordWrites = Pick<
  UserApi,
  "findById" | "hasPassword" | "setFirstPassword" | "rotatePassword"
>;
type PasswordDoors = Pick<
  AuthApi,
  | "resolveAuthProvider"
  | "route"
  | "isWithinBudget"
  | "changeFederatedPassword"
  | "revokeOtherBrowserSessions"
>;

const PASSWORD_BUDGET = { windowSeconds: 60 * 15, max: 5 } as const;
/** The stored format Better Auth's hasher and user's UserPasswordService both write. */
const PASSWORD_HASH_COST = 10;

export class OwnPasswordService {
  private constructor(
    private readonly users: PasswordWrites,
    private readonly auth: PasswordDoors,
    private readonly issuesOwnPasswords: () => boolean,
  ) {}

  static create({
    users,
    auth,
    issuesOwnPasswords,
  }: {
    users: PasswordWrites;
    auth: PasswordDoors;
    issuesOwnPasswords: () => boolean;
  }): OwnPasswordService {
    return new OwnPasswordService(users, auth, issuesOwnPasswords);
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

    const result = await this.users.setFirstPassword({
      id: input.userId,
      passwordHash: await hash(input.password, PASSWORD_HASH_COST),
    });

    if (result === "already_set") throw new UserPasswordAlreadySetError();

    await this.#endOtherSessions(input);
  }

  /** Verifies the current password and replaces it; throttled, as no reauthentication gates it. */
  async change(input: ChangeOwnPasswordInput): Promise<void> {
    if (input.caller.impersonated) throw new ImpersonationCannotChangeCredentialsError();

    const provider = await this.auth.resolveAuthProvider();

    // A denied SSO deployment is coerced to email mode (ADR-027); the current password is
    // demanded, so a recovered credential account may always be changed.
    if (provider !== "email" && provider !== "auth0" && !this.issuesOwnPasswords()) {
      throw new UserPasswordAuthUnavailableError();
    }

    await this.#meter(`user.changePassword:${input.userId}`);

    const holdsOwnPassword = await this.users.hasPassword({ id: input.userId });

    if (changeTargetsBrokeredPassword({ provider, holdsOwnPassword })) {
      await this.#changeFederated(input);
      await this.#endOtherSessions(input);

      return;
    }

    // Verify-and-replace as ONE call to user, so the stored hash never reaches auth.
    const rotation = await this.users.rotatePassword({
      userId: input.userId,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    if (rotation === "no_password") throw new UserPasswordNotSetError();
    if (rotation === "wrong_password") throw new UserPasswordIncorrectError();

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

  async #changeFederated(input: ChangeOwnPasswordInput): Promise<void> {
    const profile = await this.users.findById({ id: input.userId });
    const result = await this.auth.changeFederatedPassword({
      userId: input.userId,
      email: profile?.email ?? null,
      currentPassword: input.currentPassword,
      newPassword: input.newPassword,
    });

    if (result.outcome === "changed") return;
    if (result.outcome === "no_federated_account") {
      throw new UserFederatedPasswordAccountMissingError(input.userId);
    }
    // Nothing the caller sent causes an account with no address, so it is the generic failure.
    if (result.outcome === "no_address_on_record") {
      throw new Error("the authenticated account carries no email address");
    }
    if (result.outcome === "wrong_password") throw new UserPasswordIncorrectError();
    // The provider's policy rejected the NEW password; its wording says what to fix.
    if (result.outcome === "weak_password") throw new ValidationError(result.message);

    throw new UserFederatedPasswordChangeUnavailableError(result.outcome);
  }
}
