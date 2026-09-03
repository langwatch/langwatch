/**
 * The one class in the deployment that ever holds a stored password hash.
 *
 * Everything here is about the boundary rather than about bcrypt: the service
 * reads a hash, compares it, writes a replacement, and answers with a word.
 * The transport above it — and the process composition that used to issue both
 * halves as `prisma.account` statements of its own — never sees the column.
 */
import { describe, expect, it, vi } from "vitest";
import { UserPasswordHasherPort } from "../../ports/user.port";
import {
  type UnlinkUserAccountOutcome,
  type UserCredentialAccount,
  UserCredentialRepository,
  type UserLinkedAccount,
} from "../../repositories/user-credential.repository";
import { UserCredentialService } from "../user-credential.service";

const USER_ID = "user-1";
const ACCOUNT_ID = "account-credential";
const CURRENT_PASSWORD = "the-current-one";
const NEW_PASSWORD = "the-next-one";
const STORED_HASH = `hashed:${CURRENT_PASSWORD}`;

/** A reversible stand-in for bcrypt, so a hash is recognisable in assertions. */
class TestPasswordHasher extends UserPasswordHasherPort {
  async hash({ password }: { password: string }): Promise<string> {
    return `hashed:${password}`;
  }

  async matches({ password, hash }: { password: string; hash: string }): Promise<boolean> {
    return hash === `hashed:${password}`;
  }
}

class FakeCredentialRepository extends UserCredentialRepository {
  constructor(private account: UserCredentialAccount | null) {
    super();
  }

  readonly writes: Array<{ accountId: string; passwordHash: string }> = [];

  tryFindCredentialAccount = vi.fn(async (): Promise<UserCredentialAccount | null> => this.account);

  writePasswordHash = vi.fn(async (input: { accountId: string; passwordHash: string }) => {
    this.writes.push(input);
  });

  tryFindAuth0DatabaseAccount = vi.fn(async (): Promise<{ providerAccountId: string } | null> => ({
    providerAccountId: "auth0|abc123",
  }));

  findLinkedAccounts = vi.fn(async (): Promise<UserLinkedAccount[]> => [
    { id: ACCOUNT_ID, provider: "credential", providerAccountId: USER_ID },
  ]);

  unlinkAccount = vi.fn(async (): Promise<UnlinkUserAccountOutcome> => "unlinked");
}

function composeService(account: UserCredentialAccount | null) {
  const repository = new FakeCredentialRepository(account);
  const service = UserCredentialService.create({
    repository,
    passwords: new TestPasswordHasher(),
  });
  return { service, repository };
}

describe("given a person who holds a credential sign-in method", () => {
  describe("when they submit the correct current password", () => {
    it("stores the new password in the deployment's own format", async () => {
      const { service, repository } = composeService({
        id: ACCOUNT_ID,
        passwordHash: STORED_HASH,
      });

      const outcome = await service.rotatePassword({
        userId: USER_ID,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(outcome).toBe("rotated");
      expect(repository.writes).toEqual([
        { accountId: ACCOUNT_ID, passwordHash: `hashed:${NEW_PASSWORD}` },
      ]);
    });

    it("answers with a word, never with what it read", async () => {
      const { service } = composeService({ id: ACCOUNT_ID, passwordHash: STORED_HASH });

      const outcome = await service.rotatePassword({
        userId: USER_ID,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(JSON.stringify(outcome)).not.toContain("hashed:");
    });
  });

  describe("when they submit the wrong current password", () => {
    it("refuses and leaves the stored password where it was", async () => {
      const { service, repository } = composeService({
        id: ACCOUNT_ID,
        passwordHash: STORED_HASH,
      });

      const outcome = await service.rotatePassword({
        userId: USER_ID,
        currentPassword: "something-else",
        newPassword: NEW_PASSWORD,
      });

      expect(outcome).toBe("wrong_password");
      expect(repository.writes).toEqual([]);
    });
  });
});

describe("given a person who holds no password at all", () => {
  describe("when the account exists but was created for a passkey", () => {
    it("reports the absence rather than the refusal a wrong password gets", async () => {
      const { service, repository } = composeService({ id: ACCOUNT_ID, passwordHash: null });

      const outcome = await service.rotatePassword({
        userId: USER_ID,
        currentPassword: CURRENT_PASSWORD,
        newPassword: NEW_PASSWORD,
      });

      expect(outcome).toBe("no_password");
      expect(repository.writes).toEqual([]);
    });
  });

  describe("when there is no credential account at all", () => {
    it("reports the same absence without comparing anything", async () => {
      const { service, repository } = composeService(null);

      await expect(
        service.rotatePassword({
          userId: USER_ID,
          currentPassword: CURRENT_PASSWORD,
          newPassword: NEW_PASSWORD,
        }),
      ).resolves.toBe("no_password");
      expect(repository.writePasswordHash).not.toHaveBeenCalled();
    });
  });
});
