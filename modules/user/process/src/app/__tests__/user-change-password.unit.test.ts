/**
 * @vitest-environment node
 * Replacing a password that already exists. Unlike setting a first one, this
 * demands the current password — which proves the caller knows the credential,
 * not that the credential is theirs to replace. Spec: specs/identity/passkeys.feature
 */
import type { AuthFederatedPasswordOutcome } from "@langwatch/auth-contract";
import {
  ImpersonationCannotChangeCredentialsError,
  UserFederatedPasswordAccountMissingError,
  UserFederatedPasswordChangeUnavailableError,
} from "@langwatch/user-contract";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

    /** @scenario "An impersonating operator cannot set or change a password" */
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

  describe("given a deployment that brokers every password through Auth0", () => {
    async function brokeredChange(outcome: AuthFederatedPasswordOutcome) {
      const auth = Object.assign(createUserTestAuth("auth0"), {
        changeFederatedPassword: vi.fn(async () => outcome),
      });
      const app = createUserTestApp({ dependencies: { auth } });
      const created = await app.create({ name: "Sam", email: SELF.email });
      const change = app.changeOwnPassword({
        userId: created.id,
        caller: owner(created.id),
        currentPassword: "first",
        newPassword: "a-good-password",
        keepSessionId: "sess-1",
      });

      return { auth, created, change };
    }

    it("changes the tenant's password and ends every other session", async () => {
      const { auth, created, change } = await brokeredChange({ outcome: "changed" });

      await expect(change).resolves.toBeUndefined();
      expect(auth.changeFederatedPassword).toHaveBeenCalledWith({
        userId: created.id,
        email: SELF.email,
        currentPassword: "first",
        newPassword: "a-good-password",
      });
      expect(auth.revokeOtherBrowserSessions).toHaveBeenCalledWith({
        userId: created.id,
        keepSessionId: "sess-1",
      });
    });

    it("refuses as unavailable where no Auth0 tenant is configured", async () => {
      const { auth, change } = await brokeredChange({ outcome: "not_configured" });

      await expect(change).rejects.toBeInstanceOf(UserFederatedPasswordChangeUnavailableError);
      expect(auth.revokeOtherBrowserSessions).not.toHaveBeenCalled();
    });

    it("refuses as not found where the person holds no Auth0 database identity", async () => {
      const { change } = await brokeredChange({ outcome: "no_federated_account" });

      await expect(change).rejects.toBeInstanceOf(UserFederatedPasswordAccountMissingError);
    });
  });
});
