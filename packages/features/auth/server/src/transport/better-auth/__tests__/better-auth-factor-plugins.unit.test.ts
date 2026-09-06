/**
 * The two-step verification and passkey plugins mount only when their deployment flag is
 * on (D06/D07). Both default off, so the check imports the instance under each setting
 * rather than trusting one that happens to pass because nothing was ever turned on.
 */
import { describe, expect, it } from "vitest";
import type { BetterAuthDeploymentConfiguration } from "../better-auth.api";
import { betterAuthTransportFor } from "./better-auth-transport.test-helpers";

function pluginIdsFor(overrides: Partial<BetterAuthDeploymentConfiguration>): string[] {
  const auth = betterAuthTransportFor(overrides);
  return ((auth.options?.plugins ?? []) as Array<{ id?: string }>).map((p) => p.id ?? "");
}

describe("the deployment's Better Auth factor plugins", () => {
  describe("given both flags are off", () => {
    /**
     * @scenario "With the flag off nothing about two-step verification exists"
     * @scenario "With the flag off, passkeys do not exist"
     */
    it("mounts neither plugin", () => {
      const ids = pluginIdsFor({});
      expect(ids).not.toContain("two-factor");
      expect(ids).not.toContain("passkey");
    });
  });

  describe("given the two-step verification flag is on", () => {
    it("mounts the two-factor plugin only", () => {
      const ids = pluginIdsFor({ mfaEnrollmentOpen: true });
      expect(ids).toContain("two-factor");
      expect(ids).not.toContain("passkey");
    });
  });

  describe("given the passkeys flag is on", () => {
    it("mounts the passkey plugin only", () => {
      const ids = pluginIdsFor({ passkeysEnabled: true });
      expect(ids).toContain("passkey");
      expect(ids).not.toContain("two-factor");
    });
  });
});
