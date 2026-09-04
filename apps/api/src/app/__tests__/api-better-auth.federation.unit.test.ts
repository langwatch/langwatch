/**
 * @vitest-environment node
 *
 * Whether federation is licensed on this process.
 *
 * It was the constant `false`, whatever licence the deployment held. A
 * licensed self-hosted install therefore refused its own single sign-on and
 * left `/api/auth/sign-up/email` mounted and open — the inversion of the
 * invariant ADR-027 states.
 *
 * @regression
 */
import type { LicensingService } from "@langwatch/enterprise-licensing-contract";
import type { Logger } from "@langwatch/observability";
import { describe, expect, it, vi } from "vitest";

import { ApiBetterAuthFederation } from "../api-better-auth.composition";

function testLogger(): Logger {
  return { warn: vi.fn(), info: vi.fn(), error: vi.fn(), debug: vi.fn() } as unknown as Logger;
}

function licensing(inspect: () => Promise<{ allowed: boolean; inspections: [] }>): LicensingService {
  return { inspectPlatformAccess: inspect } as unknown as LicensingService;
}

function federation(options: { licensing: LicensingService | undefined; logger?: Logger }) {
  return ApiBetterAuthFederation.create({
    authProvider: "auth0",
    passkeysEnabled: false,
    isSaas: false,
    licensing: options.licensing,
    logger: options.logger ?? testLogger(),
  });
}

describe("ApiBetterAuthFederation", () => {
  /** @scenario "A licensed self-hosted deployment reports federation as licensed" */
  describe("given a self-hosted deployment whose licence carries federation", () => {
    it("reports federation as licensed", async () => {
      const inspect = vi.fn(async () => ({ allowed: true, inspections: [] as [] }));

      const policy = await federation({ licensing: licensing(inspect) }).resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(true);
    });

    /** @scenario "The license gate still freezes at startup" */
    it("inspects the licence once per process rather than once per request", async () => {
      const inspect = vi.fn(async () => ({ allowed: true, inspections: [] as [] }));
      const port = federation({ licensing: licensing(inspect) });

      await port.resolveSignInMethodPolicy();
      await port.resolveSignInMethodPolicy();

      expect(inspect).toHaveBeenCalledTimes(1);
    });
  });

  describe("given a self-hosted deployment with no valid licence", () => {
    it("reports federation as not licensed", async () => {
      const inspect = vi.fn(async () => ({ allowed: false, inspections: [] as [] }));

      const policy = await federation({ licensing: licensing(inspect) }).resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(false);
    });
  });

  describe("given a deployment that composed no licensing service", () => {
    /** @scenario "A deployment with no licensing service reports unlicensed and says so at boot" */
    it("reports federation as not licensed", async () => {
      const policy = await federation({ licensing: undefined }).resolveSignInMethodPolicy();

      expect(policy.federationLicensed).toBe(false);
    });
  });

  describe("when the licensing store is unreachable", () => {
    it("denies for this request and retries on the next", async () => {
      const inspect = vi
        .fn<() => Promise<{ allowed: boolean; inspections: [] }>>()
        .mockRejectedValueOnce(new Error("licence store down"))
        .mockResolvedValue({ allowed: true, inspections: [] });
      const port = federation({ licensing: licensing(inspect) });

      await expect(port.resolveSignInMethodPolicy()).resolves.toMatchObject({
        federationLicensed: false,
      });
      await expect(port.resolveSignInMethodPolicy()).resolves.toMatchObject({
        federationLicensed: true,
      });
    });
  });

  describe("given the hosted product", () => {
    it("reports federation as licensed without reading a licence at all", async () => {
      const inspect = vi.fn(async () => ({ allowed: false, inspections: [] as [] }));
      const port = ApiBetterAuthFederation.create({
        authProvider: "auth0",
        passkeysEnabled: false,
        isSaas: true,
        licensing: licensing(inspect),
        logger: testLogger(),
      });

      await expect(port.resolveSignInMethodPolicy()).resolves.toMatchObject({
        federationLicensed: true,
      });
      expect(inspect).not.toHaveBeenCalled();
    });
  });
});
