import {
  userEmailInputSchema,
  type UserProfile,
  type UserSignInAccount,
} from "@langwatch/user-contract";

import type { UserCredentialRepository } from "../repositories/user-signin-credential.repository.ts";
import type { UserRepository } from "../repositories/user.repository.ts";
import { signInMethodsOf } from "../rules/user-sign-in-method.rules.ts";

/** The accounts behind one address, as ids, method codes, flags and times (ADR-202). */
export class UserSignInAccountService {
  static create(options: {
    users: Pick<UserRepository, "findByEmail" | "findByEmailAnyCase" | "findPasskeyNudgeStatus">;
    credentials: Pick<UserCredentialRepository, "findLinkedAccounts">;
  }): UserSignInAccountService {
    return new UserSignInAccountService(options);
  }

  private constructor(
    private readonly options: {
      users: Pick<UserRepository, "findByEmail" | "findByEmailAnyCase" | "findPasskeyNudgeStatus">;
      credentials: Pick<UserCredentialRepository, "findLinkedAccounts">;
    },
  ) {}

  /** The exact lower-cased match, else rows stored before lower-casing: how sign-in finds them. */
  async findByEmail(input: Readonly<{ email: string }>): Promise<UserSignInAccount[]> {
    const parsed = userEmailInputSchema.safeParse({ email: input.email });
    if (!parsed.success) return [];
    const exact = await this.options.users.findByEmail(parsed.data.email);
    const accounts =
      exact.length > 0 ? exact : await this.options.users.findByEmailAnyCase(parsed.data.email);
    return Promise.all(accounts.map((account) => this.#factsOf(account)));
  }

  async #factsOf(account: UserProfile): Promise<UserSignInAccount> {
    const [linked, standing] = await Promise.all([
      this.options.credentials.findLinkedAccounts({ userId: account.id }),
      this.options.users.findPasskeyNudgeStatus(account.id),
    ]);
    return {
      userId: account.id,
      createdAt: account.createdAt.getTime(),
      lastSignInAt: account.lastLoginAt?.getTime() ?? null,
      methods: signInMethodsOf(linked.map(({ provider }) => provider)),
      twoStepEnabled: standing.twoStepEnabled,
      deactivated: account.deactivatedAt !== null,
    };
  }
}
