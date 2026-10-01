/**
 * Changing a password the Auth0 tenant holds: only the Auth0 database
 * identity's password moves, and a deployment that names no tenant answers
 * `not_configured` on the call rather than failing at boot.
 * @see specs/settings/change-password-auth0.feature
 */
import { describe, expect, it } from "vitest";

import { auth0PasswordChannels } from "../../channels/auth0-password-channels.registry.ts";
import { FederatedPasswordService } from "../federated-password.service.ts";

const CHANGE = {
  userId: "user_1",
  email: "sam@acme.com",
  currentPassword: "old-password",
  newPassword: "a-new-password",
};

function accountsHolding(accounts: { providerId: string; accountId: string }[]) {
  return { findFederatedAccountsForUser: async () => accounts };
}

describe("FederatedPasswordService.changePassword", () => {
  describe("given an Auth0 database identity and a tenant that accepts the change", () => {
    it("changes the password of that identity", async () => {
      const auth0 = auth0PasswordChannels.memory.create({ outcome: "changed" });
      const service = FederatedPasswordService.create({
        accounts: accountsHolding([
          { providerId: "auth0", accountId: "google-oauth2|99" },
          { providerId: "auth0", accountId: "auth0|123" },
        ]),
        auth0,
      });

      await expect(service.changePassword(CHANGE)).resolves.toEqual({ outcome: "changed" });
      expect(auth0.requests).toEqual([
        {
          email: "sam@acme.com",
          auth0UserId: "auth0|123",
          currentPassword: "old-password",
          newPassword: "a-new-password",
        },
      ]);
    });
  });

  describe("given only a social identity brokered through Auth0", () => {
    it("answers no_federated_account and asks the tenant nothing", async () => {
      const auth0 = auth0PasswordChannels.memory.create({ outcome: "changed" });
      const service = FederatedPasswordService.create({
        accounts: accountsHolding([{ providerId: "auth0", accountId: "google-oauth2|99" }]),
        auth0,
      });

      await expect(service.changePassword(CHANGE)).resolves.toEqual({
        outcome: "no_federated_account",
      });
      expect(auth0.requests).toEqual([]);
    });
  });

  describe("given an account with no address to prove the password with", () => {
    it("answers no_address_on_record", async () => {
      const service = FederatedPasswordService.create({
        accounts: accountsHolding([{ providerId: "auth0", accountId: "auth0|123" }]),
        auth0: auth0PasswordChannels.memory.create({ outcome: "changed" }),
      });

      await expect(service.changePassword({ ...CHANGE, email: null })).resolves.toEqual({
        outcome: "no_address_on_record",
      });
    });
  });

  describe("given a deployment that names no Auth0 tenant", () => {
    it("answers not_configured on the call", async () => {
      const service = FederatedPasswordService.create({
        accounts: accountsHolding([{ providerId: "auth0", accountId: "auth0|123" }]),
        auth0: auth0PasswordChannels.http.create({
          issuer: undefined,
          mgmtClientId: undefined,
          mgmtClientSecret: undefined,
        }),
      });

      await expect(service.changePassword(CHANGE)).resolves.toEqual({
        outcome: "not_configured",
      });
    });
  });
});
