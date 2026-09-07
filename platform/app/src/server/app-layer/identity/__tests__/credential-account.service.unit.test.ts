import { describe, expect, it } from "vitest";
import {
  type CredentialAccountRecordsPort,
  CredentialAccountService,
  type PasswordHasherPort,
} from "../credential-account.service";

/**
 * An account's own credentials: opening one, listing and unlinking the ways
 * in, and setting or changing a password.
 *
 * Spec: specs/identity/passkeys.feature, specs/identity/identity-service-layering.feature
 *
 * These rules were spread over the user router, the users module and the
 * sign-up verification runtime, and each of them was tested by mocking a
 * Prisma client — so the assertions were about `account.findFirst` arguments
 * rather than about what the product does. Driven through the ports here: the
 * store is a list of rows in memory, the hasher is a prefix, and every case
 * below is a decision the service takes.
 */

interface AccountRow {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  password: string | null;
}

const accountRow = ({
  id,
  userId = "sam",
  provider = "credential",
  password = null,
}: {
  id: string;
  userId?: string;
  provider?: string;
  password?: string | null;
}): AccountRow => ({
  id,
  userId,
  provider,
  providerAccountId: `${provider}|${id}`,
  password,
});

/**
 * Not bcrypt. What is under test is WHEN a password is hashed and whether a
 * typed one matches what is stored, never how long the hashing takes.
 */
const hasher: PasswordHasherPort = {
  hash: async ({ password }) => `hashed:${password}`,
  matches: async ({ password, hash }) => hash === `hashed:${password}`,
};

const CREATED_ACCOUNT_AT = new Date("2026-09-01T10:00:00.000Z");

/** The rows, the collaborators and everything they were told, in memory. */
const credentialAccountsOver = ({
  accounts = [],
  addressHeldBy = null,
  passkeys = 0,
  twoStepEnabled = false,
  nudgeDismissedAt = null,
  providerAcceptsPassword = true,
  passkeyOutcome = { id: "resumed", created: false },
}: {
  accounts?: readonly AccountRow[];
  addressHeldBy?: string | null;
  passkeys?: number;
  twoStepEnabled?: boolean;
  nudgeDismissedAt?: Date | null;
  providerAcceptsPassword?: boolean;
  passkeyOutcome?: { id: string; created: boolean };
} = {}) => {
  const rows: AccountRow[] = accounts.map((row) => ({ ...row }));
  const askedForAddress: string[] = [];
  const openedAccounts: { name: string; email: string; hash: string }[] = [];
  const attachedIdentifiers: { userId: string; accountId: string }[] = [];
  const revokedFor: { userId: string; keepSessionId: string }[] = [];
  const countedSignUps: string[] = [];
  const askedProvider: { email: string; federatedUserId: string }[] = [];
  let minted = 0;

  const credentialOf = (userId: string) =>
    rows.find((row) => row.userId === userId && row.provider === "credential");

  const records: CredentialAccountRecordsPort = {
    findLinkedAccounts: async ({ userId }) =>
      rows
        .filter((row) => row.userId === userId)
        .map(({ id, provider, providerAccountId }) => ({
          id,
          provider,
          providerAccountId,
        })),
    findCredentialAccount: async ({ userId }) => {
      const row = credentialOf(userId);
      return row ? { id: row.id, passwordHash: row.password } : null;
    },
    updateAccountPassword: async ({ accountId, passwordHash }) => {
      const row = rows.find((candidate) => candidate.id === accountId);
      if (row) row.password = passwordHash;
    },
    createCredentialAccount: async ({ userId, passwordHash }) => {
      rows.push(
        accountRow({
          id: `minted-${++minted}`,
          userId,
          password: passwordHash,
        }),
      );
    },
    findFederatedPasswordAccountId: async ({ userId }) =>
      rows.find((row) => row.userId === userId && row.provider === "auth0")
        ?.providerAccountId ?? null,
    deleteLinkedAccount: async ({ userId, accountId }) => {
      const owned = rows.filter((row) => row.userId === userId);
      if (owned.length <= 1) return "would_strand_user";
      const index = rows.findIndex(
        (row) => row.id === accountId && row.userId === userId,
      );
      if (index < 0) return "no_such_account";
      rows.splice(index, 1);
      return "deleted";
    },
    findSecureAccountFacts: async () => ({
      passkeys,
      twoStepEnabled,
      nudgeDismissedAt,
    }),
    createCredentialUser: async ({ name, email, passwordHash }) => {
      openedAccounts.push({ name, email, hash: passwordHash });
      const account = accountRow({
        id: `minted-${++minted}`,
        userId: "newcomer",
        password: passwordHash,
      });
      rows.push(account);
      return {
        id: "newcomer",
        accountId: account.id,
        accountCreatedAt: CREATED_ACCOUNT_AT,
      };
    },
    createPasskeyUser: async () => passkeyOutcome,
  };

  const service = new CredentialAccountService({
    records,
    directory: {
      findUserIdByEmail: async ({ normalizedValue }) => {
        askedForAddress.push(normalizedValue);
        return addressHeldBy;
      },
    },
    passwords: hasher,
    federated: {
      changePassword: async ({ email, federatedUserId }) => {
        askedProvider.push({ email, federatedUserId });
        return { ok: providerAcceptsPassword };
      },
    },
    identifiers: {
      attachCredentialIdentifier: async ({ userId, accountId }) => {
        attachedIdentifiers.push({ userId, accountId });
      },
    },
    sessions: {
      revokeOthers: async ({ userId, keepSessionId }) => {
        revokedFor.push({ userId, keepSessionId });
      },
    },
    milestones: {
      signedUp: ({ userId }) => countedSignUps.push(userId),
    },
  });

  return {
    service,
    rows,
    askedForAddress,
    openedAccounts,
    attachedIdentifiers,
    revokedFor,
    countedSignUps,
    askedProvider,
  };
};

describe("CredentialAccountService", () => {
  describe("when an account is registered with a password", () => {
    /** @scenario "A capitalised email creates an account sign-in can find" */
    it("asks the directory for the address as it was normalized", async () => {
      const { service, askedForAddress } = credentialAccountsOver();

      await service.register({
        name: "Joel",
        email: "joel.during@example.com",
        password: "correct horse battery staple",
      });

      // The one case-insensitive comparison lives behind this port, so a
      // case-twin beside an existing row is refused there rather than by a
      // second spelling of the rule here.
      expect(askedForAddress).toEqual(["joel.during@example.com"]);
    });

    /** @scenario A rejected registration tracks no PostHog signed_up milestone */
    it("refuses an address somebody already holds, and opens nothing", async () => {
      const { service, openedAccounts, countedSignUps } =
        credentialAccountsOver({ addressHeldBy: "sam" });

      await expect(
        service.register({
          name: "Alice",
          email: "sam@acme.com",
          password: "correct horse battery staple",
        }),
      ).rejects.toMatchObject({ code: "email_already_registered" });

      expect(openedAccounts).toEqual([]);
      expect(countedSignUps).toEqual([]);
    });

    it("stores a hash rather than what was typed", async () => {
      const { service, openedAccounts } = credentialAccountsOver();

      await service.register({
        name: "Sam",
        email: "sam@acme.com",
        password: "correct horse battery staple",
      });

      expect(openedAccounts[0]?.hash).toBe(
        "hashed:correct horse battery staple",
      );
    });

    it("writes the address as the name nobody has been asked for", async () => {
      const { service, openedAccounts } = credentialAccountsOver();

      await service.register({
        name: null,
        email: "sam@acme.com",
        password: "correct horse battery staple",
      });

      expect(openedAccounts[0]?.name).toBe("sam@acme.com");
    });

    it("states the credential identifier from the row it just wrote", async () => {
      const { service, attachedIdentifiers } = credentialAccountsOver();

      await service.register({
        name: "Sam",
        email: "sam@acme.com",
        password: "correct horse battery staple",
      });

      // The front door routes on the identifier projection, and the backfill
      // links by `Account.id` — so an identifier stated against anything but
      // this row is a second projection row for one credential.
      expect(attachedIdentifiers).toEqual([
        { userId: "newcomer", accountId: "minted-1" },
      ]);
    });

    /** @scenario Email-mode registration tracks the PostHog signed_up milestone exactly once */
    it("counts the sign-up once", async () => {
      const { service, countedSignUps } = credentialAccountsOver();

      await service.register({
        name: "Sam",
        email: "sam@acme.com",
        password: "correct horse battery staple",
      });

      expect(countedSignUps).toEqual(["newcomer"]);
    });
  });

  describe("when a passkey ceremony opens an account", () => {
    it("counts a sign-up for an account it created", async () => {
      const { service, countedSignUps } = credentialAccountsOver({
        passkeyOutcome: { id: "newcomer", created: true },
      });

      await expect(
        service.openPasskeyAccount({ email: "sam@acme.com" }),
      ).resolves.toEqual({ id: "newcomer", created: true });
      expect(countedSignUps).toEqual(["newcomer"]);
    });

    it("counts nothing for an unfinished attempt it resumed", async () => {
      const { service, countedSignUps } = credentialAccountsOver({
        passkeyOutcome: { id: "resumed", created: false },
      });

      // Somebody who needed two attempts is one sign-up, not two.
      await service.openPasskeyAccount({ email: "sam@acme.com" });

      expect(countedSignUps).toEqual([]);
    });
  });

  describe("when a first password is set", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty credential row rather than asking for a current password", async () => {
      const { service, rows } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1" })],
      });

      await expect(
        service.setFirstPassword({
          userId: "sam",
          password: "a-good-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("set");

      expect(rows[0]?.password).toBe("hashed:a-good-password");
    });

    it("creates the credential row an older account was never given", async () => {
      const { service, rows } = credentialAccountsOver();

      await service.setFirstPassword({
        userId: "sam",
        password: "a-good-password",
        keepSessionId: "sess-1",
      });

      // The row is what password reset updates in place, so recovery cannot
      // work until it exists.
      expect(rows).toEqual([
        expect.objectContaining({
          userId: "sam",
          provider: "credential",
          password: "hashed:a-good-password",
        }),
      ]);
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, because a password outlives revoking one", async () => {
      const { service, revokedFor } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1" })],
      });

      await service.setFirstPassword({
        userId: "sam",
        password: "a-good-password",
        keepSessionId: "sess-1",
      });

      expect(revokedFor).toEqual([{ userId: "sam", keepSessionId: "sess-1" }]);
    });

    it("ends nothing where there is no session to spare", async () => {
      const { service, revokedFor } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1" })],
      });

      // What an impersonated request carries: the operator's own session id,
      // withheld by the boundary. Ending "every other session" of the subject
      // would sign the subject out and leave the operator in.
      await service.setFirstPassword({
        userId: "sam",
        password: "a-good-password",
        keepSessionId: null,
      });

      expect(revokedFor).toEqual([]);
    });

    /** @scenario Setting a password can never overwrite one */
    it("refuses an account that already has a password, and writes nothing", async () => {
      const { service, rows, revokedFor } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1", password: "hashed:old" })],
      });

      await expect(
        service.setFirstPassword({
          userId: "sam",
          password: "a-good-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("already_has_password");

      expect(rows[0]?.password).toBe("hashed:old");
      expect(revokedFor).toEqual([]);
    });
  });

  describe("when a password held here is changed", () => {
    it("answers that no password is set for an account that has none", async () => {
      const { service } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1" })],
      });

      await expect(
        service.changePassword({
          userId: "sam",
          currentPassword: "old-password",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("no_password_set");
    });

    it("refuses a current password that does not match, and writes nothing", async () => {
      const { service, rows, revokedFor } = credentialAccountsOver({
        accounts: [
          accountRow({ id: "acc-1", password: "hashed:the-real-password" }),
        ],
      });

      await expect(
        service.changePassword({
          userId: "sam",
          currentPassword: "a-guess",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("wrong_password");

      expect(rows[0]?.password).toBe("hashed:the-real-password");
      expect(revokedFor).toEqual([]);
    });

    it("writes the new hash and ends every other session", async () => {
      const { service, rows, revokedFor } = credentialAccountsOver({
        accounts: [
          accountRow({ id: "acc-1", password: "hashed:the-real-password" }),
        ],
      });

      await expect(
        service.changePassword({
          userId: "sam",
          currentPassword: "the-real-password",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("changed");

      expect(rows[0]?.password).toBe("hashed:new-password");
      expect(revokedFor).toEqual([{ userId: "sam", keepSessionId: "sess-1" }]);
    });
  });

  describe("when a password the identity provider holds is changed", () => {
    const federatedAccount = accountRow({ id: "auth0-1", provider: "auth0" });

    it("answers that there is no federated account where only social identities are linked", async () => {
      const { service, askedProvider } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1", provider: "google" })],
      });

      await expect(
        service.changeFederatedPassword({
          userId: "sam",
          email: "sam@acme.com",
          currentPassword: "old-password",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("no_federated_account");

      // Their upstream provider owns those credentials; asking to change one
      // fails there rather than here.
      expect(askedProvider).toEqual([]);
    });

    it("answers that there is no address on record where the caller carries none", async () => {
      const { service, askedProvider } = credentialAccountsOver({
        accounts: [federatedAccount],
      });

      await expect(
        service.changeFederatedPassword({
          userId: "sam",
          email: null,
          currentPassword: "old-password",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("no_address_on_record");

      expect(askedProvider).toEqual([]);
    });

    it("reports a current password the provider refused, and ends no session", async () => {
      const { service, revokedFor } = credentialAccountsOver({
        accounts: [federatedAccount],
        providerAcceptsPassword: false,
      });

      await expect(
        service.changeFederatedPassword({
          userId: "sam",
          email: "sam@acme.com",
          currentPassword: "a-guess",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("wrong_password");

      expect(revokedFor).toEqual([]);
    });

    it("ends every other session once the provider has accepted", async () => {
      const { service, revokedFor, askedProvider } = credentialAccountsOver({
        accounts: [federatedAccount],
      });

      await expect(
        service.changeFederatedPassword({
          userId: "sam",
          email: "sam@acme.com",
          currentPassword: "old-password",
          newPassword: "new-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBe("changed");

      // The provider's own sessions are its business; the LangWatch session
      // is a row of ours its password change does not touch.
      expect(askedProvider).toEqual([
        { email: "sam@acme.com", federatedUserId: "auth0|auth0-1" },
      ]);
      expect(revokedFor).toEqual([{ userId: "sam", keepSessionId: "sess-1" }]);
    });
  });

  describe("when a linked account is unlinked", () => {
    it("refuses to remove the last way in", async () => {
      const { service, rows } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1", password: "hashed:only" })],
      });

      await expect(
        service.unlinkAccount({ userId: "sam", accountId: "acc-1" }),
      ).rejects.toMatchObject({ code: "identity_detach_strands_user" });

      expect(rows).toHaveLength(1);
    });

    it("answers that there is no such account for one that is not theirs", async () => {
      const { service } = credentialAccountsOver({
        accounts: [
          accountRow({ id: "acc-1" }),
          accountRow({ id: "acc-2", provider: "google" }),
        ],
      });

      await expect(
        service.unlinkAccount({ userId: "sam", accountId: "somebody-elses" }),
      ).resolves.toBe("no_such_account");
    });

    it("removes one of several", async () => {
      const { service, rows } = credentialAccountsOver({
        accounts: [
          accountRow({ id: "acc-1" }),
          accountRow({ id: "acc-2", provider: "google" }),
        ],
      });

      await expect(
        service.unlinkAccount({ userId: "sam", accountId: "acc-2" }),
      ).resolves.toBe("deleted");

      expect(rows.map((row) => row.id)).toEqual(["acc-1"]);
    });

    it("lists every way in this person has linked", async () => {
      const { service } = credentialAccountsOver({
        accounts: [
          accountRow({ id: "acc-1" }),
          accountRow({ id: "acc-2", provider: "google" }),
          accountRow({ id: "acc-3", userId: "someone-else" }),
        ],
      });

      await expect(service.linkedAccounts({ userId: "sam" })).resolves.toEqual([
        expect.objectContaining({ id: "acc-1", provider: "credential" }),
        expect.objectContaining({ id: "acc-2", provider: "google" }),
      ]);
    });
  });

  describe("when the account is asked whether it holds a password", () => {
    it("reads a credential row with no password as no password", async () => {
      // What a passkey sign-up leaves behind: a row for recovery to land on,
      // which authenticates nobody.
      const { service } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1" })],
      });

      await expect(service.hasPassword({ userId: "sam" })).resolves.toBe(false);
    });

    it("reads a credential row holding one as a password", async () => {
      const { service } = credentialAccountsOver({
        accounts: [accountRow({ id: "acc-1", password: "hashed:something" })],
      });

      await expect(service.hasPassword({ userId: "sam" })).resolves.toBe(true);
    });
  });
});
