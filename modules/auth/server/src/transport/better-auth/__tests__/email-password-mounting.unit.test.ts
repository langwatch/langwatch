/**
 * Email/password route mounting (ADR-027). License gate is the refusal, but
 * SaaS IdP is the only door, so mounting there would bypass it.
 */
import { describe, expect, it } from "vitest";

import { isEmailPasswordEnabled } from "../better-auth.api.ts";

describe("given a SaaS deployment that names an identity provider", () => {
  describe("when the email/password routes are considered", () => {
    /** @scenario Auth0 enterprise mode */
    it("does not mount them, so no password can bypass the identity provider", () => {
      expect(isEmailPasswordEnabled({ authProvider: "auth0", isSaas: true })).toBe(false);
    });
  });
});

describe("given a deployment that names the email provider", () => {
  describe("when the email/password routes are considered", () => {
    /** @scenario Credentials-only on-prem mode */
    it("mounts them, because they are the only door", () => {
      expect(isEmailPasswordEnabled({ authProvider: "email", isSaas: true })).toBe(true);
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
      expect(isEmailPasswordEnabled({ authProvider: "auth0", isSaas: false })).toBe(true);
      expect(isEmailPasswordEnabled({ authProvider: undefined, isSaas: false })).toBe(true);
    });
  });
});
