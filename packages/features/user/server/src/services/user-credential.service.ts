import type { UserPasswordHasherPort } from "../ports/user.port";
import type {
  UnlinkUserAccountOutcome,
  UserCredentialRepository,
  UserLinkedAccount,
} from "../repositories/user-credential.repository";

/**
 * What a password rotation did, or why it did nothing.
 *
 * Three outcomes rather than three exceptions, because the transport owes the
 * reader a different sentence for each and the service owes the transport no
 * opinion about status codes. `no_password` is a person whose only sign-in
 * method never had one — a passkey-first account — and is NOT the same answer
 * as `wrong_password`, which is somebody who typed the current one incorrectly.
 */
export type UserPasswordRotationOutcome = "rotated" | "no_password" | "wrong_password";

/**
 * The credential half of a person's account: the password they sign in with,
 * and the list of methods they hold.
 *
 * A service of its own beside {@link UserService}, and the boundary it draws is
 * the point. **The stored hash never leaves it.** It reads one, compares it
 * through the deployment's hasher, writes the replacement, and returns a word.
 * Nothing above this class — not the tRPC transport, not the process
 * composition that builds it — is handed a reader that answers with
 * `Account.password`, which is what the API process's own composition used to
 * do.
 *
 * The three account reads beside the rotation live here for the same reason
 * rather than a different one: they are reads of the same table, and leaving
 * them in a composition would keep a `where` on the credential rows written
 * where no rule about them applies.
 */
export class UserCredentialService {
  private constructor(
    private readonly repository: UserCredentialRepository,
    private readonly passwords: UserPasswordHasherPort,
  ) {}

  static create(options: {
    repository: UserCredentialRepository;
    passwords: UserPasswordHasherPort;
  }): UserCredentialService {
    return new UserCredentialService(options.repository, options.passwords);
  }

  /**
   * Verifies the current password and replaces it, in that order.
   *
   * The verification is not a courtesy: a stolen session is enough to reach
   * this call, and the current password is the one thing the thief does not
   * have. It is why the rotation cannot be split into a "check" the caller
   * makes and a "write" it makes afterwards — a caller holding both halves
   * could skip the first.
   */
  async rotatePassword(input: {
    userId: string;
    currentPassword: string;
    newPassword: string;
  }): Promise<UserPasswordRotationOutcome> {
    const account = await this.repository.tryFindCredentialAccount({ userId: input.userId });
    if (!account?.passwordHash) return "no_password";

    const matches = await this.passwords.matches({
      password: input.currentPassword,
      hash: account.passwordHash,
    });
    if (!matches) return "wrong_password";

    await this.repository.writePasswordHash({
      accountId: account.id,
      passwordHash: await this.passwords.hash({ password: input.newPassword }),
    });
    return "rotated";
  }

  /**
   * The Auth0 database identity whose password the deployment's Auth0 tenant
   * can change, or null when this person only holds social identities Auth0
   * federates for somebody else.
   */
  tryFindAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null> {
    return this.repository.tryFindAuth0DatabaseAccount({ userId: input.userId });
  }

  /** Every sign-in method this person holds. */
  listLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]> {
    return this.repository.findLinkedAccounts({ userId: input.userId });
  }

  /** Removes one sign-in method, refusing to remove the last one. */
  unlinkAccount(input: { userId: string; accountId: string }): Promise<UnlinkUserAccountOutcome> {
    return this.repository.unlinkAccount(input);
  }
}
