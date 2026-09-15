/**
 * @vitest-environment node
 * Replacing a password that already exists. Unlike setting a first one, this
 * demands the current password — which proves the caller knows the credential,
 * not that the credential is theirs to replace. Spec: specs/identity/passkeys.feature
 */
import { ImpersonationCannotChangeCredentialsError } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { createUserTestApp, createUserTestAuth } from "./user.fixture.ts";

const SELF = { email: "sam@acme.com" };

const owner = (id: string) => ({ id, operatorId: id, impersonated: false });
const operatorAs = (id: string) => ({ id, operatorId: "operator-1", impersonated: true });

describe("changing an existing password", () => {
  describe("given the account's own owner", () => {
    it("replaces the password and ends every other session", async () => {
      const auth = createUserTestAuth();
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

      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
        userId: created.id,
        keepSessionId: "sess-1",
      });
    });
  });

  /**
   * Knowing the current password does not make it the operator's to replace.
   * An operator who does know it can already read everything the subject can;
   * what they must not be able to do is leave behind a credential that still
   * works once the impersonation has ended.
   */
  describe("given an operator browsing as somebody", () => {
    it("refuses outright, and ends no session", async () => {
      const auth = createUserTestAuth();
      const app = createUserTestApp({ dependencies: { auth } });
      const created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });

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
      const auth = createUserTestAuth();
      const app = createUserTestApp({ dependencies: { auth } });
      const created = await app.createCredentialUser({
        name: "Sam",
        email: SELF.email,
        passwordHash: "hashed:first",
      });

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
});
