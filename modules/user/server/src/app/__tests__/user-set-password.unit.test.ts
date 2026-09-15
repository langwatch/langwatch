/**
 * @vitest-environment node
 * Setting a FIRST password, for an account that has none. "Forgot password"
 * updates rows in place, so it never rescued one. What makes this safe with no
 * proof beyond the session is the refusal below: it fills an empty slot and
 * never replaces a full one. Spec: specs/identity/passkeys.feature
 */
import {
  ImpersonationCannotChangeCredentialsError,
  UserPasswordAlreadySetError,
  UserPasswordAuthUnavailableError,
} from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import type { UserRepositories } from "../../repositories/user.repositories.ts";
import {
  createUserTestApp,
  createUserTestAuth,
  TEST_CREDENTIAL_ISSUER,
} from "./user.fixture.ts";

const SELF = { email: "sam@acme.com" };

/** The account's own owner, asking for themselves. */
const owner = (id: string) => ({ id, operatorId: id, impersonated: false });

/** An operator browsing as that account: the subject is theirs, the account is not. */
const operatorAs = (id: string) => ({ id, operatorId: "operator-1", impersonated: true });

/** A passkey sign-up: a real account row holding no password at all. */
function passwordlessAccount(): {
  repositories: UserRepositories;
  create: () => Promise<{ id: string }>;
} {
  const repositories = MemoryUserRepositories.create();

  return {
    repositories,
    create: () =>
      repositories.users.createPasskeyUser({
        email: SELF.email,
        issuer: TEST_CREDENTIAL_ISSUER,
      }),
  };
}

describe("setting a first password", () => {
  describe("given an account created by a passkey, holding no password", () => {
    /** @scenario An account with no password can set a first one */
    it("fills the empty credential row rather than asking for a current password", async () => {
      const account = passwordlessAccount();
      const app = createUserTestApp({ repositories: account.repositories });
      const created = await account.create();

      await app.setOwnFirstPassword({
        userId: created.id,
        caller: owner(created.id),
        password: "a-good-password",
        keepSessionId: "sess-1",
      });

      await expect(app.hasPassword({ id: created.id })).resolves.toBe(true);
    });

    /** @scenario A new password ends every other session */
    it("ends every other session, because a password outlives revoking one", async () => {
      const auth = createUserTestAuth();
      const account = passwordlessAccount();
      const app = createUserTestApp({ repositories: account.repositories, dependencies: { auth } });
      const created = await account.create();

      await app.setOwnFirstPassword({
        userId: created.id,
        caller: owner(created.id),
        password: "a-good-password",
        keepSessionId: "sess-1",
      });

      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
        userId: created.id,
        keepSessionId: "sess-1",
      });
    });
  });

  describe("given an account that already has a password", () => {
    /**
     * The refusal the whole operation rests on. Setting a password takes no
     * proof beyond the session; letting it REPLACE one would turn a stolen
     * session into a credential that survives the session being revoked.
     * @scenario Setting a password can never overwrite one
     */
    it("refuses, and ends no session", async () => {
      const auth = createUserTestAuth();
      const app = createUserTestApp({ dependencies: { auth } });
      const created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });

      await expect(
        app.setOwnFirstPassword({
          userId: created.id,
          caller: owner(created.id),
          password: "a-good-password",
          keepSessionId: "sess-1",
        }),
      ).rejects.toBeInstanceOf(UserPasswordAlreadySetError);
      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });

  describe("given a password the shared policy refuses", () => {
    it("names the field, so the refusal lands where the person is looking", async () => {
      const account = passwordlessAccount();
      const app = createUserTestApp({ repositories: account.repositories });
      const created = await account.create();

      await expect(
        app.setOwnFirstPassword({
          userId: created.id,
          caller: owner(created.id),
          password: "short",
          keepSessionId: null,
        }),
      ).rejects.toMatchObject({ meta: { fieldErrors: { password: expect.any(Array) } } });
      await expect(app.hasPassword({ id: created.id })).resolves.toBe(false);
    });
  });

  describe("given a deployment that federates", () => {
    it("refuses, because the password does not live here", async () => {
      const app = createUserTestApp({
        members: {
          deployment: {
            authProvider: vi.fn(async () => "auth0"),
            offersPasskeys: () => false,
            findBaseUrl: () => null,
          },
        },
      });
      const created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });

      await expect(
        app.setOwnFirstPassword({
          userId: created.id,
          caller: owner(created.id),
          password: "a-good-password",
          keepSessionId: "sess-1",
        }),
      ).rejects.toBeInstanceOf(UserPasswordAuthUnavailableError);
    });
  });

  describe("given a request that carried no browser session of its own", () => {
    it("keeps no session, because there is no row to spare", async () => {
      const auth = createUserTestAuth();
      const account = passwordlessAccount();
      const app = createUserTestApp({ repositories: account.repositories, dependencies: { auth } });
      const created = await account.create();

      await app.setOwnFirstPassword({
        userId: created.id,
        caller: owner(created.id),
        password: "a-good-password",
        keepSessionId: null,
      });

      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });

  /**
   * The operation exists for accounts holding NO password, so it asks for no
   * proof beyond the session — which is exactly why an operator must not reach
   * it. A password minted here would be a way into the account that outlives
   * the impersonation, on precisely the single-sign-on-only and passkey-only
   * accounts the operation was built for.
   */
  describe("given an operator browsing as somebody", () => {
    it("refuses outright, sets no password and ends no session", async () => {
      const auth = createUserTestAuth();
      const account = passwordlessAccount();
      const app = createUserTestApp({ repositories: account.repositories, dependencies: { auth } });
      const created = await account.create();

      await expect(
        app.setOwnFirstPassword({
          userId: created.id,
          caller: operatorAs(created.id),
          password: "a-good-password",
          keepSessionId: null,
        }),
      ).rejects.toBeInstanceOf(ImpersonationCannotChangeCredentialsError);
      await expect(app.hasPassword({ id: created.id })).resolves.toBe(false);
      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });
  });
});
