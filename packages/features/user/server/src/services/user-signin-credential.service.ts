import type {
  RotateUserPasswordInput,
  UnlinkUserAccountInput,
  UnlinkUserAccountOutcome,
  UserLinkedAccount,
  UserPasswordRotationOutcome,
} from "@langwatch/user-contract";
import type { UserPasswordHasherPort } from "../ports/user.port.ts";
import type { UserCredentialRepository } from "../repositories/user-signin-credential.repository.ts";

/**
 * The credential half of a person's account: the password they sign in with, and the list of
 * methods they hold. A service of its own beside {@link UserService}, and the boundary it draws
 * is the point.
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
   * Verifies the current password and replaces it, in that order. The verification is not a
   * courtesy: a stolen session is enough to reach this call, and the current password is the
   * one thing the thief does not have.
   */
  async rotatePassword(input: RotateUserPasswordInput): Promise<UserPasswordRotationOutcome> {
    const account = await this.repository.findCredentialAccount({ userId: input.userId });
    if (!account?.passwordHash) {
      return "no_password";
    }

    const matches = await this.passwords.matches({
      password: input.currentPassword,
      hash: account.passwordHash,
    });
    if (!matches) {
      return "wrong_password";
    }

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
  findAuth0DatabaseAccount(input: {
    userId: string;
  }): Promise<{ providerAccountId: string } | null> {
    return this.repository.findAuth0DatabaseAccount({ userId: input.userId });
  }

  /** Every sign-in method this person holds. */
  listLinkedAccounts(input: { userId: string }): Promise<UserLinkedAccount[]> {
    return this.repository.findLinkedAccounts({ userId: input.userId });
  }

  /** Removes one sign-in method, refusing to remove the last one. */
  unlinkAccount(input: UnlinkUserAccountInput): Promise<UnlinkUserAccountOutcome> {
    return this.repository.unlinkAccount(input);
  }
}
