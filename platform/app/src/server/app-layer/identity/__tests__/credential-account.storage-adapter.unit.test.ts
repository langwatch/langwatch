import { IdentityDetachStrandsUserError } from "@langwatch/identity";
import {
  type IdentityAccountCeremonies,
  type IdentityAccountRow,
  type IdentityAccountsPort,
  IdentityAccountWriter,
} from "@langwatch/identity-server/better-auth";
import { describe, expect, it } from "vitest";
import {
  type CredentialAccountRecordsPort,
  CredentialAccountService,
} from "../credential-account.service";
import { CredentialAccountStorageAdapter } from "../credential-account.storage-adapter";

interface LegacyAccount {
  id: string;
  userId: string;
  provider: string;
  providerAccountId: string;
  password: string | null;
}

interface IdentityLink {
  id: string;
  userId: string;
  providerId: string;
  providerAccountId: string;
}

const NOW = new Date("2026-09-07T12:00:00.000Z");

const account = ({
  id,
  provider = "credential",
  password = null,
}: {
  id: string;
  provider?: string;
  password?: string | null;
}): LegacyAccount => ({
  id,
  userId: "sam",
  provider,
  providerAccountId: provider === "credential" ? "sam" : `${provider}-sub`,
  password,
});

const identityLink = ({
  id,
  providerId = "credential",
}: {
  id: string;
  providerId?: string;
}): IdentityLink => ({
  id,
  userId: "sam",
  providerId,
  providerAccountId: providerId === "credential" ? "sam" : `${providerId}-sub`,
});

const credentialServiceOver = ({
  latched,
  legacyAccounts,
  identityLinks,
  identityPasswords,
}: {
  latched: boolean;
  legacyAccounts: LegacyAccount[];
  identityLinks: IdentityLink[];
  identityPasswords: Map<string, string | null>;
}) => {
  const legacyCalls: string[] = [];
  const canonicalCalls: string[] = [];

  const legacy: CredentialAccountRecordsPort = {
    findLinkedAccounts: async ({ userId }) => {
      legacyCalls.push("findLinkedAccounts");
      return legacyAccounts.filter((row) => row.userId === userId);
    },
    findCredentialAccount: async ({ userId }) => {
      legacyCalls.push("findCredentialAccount");
      const row = legacyAccounts.find(
        (candidate) =>
          candidate.userId === userId && candidate.provider === "credential",
      );
      return row ? { id: row.id, passwordHash: row.password } : null;
    },
    updateAccountPassword: async ({ accountId, passwordHash }) => {
      legacyCalls.push("updateAccountPassword");
      const row = legacyAccounts.find(
        (candidate) => candidate.id === accountId,
      );
      if (row) row.password = passwordHash;
    },
    createCredentialAccount: async ({ userId, passwordHash }) => {
      legacyCalls.push("createCredentialAccount");
      legacyAccounts.push({
        id: "legacy-created",
        userId,
        provider: "credential",
        providerAccountId: userId,
        password: passwordHash,
      });
    },
    findFederatedPasswordAccountId: async () => null,
    deleteLinkedAccount: async ({ userId, accountId }) => {
      legacyCalls.push("deleteLinkedAccount");
      const owned = legacyAccounts.filter((row) => row.userId === userId);
      if (owned.length <= 1) return "would_strand_user";
      const index = legacyAccounts.findIndex(
        (row) => row.userId === userId && row.id === accountId,
      );
      if (index < 0) return "no_such_account";
      legacyAccounts.splice(index, 1);
      return "deleted";
    },
    findSecureAccountFacts: async () => ({
      passkeys: 0,
      twoStepEnabled: false,
      nudgeDismissedAt: null,
    }),
    createCredentialUser: async () => ({
      id: "new-user",
      accountId: "new-account",
      accountCreatedAt: NOW,
    }),
    createPasskeyUser: async () => ({ id: "new-user", created: true }),
  };

  const assemble = (link: IdentityLink): IdentityAccountRow => ({
    id: link.id,
    userId: link.userId,
    providerId: link.providerId,
    issuer: `local:${link.providerId}`,
    accountId: link.providerAccountId,
    password: identityPasswords.get(link.id) ?? null,
    accessToken: null,
    refreshToken: null,
    idToken: null,
    accessTokenExpiresAt: null,
    refreshTokenExpiresAt: null,
    scope: null,
    createdAt: NOW,
    updatedAt: NOW,
  });

  const identityAccounts: IdentityAccountsPort = {
    findByUser: async ({ userId }) =>
      identityLinks.filter((row) => row.userId === userId).map(assemble),
    findByAccountIds: async ({ accountIds }) =>
      identityLinks.filter((row) => accountIds.includes(row.id)).map(assemble),
    findByProviderSubject: async ({
      userId,
      providerId,
      providerAccountId,
    }) => {
      const row = identityLinks.find(
        (candidate) =>
          candidate.userId === userId &&
          candidate.providerId === providerId &&
          candidate.providerAccountId === providerAccountId,
      );
      return row ? assemble(row) : null;
    },
    createCredential: async ({ accountId, userId, providerId, secrets }) => {
      canonicalCalls.push("createCredential");
      if (!identityLinks.some((row) => row.id === accountId)) {
        identityLinks.push({
          id: accountId,
          userId,
          providerId,
          providerAccountId: userId,
        });
      }
      identityPasswords.set(accountId, secrets.password ?? null);
    },
    updateCredentials: async ({ accountIds, secrets }) => {
      canonicalCalls.push("updateCredentials");
      for (const accountId of accountIds) {
        if ("password" in secrets) {
          identityPasswords.set(accountId, secrets.password ?? null);
        }
      }
    },
    deleteCredentials: async ({ accountIds }) => {
      canonicalCalls.push("deleteCredentials");
      let deleted = 0;
      for (const accountId of accountIds) {
        if (identityPasswords.delete(accountId)) deleted += 1;
      }
      return deleted;
    },
    mirrorSecretsOntoAccounts: async ({ accountIds, secrets }) => {
      canonicalCalls.push("mirrorSecretsOntoAccounts");
      for (const row of legacyAccounts) {
        if (accountIds.includes(row.id) && "password" in secrets) {
          row.password = secrets.password ?? null;
        }
      }
    },
    deleteBridgeAccounts: async ({ accountIds }) => {
      canonicalCalls.push("deleteBridgeAccounts");
      let deleted = 0;
      for (let index = legacyAccounts.length - 1; index >= 0; index -= 1) {
        if (accountIds.includes(legacyAccounts[index]?.id ?? "")) {
          legacyAccounts.splice(index, 1);
          deleted += 1;
        }
      }
      return deleted;
    },
  };

  const ceremonies: IdentityAccountCeremonies = {
    beforeAccountCreate: async (row) => {
      canonicalCalls.push("beforeAccountCreate");
      if (
        typeof row.id !== "string" ||
        typeof row.userId !== "string" ||
        typeof row.providerId !== "string"
      ) {
        return undefined;
      }
      identityLinks.push({
        id: row.id,
        userId: row.userId,
        providerId: row.providerId,
        providerAccountId:
          typeof row.accountId === "string" ? row.accountId : row.userId,
      });
      legacyAccounts.push({
        id: row.id,
        userId: row.userId,
        provider: row.providerId,
        providerAccountId:
          typeof row.accountId === "string" ? row.accountId : row.userId,
        password: null,
      });
      return { data: { id: row.id } };
    },
    beforeAccountDelete: async (row) => {
      canonicalCalls.push("beforeAccountDelete");
      if (typeof row.id !== "string" || typeof row.userId !== "string") return;
      const owned = identityLinks.filter((link) => link.userId === row.userId);
      if (owned.length <= 1) {
        throw new IdentityDetachStrandsUserError("test would strand user");
      }
      const index = identityLinks.findIndex(
        (link) => link.id === row.id && link.userId === row.userId,
      );
      if (index >= 0) identityLinks.splice(index, 1);
    },
    beforeEmailChange: async () => {},
  };

  const records = CredentialAccountStorageAdapter.create({
    legacy,
    identityAccounts,
    identityWriter: IdentityAccountWriter.create({
      accounts: identityAccounts,
      ceremonies,
    }),
    routesToIdentity: async () => latched,
    newAccountId: () => "identity-created",
    now: () => NOW,
  });
  const service = new CredentialAccountService({
    records,
    directory: { findUserIdByEmail: async () => null },
    passwords: {
      hash: async ({ password }) => `hashed:${password}`,
      matches: async ({ password, hash }) => hash === `hashed:${password}`,
    },
    federated: { changePassword: async () => ({ ok: false }) },
    identifiers: { attachCredentialIdentifier: async () => {} },
    sessions: { revokeOthers: async () => {} },
    milestones: { signedUp: () => {} },
  });

  const acceptsIdentityPassword = (password: string): boolean => {
    const credential = identityLinks.find(
      (row) => row.providerId === "credential",
    );
    return credential
      ? identityPasswords.get(credential.id) === `hashed:${password}`
      : false;
  };
  const acceptsLegacyPassword = (password: string): boolean =>
    legacyAccounts.some(
      (row) =>
        row.provider === "credential" && row.password === `hashed:${password}`,
    );

  return {
    service,
    legacyCalls,
    canonicalCalls,
    acceptsIdentityPassword,
    acceptsLegacyPassword,
  };
};

describe("CredentialAccountStorageAdapter", () => {
  it("changes a latched password in canonical and compatibility storage", async () => {
    const fixture = credentialServiceOver({
      latched: true,
      legacyAccounts: [account({ id: "credential", password: "hashed:old" })],
      identityLinks: [identityLink({ id: "credential" })],
      identityPasswords: new Map([["credential", "hashed:old"]]),
    });

    await expect(
      fixture.service.changePassword({
        userId: "sam",
        currentPassword: "old",
        newPassword: "new",
        keepSessionId: null,
      }),
    ).resolves.toBe("changed");

    expect(fixture.acceptsIdentityPassword("new")).toBe(true);
    expect(fixture.acceptsLegacyPassword("new")).toBe(true);
    expect(fixture.acceptsIdentityPassword("old")).toBe(false);
  });

  it("creates a first password through the identity ceremony and mirrors it", async () => {
    const fixture = credentialServiceOver({
      latched: true,
      legacyAccounts: [account({ id: "google", provider: "google" })],
      identityLinks: [identityLink({ id: "google", providerId: "google" })],
      identityPasswords: new Map([["google", null]]),
    });

    await expect(
      fixture.service.setFirstPassword({
        userId: "sam",
        password: "first",
        keepSessionId: null,
      }),
    ).resolves.toBe("set");

    expect(fixture.canonicalCalls).toEqual(
      expect.arrayContaining([
        "beforeAccountCreate",
        "createCredential",
        "mirrorSecretsOntoAccounts",
      ]),
    );
    expect(fixture.acceptsIdentityPassword("first")).toBe(true);
    expect(fixture.acceptsLegacyPassword("first")).toBe(true);
  });

  it("unlinks a latched credential and removes both ways it could authenticate", async () => {
    const fixture = credentialServiceOver({
      latched: true,
      legacyAccounts: [
        account({ id: "credential", password: "hashed:old" }),
        account({ id: "google", provider: "google" }),
      ],
      identityLinks: [
        identityLink({ id: "credential" }),
        identityLink({ id: "google", providerId: "google" }),
      ],
      identityPasswords: new Map([
        ["credential", "hashed:old"],
        ["google", null],
      ]),
    });

    await expect(
      fixture.service.unlinkAccount({
        userId: "sam",
        accountId: "credential",
      }),
    ).resolves.toBe("deleted");

    expect(fixture.canonicalCalls).toEqual(
      expect.arrayContaining([
        "beforeAccountDelete",
        "deleteCredentials",
        "deleteBridgeAccounts",
      ]),
    );
    expect(fixture.acceptsIdentityPassword("old")).toBe(false);
    expect(fixture.acceptsLegacyPassword("old")).toBe(false);
  });

  it("keeps every unlatched mutation on the legacy repository", async () => {
    const fixture = credentialServiceOver({
      latched: false,
      legacyAccounts: [account({ id: "credential", password: "hashed:old" })],
      identityLinks: [identityLink({ id: "credential" })],
      identityPasswords: new Map([["credential", "hashed:canonical-old"]]),
    });

    await fixture.service.changePassword({
      userId: "sam",
      currentPassword: "old",
      newPassword: "legacy-new",
      keepSessionId: null,
    });

    expect(fixture.acceptsLegacyPassword("legacy-new")).toBe(true);
    expect(fixture.acceptsIdentityPassword("canonical-old")).toBe(true);
    expect(fixture.canonicalCalls).toEqual([]);
    expect(fixture.legacyCalls).toEqual([
      "findCredentialAccount",
      "updateAccountPassword",
    ]);
  });
});
