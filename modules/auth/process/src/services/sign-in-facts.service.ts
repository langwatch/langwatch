import {
  lockoutVerdict,
  signInIdentifierKey,
  type SignInFacts,
  type SignInFactsMethod,
} from "@langwatch/auth-contract";
import type { Instant } from "@langwatch/time";
import type { UserApi } from "@langwatch/user-contract";

import type { PasskeyRepository } from "../repositories/passkey.repository.ts";
import type { SignInAttemptLockRepository } from "../repositories/sign-in-attempt-lock.repository.ts";

interface SignInFactsDeps {
  users: Pick<UserApi, "findSignInAccounts">;
  passkeys: Pick<PasskeyRepository, "findForUser">;
  locks: Pick<SignInAttemptLockRepository, "findState">;
  /** Null where the deployment names no session secret: no sign-in, so no lock, can exist. */
  hashIdentifier: ((key: string) => string) | null;
  now: () => Instant;
}

/** The accounts behind one address, with auth's own passkeys and lock added (ADR-202). */
export class SignInFactsService {
  static create(deps: SignInFactsDeps): SignInFactsService {
    return new SignInFactsService(deps);
  }

  private constructor(private readonly deps: SignInFactsDeps) {}

  async findByEmail({ email }: Readonly<{ email: string }>): Promise<SignInFacts[]> {
    const accounts = await this.deps.users.findSignInAccounts({ email });
    if (accounts.length === 0) return [];
    const locked = await this.isLocked(email);
    return Promise.all(
      accounts.map(async (account) => {
        const passkeys = (await this.deps.passkeys.findForUser({ userId: account.userId })).length;
        const methods: SignInFactsMethod[] =
          passkeys > 0 ? [...account.methods, "passkey"] : [...account.methods];
        return { ...account, methods, passkeys, locked };
      }),
    );
  }

  /** The lock is keyed on the typed address, so every account behind it shares one answer. */
  private async isLocked(email: string): Promise<boolean> {
    if (!this.deps.hashIdentifier) return false;
    const state = await this.deps.locks.findState({
      identifierHash: this.deps.hashIdentifier(signInIdentifierKey(email)),
    });
    return lockoutVerdict({ state, now: this.deps.now() }).locked;
  }
}
