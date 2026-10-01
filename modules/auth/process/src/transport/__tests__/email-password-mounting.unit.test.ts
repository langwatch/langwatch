/**
 * Email/password route mounting (ADR-027). License gate is the refusal, but
 * SaaS IdP is the only door, so mounting there would bypass it.
 */
import { describe, expect, it } from "vitest";

import { isEmailPasswordEnabled } from "../../channels/http/http.better-auth.channel.ts";

describe("given a SaaS deployment that names an identity provider", () => {
  describe("when the email/password routes are considered", () => {
    /** @scenario Auth0 enterprise mode */
    it("does not mount them, so no password can bypass the identity provider", () => {
      expect(
        isEmailPasswordEnabled({ authProvider: "auth0", isSaas: true, localPasswords: false }),
      ).toBe(false);
    });
  });
});

describe("given a deployment that names the email provider", () => {
  describe("when the email/password routes are considered", () => {
    /** @scenario Credentials-only on-prem mode */
    it("mounts them, because they are the only door", () => {
      expect(
        isEmailPasswordEnabled({ authProvider: "email", isSaas: true, localPasswords: false }),
      ).toBe(true);
    });
  });
});

describe("given a self-hosted deployment", () => {
  describe("when the email/password routes are considered", () => {
    /**
     * Self-hosted always mounts so an unlicensed deployment can still sign in,
     * and a licensed one keeps password reset reachable.
     */
    it("mounts them whichever provider is named", () => {
      expect(
        isEmailPasswordEnabled({ authProvider: "auth0", isSaas: false, localPasswords: false }),
      ).toBe(true);
      expect(
        isEmailPasswordEnabled({ authProvider: undefined, isSaas: false, localPasswords: false }),
      ).toBe(true);
    });
  });
});

describe("given a SaaS deployment that issues its own passwords beside its provider", () => {
  describe("when the email/password routes are considered", () => {
    /** @scenario "A deployment that issues its own passwords offers one beside its provider" */
    it("mounts them, because the password door moved here from the broker", () => {
      expect(
        isEmailPasswordEnabled({ authProvider: "auth0", isSaas: true, localPasswords: true }),
      ).toBe(true);
    });
  });
});
