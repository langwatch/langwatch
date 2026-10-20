import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

import { ModuleBetterAuthFederation } from "../auth.app.ts";

function federationFor({
  licensed,
  providerMounted = true,
}: {
  licensed: boolean;
  providerMounted?: boolean;
}): ModuleBetterAuthFederation {
  return ModuleBetterAuthFederation.create({
    authProvider: "auth0",
    providerMounted,
    sso: createApiFixture<SsoApi>({ platformAllowed: async () => licensed }),
    passkeysEnabled: false,
    isSaas: false,
    localPasswords: false,
    mountedSocialMethodIds: [],
  });
}

describe("given a self-hosted install that names auth0", () => {
  describe("when a signed license permits platform single sign-on", () => {
    /** @scenario "A licensed self-hosted install reports federation licensed" */
    it("reports federation licensed and offers auth0", async () => {
      const federation = federationFor({ licensed: true });
      const policy = await federation.resolveSignInMethodPolicy();

      await expect(federation.platformSsoAllowed()).resolves.toBe(true);
      expect(policy.federationLicensed).toBe(true);
      expect(policy.defaultMethods.map((method) => method.id)).toContain("auth0");
    });
  });

  describe("when no license permits it", () => {
    /** @scenario "An unlicensed install that names a provider signs in by email" */
    it("reports federation unlicensed and offers no federated method", async () => {
      const federation = federationFor({ licensed: false });
      const policy = await federation.resolveSignInMethodPolicy();

      await expect(federation.platformSsoAllowed()).resolves.toBe(false);
      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods.map((method) => method.id)).not.toContain("auth0");
    });
  });

  describe("when licensed but the named provider did not mount", () => {
    /** @scenario "A licensed install whose named provider did not mount signs in by email" */
    it("offers no federated method", async () => {
      const policy = await federationFor({
        licensed: true,
        providerMounted: false,
      }).resolveSignInMethodPolicy();

      expect(policy.defaultMethods.map((method) => method.id)).not.toContain("auth0");
    });
  });
});

describe("given a self-hosted install that names auth0 and mounted it", () => {
  describe("when the sign-in method policy is resolved and the federation gate is asked", () => {
    /** @scenario "Every sign-in decision asks enterprise SSO's licence gate" */
    it("answers both from enterprise SSO's gate", async () => {
      let asked = 0;
      const federation = ModuleBetterAuthFederation.create({
        authProvider: "auth0",
        providerMounted: true,
        sso: createApiFixture<SsoApi>({
          platformAllowed: async () => {
            asked += 1;
            return true;
          },
        }),
        passkeysEnabled: false,
        isSaas: false,
        localPasswords: false,
        mountedSocialMethodIds: [],
      });

      await expect(federation.platformSsoAllowed()).resolves.toBe(true);
      const before = asked;
      const policy = await federation.resolveSignInMethodPolicy();

      expect(before).toBe(1);
      expect(asked).toBeGreaterThan(before);
      expect(policy.federationLicensed).toBe(true);
    });
  });

  describe("when enterprise SSO's gate refused because the licensing store did not answer in time", () => {
    /** @scenario "A gate that gave up on a silent licensing store leaves sign-in on email" */
    it("offers no federated method", async () => {
      const federation = ModuleBetterAuthFederation.create({
        authProvider: "auth0",
        providerMounted: true,
        sso: createApiFixture<SsoApi>({
          platformAllowed: () =>
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 5)),
        }),
        passkeysEnabled: false,
        isSaas: false,
        localPasswords: false,
        mountedSocialMethodIds: [],
      });

      const policy = await federation.resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(false);
      expect(policy.defaultMethods.map((method) => method.id)).not.toContain("auth0");
    });
  });
});
