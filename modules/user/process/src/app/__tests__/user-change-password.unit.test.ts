/**
 * @vitest-environment node
 * Replacing a password that already exists. Unlike setting a first one, this
 * demands the current password — which proves the caller knows the credential,
 * not that the credential is theirs to replace. Spec: specs/identity/passkeys.feature
 */
import { ImpersonationCannotChangeCredentialsError } from "@langwatch/user-contract";
import { beforeEach, describe, expect, it } from "vitest";

import { createUserTestApp, createUserTestAuth } from "./user.fixture.ts";

const SELF = { email: "sam@acme.com" };

const owner = (id: string) => ({ id, operatorId: id, impersonated: false });
const operatorAs = (id: string) => ({ id, operatorId: "operator-1", impersonated: true });

describe("changing an existing password", () => {
  describe("given the account's own owner", () => {
    let auth: ReturnType<typeof createUserTestAuth>;
    let app: ReturnType<typeof createUserTestApp>;

    beforeEach(() => {
      auth = createUserTestAuth();
      app = createUserTestApp({ dependencies: { auth } });
    });

    it("replaces the password and ends every other session", async () => {
      const created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });

      await app.changeOwnPassword({
        userId: created.id,
        caller: owner(created.id),
        currentPassword: "first",
        newPassword: "a-good-password",
        keepSessionId: "sess-1",
      });

      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
        userId: created.id,
        keepSessionId: "sess-1",
      });
    });
  });

  /**
   * Knowing the current password does not make it the operator's to replace
   * — they can already read everything the subject can, but must not leave
   * behind a credential that still works once the impersonation has ended.
   */
  describe("given an operator browsing as somebody", () => {
    let auth: ReturnType<typeof createUserTestAuth>;
    let app: ReturnType<typeof createUserTestApp>;
    let created: Awaited<ReturnType<ReturnType<typeof createUserTestApp>["createCredentialUser"]>>;

    beforeEach(async () => {
      auth = createUserTestAuth();
      app = createUserTestApp({ dependencies: { auth } });
      created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });
    });

    it("refuses outright, and ends no session", async () => {
      await expect(
        app.changeOwnPassword({
          userId: created.id,
          caller: operatorAs(created.id),
          currentPassword: "first",
          newPassword: "a-good-password",
          keepSessionId: null,
        }),
      ).rejects.toBeInstanceOf(ImpersonationCannotChangeCredentialsError);
      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });

    it("refuses before the current password is checked at all", async () => {
      // A wrong current password would normally answer "that password is
      // incorrect". While impersonating it answers the refusal instead, so the
      // endpoint cannot be used to test passwords against somebody's account.
      await expect(
        app.changeOwnPassword({
          userId: created.id,
          caller: operatorAs(created.id),
          currentPassword: "not-the-password",
          newPassword: "a-good-password",
          keepSessionId: null,
        }),
      ).rejects.toBeInstanceOf(ImpersonationCannotChangeCredentialsError);
    });
  });

  describe("given a deployment that brokers through Auth0 and issues its own passwords", () => {
    /** @scenario "A change targets the password the person actually signs in with" */
    it("changes this deployment's own stored password for somebody holding one", async () => {
      const auth = createUserTestAuth("auth0", { issuesOwnPasswords: true });
      const app = createUserTestApp({ dependencies: { auth } });
      const created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });

      await app.changeOwnPassword({
        userId: created.id,
        caller: owner(created.id),
        currentPassword: "first",
        newPassword: "a-good-password",
        keepSessionId: "sess-1",
      });

      await expect(
        app.changeOwnPassword({
          userId: created.id,
          caller: owner(created.id),
          currentPassword: "a-good-password",
          newPassword: "another-good-password",
          keepSessionId: "sess-1",
        }),
      ).resolves.toBeUndefined();
    });
  });
});
