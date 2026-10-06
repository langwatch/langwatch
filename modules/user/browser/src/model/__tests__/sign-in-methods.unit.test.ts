/**
 * Tests naming and classification of Auth0 sign-in methods. The strategy
 * encoding decides whether Change Password is offered. Ref: change-password-auth0.feature
 */

import { describe, expect, it } from "vitest";

import {
  canChangePassword,
  federatedMethodLabel,
  isCredentialAccount,
  isSecurityKey,
  passkeyLabel,
  providerDisplayName,
  signInMethodRows,
} from "../sign-in-methods.ts";

describe("given an account linked through Auth0", () => {
  describe("when it is Auth0's own username-password database", () => {
    /** @scenario Auth0 user with a database identity sees the Change Password link in their linked sign-in row */
    it("is named Email/Password and counts as a credential account", () => {
      expect(providerDisplayName("auth0", "auth0|user-123")).toBe("Email/Password");
      expect(isCredentialAccount({ provider: "auth0", providerAccountId: "auth0|user-123" })).toBe(
        true,
      );
    });
  });

  describe("when it is a social identity that arrived through the tenant", () => {
    /**
     * THE DISTINCTION THIS MODULE EXISTS FOR. Both come back with
     * `provider: "auth0"`, so the account id is the only thing that tells a
     * Google sign-in from a password.
     */
    /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
    it("is named after the real provider and is not a credential account", () => {
      expect(providerDisplayName("auth0", "google-oauth2|abc")).toBe("Google");
      expect(providerDisplayName("auth0", "windowslive|abc")).toBe("Microsoft");
      expect(providerDisplayName("auth0", "github|abc")).toBe("GitHub");
      expect(
        isCredentialAccount({ provider: "auth0", providerAccountId: "google-oauth2|abc" }),
      ).toBe(false);
    });
  });

  describe("when the strategy is one nothing names", () => {
    /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
    it("title-cases the strategy rather than showing the raw id", () => {
      expect(providerDisplayName("auth0", "okta-workforce|abc")).toBe("Okta Workforce");
      expect(providerDisplayName("auth0", "")).toBe("Unknown");
    });
  });
});

describe("given an account linked directly", () => {
  describe("when it is a better-auth credential", () => {
    /** @scenario Email/credential user sees a dedicated Change Password section with just a button */
    it("counts as a credential account", () => {
      expect(isCredentialAccount({ provider: "credential", providerAccountId: "x" })).toBe(true);
    });
  });

  describe("when it is an OAuth provider", () => {
    /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
    it("is title-cased and is not a credential account", () => {
      expect(providerDisplayName("github", "gh-1")).toBe("Github");
      expect(isCredentialAccount({ provider: "google", providerAccountId: "g-1" })).toBe(false);
    });
  });
});

describe("given the deployment's sign-in mode", () => {
  describe("when it keeps the credential somewhere the product can reach", () => {
    /** @scenario Email/credential user sees a dedicated Change Password section with just a button */
    it("offers to change a password", () => {
      expect(canChangePassword("email")).toBe(true);
      expect(canChangePassword("auth0")).toBe(true);
    });
  });

  describe("when the credential lives at an identity provider", () => {
    /**
     * Offering to change a password the product cannot reach is a control whose
     * submit can only fail.
     */
    /** @scenario Auth0 social-only user (Google via Auth0) does not see Change Password */
    it("offers nothing", () => {
      expect(canChangePassword("google")).toBe(false);
      expect(canChangePassword("okta")).toBe(false);
      expect(canChangePassword(void 0)).toBe(false);
    });
  });
});

describe("given a passkey the authenticator described", () => {
  describe("when the transports name a roaming authenticator", () => {
    /** @scenario Both kinds of authenticator register, and the list says which */
    it("reads as a security key", () => {
      expect(isSecurityKey({ transports: "usb" })).toBe(true);
      expect(isSecurityKey({ transports: "nfc,ble" })).toBe(true);
    });
  });

  describe("when they name a platform authenticator", () => {
    /**
     * Read off transports rather than `deviceType`, which is the tempting field
     * and the wrong one: a platform authenticator that does not sync is still
     * on the person's laptop, not on a key in their pocket.
     */
    /** @scenario Both kinds of authenticator register, and the list says which */
    it("reads as a device", () => {
      expect(isSecurityKey({ transports: "internal,hybrid" })).toBe(false);
      expect(isSecurityKey({ transports: null })).toBe(false);
      expect(isSecurityKey({})).toBe(false);
    });
  });
});

describe("given a passkey in a list of them", () => {
  describe("when the browser chose a name", () => {
    /** @scenario A passkey is named, and the name can be changed */
    it("uses it", () => {
      expect(passkeyLabel({ name: "Work laptop" })).toBe("Work laptop");
    });
  });

  describe("when it carries none, or only spaces", () => {
    /** @scenario A passkey is named, and the name can be changed */
    it("falls back to a word rather than an id", () => {
      expect(passkeyLabel({ name: null })).toBe("Passkey");
      expect(passkeyLabel({ name: "   " })).toBe("Passkey");
      expect(passkeyLabel({})).toBe("Passkey");
    });
  });
});

describe("given a federated identifier on the profile", () => {
  describe("when its provider is a known identity or an operator's own", () => {
    /** @scenario The sign-in methods keep the Security page's labels */
    it("names the known identity and calls the rest single sign-on", () => {
      expect(federatedMethodLabel("google")).toBe("Google");
      expect(federatedMethodLabel("oidc")).toBe("Single sign-on");
    });
  });

  describe("when the account holds no address anywhere", () => {
    /** @scenario Only an account with no address anywhere is told it has none */
    it("says none yet, and leaves the credential and passkey identifiers out", () => {
      const rows = signInMethodRows({
        identifiers: [
          {
            identifierId: "c",
            provider: "credential",
            value: null,
            isPrimary: false,
            confirmed: true,
          },
        ],
        accountAddress: { email: null, confirmed: true },
        passkeyDetail: "None yet",
        hasPassword: false,
      });
      expect(rows.map((row) => row.label)).toEqual(["Email address", "Passkeys", "Password"]);
      expect(rows[0]?.detail).toBe("None yet");
    });
  });
});
