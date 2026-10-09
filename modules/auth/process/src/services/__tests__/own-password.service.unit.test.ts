/**
 * The password doors auth now owns (D-A1U-4), over a user stub and auth's own reads.
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
  type UserApi,
} from "@langwatch/user-contract";
import { compare } from "bcrypt";
import { describe, expect, it, vi } from "vitest";

import { OwnPasswordService } from "../own-password.service.ts";

const self = { id: "user-1", operatorId: "user-1", impersonated: false };
const operator = { id: "user-1", operatorId: "operator-1", impersonated: true };

function doors({
  provider = "email",
  localPasswords = false,
  allowed = true,
  holdsOwnPassword = true,
  setResult = "set" as const,
  rotation = "rotated" as const,
  federated = { outcome: "changed" } as const,
}: {
  provider?: string;
  localPasswords?: boolean;
  allowed?: boolean;
  holdsOwnPassword?: boolean;
  setResult?: "set" | "already_set";
  rotation?: "rotated" | "no_password" | "wrong_password";
  federated?:
    | { outcome: "changed" }
    | { outcome: "no_federated_account" }
    | { outcome: "wrong_password" }
    | { outcome: "weak_password"; message: string };
} = {}) {
  const users = {
    findById: vi.fn(async () => null),
    hasPassword: vi.fn(async () => holdsOwnPassword),
    setFirstPassword: vi.fn<UserApi["setFirstPassword"]>(async () => setResult),
    rotatePassword: vi.fn(async () => rotation),
  };
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
    auth,
    issuesOwnPasswords: () => localPasswords,
  });

  return { users, auth, service };
}

describe("setting a first password", () => {
  describe("given an account holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty slot with the deployment's own hash, never the plain text", async () => {
      const { users, service } = doors();

      await service.setFirst({
        userId: "user-1",
        password: "a-first-pw-123",
        keepSessionId: "session-1",
        caller: self,
      });

      const [written] = users.setFirstPassword.mock.calls[0] ?? [];
      expect(written?.id).toBe("user-1");
      expect(await compare("a-first-pw-123", written?.passwordHash ?? "")).toBe(true);
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, keeping the one that made the change", async () => {
      const { auth, service } = doors();

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
      const { auth, service } = doors();

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
      const { auth, service } = doors({ setResult: "already_set" });

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
    const { users, service } = doors();

    await expect(
      service.setFirst({ userId: "user-1", password: "x", keepSessionId: null, caller: self }),
    ).rejects.toBeInstanceOf(ValidationError);
    expect(users.setFirstPassword).not.toHaveBeenCalled();
  });

  it("refuses where the deployment federates and issues no passwords of its own", async () => {
    const { service } = doors({ provider: "auth0" });

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
    const { service } = doors({ allowed: false });

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
    const { users, auth, service } = doors();

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
    expect(users.setFirstPassword).not.toHaveBeenCalled();
    expect(users.rotatePassword).not.toHaveBeenCalled();
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

  it("rotates through user in one call, then ends every other session", async () => {
    const { users, auth, service } = doors();

    await service.change(change);

    expect(users.rotatePassword).toHaveBeenCalledWith({
      userId: "user-1",
      currentPassword: "old-pw-123",
      newPassword: "new-pw-12345",
    });
    expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
      userId: "user-1",
      keepSessionId: "session-1",
    });
  });

  it("names the wrong current password, and a missing one", async () => {
    await expect(
      doors({ rotation: "wrong_password" }).service.change(change),
    ).rejects.toBeInstanceOf(UserPasswordIncorrectError);
    await expect(doors({ rotation: "no_password" }).service.change(change)).rejects.toBeInstanceOf(
      UserPasswordNotSetError,
    );
  });

  /** @scenario "A change targets the password the person actually signs in with" */
  it("changes this deployment's own password for somebody holding one under Auth0", async () => {
    const { users, auth, service } = doors({ provider: "auth0", localPasswords: true });

    await service.change(change);

    expect(users.rotatePassword).toHaveBeenCalled();
    expect(auth.changeFederatedPassword).not.toHaveBeenCalled();
  });

  describe("given a deployment that brokers every password through Auth0", () => {
    it("changes the tenant's password and ends every other session", async () => {
      const { users, auth, service } = doors({ provider: "auth0", holdsOwnPassword: false });

      await service.change(change);

      expect(auth.changeFederatedPassword).toHaveBeenCalledWith({
        userId: "user-1",
        email: null,
        currentPassword: "old-pw-123",
        newPassword: "new-pw-12345",
      });
      expect(users.rotatePassword).not.toHaveBeenCalled();
      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalled();
    });

    it("refuses by name where the person holds no Auth0 database identity", async () => {
      const { service } = doors({
        provider: "auth0",
        holdsOwnPassword: false,
        federated: { outcome: "no_federated_account" },
      });

      await expect(service.change(change)).rejects.toBeInstanceOf(
        UserFederatedPasswordAccountMissingError,
      );
    });

    it("passes the provider's wording through when it rejects the new password", async () => {
      const { service } = doors({
        provider: "auth0",
        holdsOwnPassword: false,
        federated: { outcome: "weak_password", message: "too common" },
      });

      await expect(service.change(change)).rejects.toThrow("too common");
    });
  });
});
