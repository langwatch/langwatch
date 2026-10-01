import { createApiFixture } from "@langwatch/api-fixture";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { describe, expect, it } from "vitest";

import { ModuleBetterAuthFederation } from "../auth-composition.build.ts";

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
    licensing: createApiFixture<LicensingApi>({ isPlatformSsoLicensed: async () => licensed }),
    passkeysEnabled: false,
    isSaas: false,
    localPasswords: false,
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
