/**
 * The password doors auth now owns (D-A1U-4), over a user stub, auth's own reads and an
 * in-memory stand-in for Better Auth's account storage, the store sign-in reads.
 */
import { ValidationError } from "@langwatch/handled-error";
import {
  ImpersonationCannotChangeCredentialsError,
  UserFederatedPasswordAccountMissingError,
  UserPasswordAlreadySetError,
  UserPasswordAttemptsThrottledError,
  UserPasswordAuthUnavailableError,
  UserPasswordIncorrectError,
  UserPasswordNotSetError,
} from "@langwatch/user-contract";
import { compare, hash } from "bcrypt";
import { describe, expect, it, vi } from "vitest";

import { type CredentialAccounts, OwnPasswordService } from "../own-password.service.ts";

const self = { id: "user-1", operatorId: "user-1", impersonated: false };
const operator = { id: "user-1", operatorId: "operator-1", impersonated: true };

/** One person's accounts as Better Auth's storage holds them; sign-in verifies against these. */
function accountStore({ passwordHash }: { passwordHash: string | null | undefined }) {
  const accounts = new Map<string, { password: string | null }>();
  if (passwordHash !== undefined) accounts.set("account-1", { password: passwordHash });
  const credentials = {
    findCredential: vi.fn(async () => {
      const account = accounts.get("account-1");
      return account ? { id: "account-1", passwordHash: account.password } : null;
    }),
    listAccountIds: vi.fn(async () => [...accounts.keys()]),
    writePassword: vi.fn(
      async ({ accountId, passwordHash: written }: { accountId: string; passwordHash: string }) => {
        accounts.set(accountId, { password: written });
      },
    ),
    linkPassword: vi.fn(async ({ passwordHash: written }: { passwordHash: string }) => {
      accounts.set("account-1", { password: written });
    }),
    deleteAccount: vi.fn(async ({ accountId }: { accountId: string }) => {
      accounts.delete(accountId);
    }),
    hashPassword: vi.fn(async ({ password }: { password: string }) => hash(password, 4)),
    passwordMatches: vi.fn(async ({ password, hash: stored }: { password: string; hash: string }) =>
      compare(password, stored),
    ),
  } satisfies CredentialAccounts;
  /** What sign-in would answer for this password. */
  const signsIn = async (password: string) => {
    const stored = accounts.get("account-1")?.password;
    return stored ? compare(password, stored) : false;
  };
  return { credentials, signsIn };
}

async function doors({
  provider = "email",
  localPasswords = false,
  allowed = true,
  holdsOwnPassword = true,
  storedPassword = "old-pw-123" as string | null,
  holdsNoAccount = false,
  federated = { outcome: "changed" } as const,
}: {
  provider?: string;
  localPasswords?: boolean;
  allowed?: boolean;
  holdsOwnPassword?: boolean;
  /** The plain password the store holds a hash of; null for an empty password slot. */
  storedPassword?: string | null;
  /** No local password account at all. */
  holdsNoAccount?: boolean;
  federated?:
    | { outcome: "changed" }
    | { outcome: "no_federated_account" }
    | { outcome: "wrong_password" }
    | { outcome: "weak_password"; message: string };
} = {}) {
  const users = {
    findById: vi.fn(async () => null),
    hasPassword: vi.fn(async () => holdsOwnPassword),
  };
  const storedHash = storedPassword === null ? null : await hash(storedPassword, 4);
  const store = accountStore({ passwordHash: holdsNoAccount ? undefined : storedHash });
  const auth = {
    resolveAuthProvider: vi.fn(async () => provider),
    route: vi.fn(async () => {
      throw new Error("routing is never asked without an address on record");
    }),
    isWithinBudget: vi.fn(async () => ({ allowed })),
    changeFederatedPassword: vi.fn(async () => federated),
    revokeOtherBrowserSessions: vi.fn(async () => undefined),
  };
  const service = OwnPasswordService.create({
    users,
    credentials: store.credentials,
    auth,
    issuesOwnPasswords: () => localPasswords,
  });

  return { users, auth, service, credentials: store.credentials, signsIn: store.signsIn };
}

describe("setting a first password", () => {
  describe("given an account holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty slot with the deployment's own hash, never the plain text", async () => {
      const { credentials, service, signsIn } = await doors({ storedPassword: null });

      await service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: "session-1",
        caller: self,
      });

      const [written] = credentials.writePassword.mock.calls[0] ?? [];
      expect(written?.accountId).toBe("account-1");
      expect(written?.passwordHash).not.toBe("a-first-pw-123");
      expect(await signsIn("a-first-pw-123")).toBe(true);
    });

    it("links a new password account where the person holds none at all", async () => {
      const { credentials, service, signsIn } = await doors({ holdsNoAccount: true });

      await service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: null,
        caller: self,
      });

      expect(credentials.linkPassword).toHaveBeenCalledWith(
        expect.objectContaining({ userId: "user-1" }),
      );
      expect(await signsIn("a-first-pw-123")).toBe(true);
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, keeping the one that made the change", async () => {
      const { auth, service } = await doors({ storedPassword: null });

      await service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: "session-1",
        caller: self,
      });

      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
        userId: "user-1",
        keepSessionId: "session-1",
      });
    });

    it("keeps no session where the request carried none", async () => {
      const { auth, service } = await doors({ storedPassword: null });

      await service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: null,
        caller: self,
      });

      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });

  describe("given an account that already has a password", () => {
    /** @scenario Setting a password can never overwrite one */
    it("refuses, and ends no session", async () => {
      const { auth, service } = await doors();

      await expect(
        service.setFirst({
          userId: "user-1",
          password: "a-first-pw-123",
          keepSessionId: "session-1",
          caller: self,
        }),
      ).rejects.toBeInstanceOf(UserPasswordAlreadySetError);
      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });

  it("names the field when the shared policy refuses the password", async () => {
    const { credentials, service } = await doors({ storedPassword: null });

    await expect(
      service.setFirst({ userId: "user-1", password: "x", keepSessionId: null, caller: self }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(credentials.writePassword).not.toHaveBeenCalled();
  });

  it("refuses where the deployment federates and issues no passwords of its own", async () => {
    const { service } = await doors({ provider: "auth0" });

    await expect(
      service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: null,
        caller: self,
      }),
    ).rejects.toBeInstanceOf(UserPasswordAuthUnavailableError);
  });

  it("refuses once the attempt budget is spent", async () => {
    const { service } = await doors({ allowed: false });

    await expect(
      service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: null,
        caller: self,
      }),
    ).rejects.toBeInstanceOf(UserPasswordAttemptsThrottledError);
  });
});

describe("given an operator browsing as somebody", () => {
  /** @scenario "An impersonating operator cannot set or change a password" */
  it("refuses both doors outright, writes nothing and ends no session", async () => {
    const { credentials, auth, service } = await doors({ storedPassword: null });

    await expect(
      service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: null,
        caller: operator,
      }),
    ).rejects.toBeInstanceOf(ImpersonationCannotChangeCredentialsError);
    await expect(
      service.change({
        userId: "user-1",
        currentPassword: "old-pw-123",
        newPassword: "new-pw-12345",
        keepSessionId: null,
        caller: operator,
      }),
    ).rejects.toBeInstanceOf(ImpersonationCannotChangeCredentialsError);
    expect(credentials.writePassword).not.toHaveBeenCalled();
    expect(credentials.linkPassword).not.toHaveBeenCalled();
    expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
  });
});

describe("changing an existing password", () => {
  const change = {
    userId: "user-1",
    currentPassword: "old-pw-123",
    newPassword: "new-pw-12345",
    keepSessionId: "session-1",
    caller: self,
  };

  /** @scenario "A changed password is the one sign-in accepts" */
  it("writes where sign-in reads: the new password signs in and the old one is refused", async () => {
    const { auth, service, signsIn } = await doors();
    expect(await signsIn("old-pw-123")).toBe(true);

    await service.change(change);

    expect(await signsIn("new-pw-12345")).toBe(true);
    expect(await signsIn("old-pw-123")).toBe(false);
    expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
      userId: "user-1",
      keepSessionId: "session-1",
    });
  });

  it("names the wrong current password, and a missing one", async () => {
    const wrong = await doors({ storedPassword: "another-pw-123" });
    await expect(wrong.service.change(change)).rejects.toBeInstanceOf(UserPasswordIncorrectError);
    expect(await wrong.signsIn("another-pw-123")).toBe(true);
    await expect(
      (await doors({ storedPassword: null })).service.change(change),
    ).rejects.toBeInstanceOf(UserPasswordNotSetError);
  });

  /** @scenario "A change targets the password the person actually signs in with" */
  it("changes this deployment's own password for somebody holding one under Auth0", async () => {
    const { credentials, auth, service } = await doors({ provider: "auth0", localPasswords: true });

    await service.change(change);

    expect(credentials.writePassword).toHaveBeenCalled();
    expect(auth.changeFederatedPassword).not.toHaveBeenCalled();
  });

  describe("given a deployment that brokers every password through Auth0", () => {
    it("changes the tenant's password and ends every other session", async () => {
      const { credentials, auth, service } = await doors({
        provider: "auth0",
        holdsOwnPassword: false,
      });

      await service.change(change);

      expect(auth.changeFederatedPassword).toHaveBeenCalledWith({
        userId: "user-1",
        email: null,
        currentPassword: "old-pw-123",
        newPassword: "new-pw-12345",
      });
      expect(credentials.writePassword).not.toHaveBeenCalled();
      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalled();
    });

    it("refuses by name where the person holds no Auth0 database identity", async () => {
      const { service } = await doors({
        provider: "auth0",
        holdsOwnPassword: false,
        federated: { outcome: "no_federated_account" },
      });

      await expect(service.change(change)).rejects.toBeInstanceOf(
        UserFederatedPasswordAccountMissingError,
      );
    });

    it("passes the provider's wording through when it rejects the new password", async () => {
      const { service } = await doors({
        provider: "auth0",
        holdsOwnPassword: false,
        federated: { outcome: "weak_password", message: "too common" },
      });

      await expect(service.change(change)).rejects.toThrow("too common");
    });
  });
});
