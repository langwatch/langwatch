/**
 * How a linked sign-in method is named and classified.
 *
 * The Auth0 strategy encoding is a convention nothing enforces, and reading it
 * wrong is how a Google account starts calling itself "Email/Password" — which
 * is the one label that decides whether a Change Password control is offered.
 * Offering it on a social account sends the reader to a dialog whose submit can
 * only fail; withholding it from a credential account leaves them no way to
 * change their password at all.
 *
 * Spec: specs/settings/change-password-auth0.feature
 */

import { describe, expect, it } from "vitest";
import {
  canChangePassword,
  isCredentialAccount,
  isRemovableMethod,
  isSecurityKey,
  passkeyLabel,
  providerDisplayName,
} from "../sign-in-methods";

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

describe("given the methods an account holds", () => {
  describe("when only one is linked", () => {
    /**
     * The server refuses the last account under a serializable transaction;
     * this is the affordance saying so before the click rather than after it.
     */
    /** @scenario The only linked sign-in method offers no way to remove it */
    it("is not removable", () => {
      expect(isRemovableMethod({ linkedCount: 1, hasSsoProvider: false })).toBe(false);
    });
  });

  describe("when several are linked", () => {
    /** @scenario Removing a linked sign-in method re-reads the list */
    it("is removable", () => {
      expect(isRemovableMethod({ linkedCount: 2, hasSsoProvider: false })).toBe(true);
    });
  });

  describe("when the organization is pinned to a single sign-on provider", () => {
    /**
     * A second way in would route around the provider the organization chose,
     * so none of them may be removed and none may be added.
     */
    /** @scenario An organization on single sign-on links and removes nothing */
    it("is never removable, however many are linked", () => {
      expect(isRemovableMethod({ linkedCount: 3, hasSsoProvider: true })).toBe(false);
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
