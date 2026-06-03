/**
 * Unit tests for the SSO enforcement helper extracted from the BetterAuth
 * before-hook. These tests exercise `checkSsoEnforcement` in isolation by
 * injecting stub implementations of all database queries, so no real Prisma
 * client or BetterAuth instance is required.
 *
 * Spec: specs/auth/sso-phase1-enforcement.feature
 *   — Password Login Blocked by SSO Enforcement (scenarios 1–3)
 *   — Password Reset Blocked by SSO Enforcement (scenarios 4–5)
 */
import { describe, expect, it, vi } from "vitest";
import type { SsoEnforcementDeps } from "../sso-enforcement";
import { checkSsoEnforcement } from "../sso-enforcement";

function makeDeps(overrides: Partial<SsoEnforcementDeps> = {}): SsoEnforcementDeps {
  return {
    findOrgByDomain: vi.fn().mockResolvedValue(null),
    findEnforcedSsoProvider: vi.fn().mockResolvedValue(null),
    getActivePlanType: vi.fn().mockResolvedValue("ENTERPRISE"),
    isSoleAdmin: vi.fn().mockResolvedValue(false),
    ...overrides,
  };
}

/**
 * Helper that captures the thrown error from checkSsoEnforcement and asserts
 * it is an SSO_ENFORCED APIError. Avoids duplicating the try/catch in every
 * test that expects enforcement.
 */
async function expectSsoEnforcedError(
  params: Parameters<typeof checkSsoEnforcement>[0],
) {
  let thrown: unknown;
  try {
    await checkSsoEnforcement(params);
  } catch (err) {
    thrown = err;
  }
  expect(thrown).toBeDefined();
  // body.code is set by APIError.from() from the second argument
  expect((thrown as any).body?.code).toBe("SSO_ENFORCED");
  // status is "FORBIDDEN" (the first arg to APIError.from)
  expect((thrown as any).status).toBe("FORBIDDEN");
}

describe("checkSsoEnforcement", () => {
  describe("when SSO is enforced for the domain", () => {
    /** @scenario Password login is rejected when SSO is enforced for the domain */
    it("rejects /sign-in/email with SSO_ENFORCED when an enforced SsoProvider exists", async () => {
      const deps = makeDeps({
        findEnforcedSsoProvider: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
        getActivePlanType: vi.fn().mockResolvedValue("ENTERPRISE"),
        isSoleAdmin: vi.fn().mockResolvedValue(false),
      });

      await expectSsoEnforcedError({
        email: "alice@acme.com",
        path: "/api/auth/sign-in/email",
        deps,
      });
    });

    /** @scenario Password reset is rejected when SSO is enforced for the domain */
    it("rejects /request-password-reset with SSO_ENFORCED when an enforced SsoProvider exists", async () => {
      const deps = makeDeps({
        findEnforcedSsoProvider: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
        getActivePlanType: vi.fn().mockResolvedValue("ENTERPRISE"),
      });

      await expectSsoEnforcedError({
        email: "bob@acme.com",
        path: "/api/auth/request-password-reset",
        deps,
      });
    });
  });

  describe("when SSO is not enforced", () => {
    /** @scenario Password login succeeds when SSO is not enforced */
    it("allows /sign-in/email when connection exists but ssoEnforced is false (no enforced connection returned)", async () => {
      // findEnforcedSsoProvider only returns rows with ssoEnforced=true;
      // returning null simulates a connection where enforcement is off.
      const deps = makeDeps({
        findEnforcedSsoProvider: vi.fn().mockResolvedValue(null),
        findOrgByDomain: vi.fn().mockResolvedValue(null),
      });

      await expect(
        checkSsoEnforcement({
          email: "carol@acme.com",
          path: "/api/auth/sign-in/email",
          deps,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when no SSO connection exists for the domain", () => {
    /** @scenario Password login succeeds for domains without SSO */
    it("allows /sign-in/email when no SSO is configured for the domain", async () => {
      const deps = makeDeps({
        findOrgByDomain: vi.fn().mockResolvedValue(null),
        findEnforcedSsoProvider: vi.fn().mockResolvedValue(null),
      });

      await expect(
        checkSsoEnforcement({
          email: "dave@personal.example.com",
          path: "/api/auth/sign-in/email",
          deps,
        }),
      ).resolves.toBeUndefined();
    });

    /** @scenario Password reset succeeds for domains without SSO enforcement */
    it("allows /request-password-reset when no SSO enforcement exists for the domain", async () => {
      const deps = makeDeps({
        findOrgByDomain: vi.fn().mockResolvedValue(null),
        findEnforcedSsoProvider: vi.fn().mockResolvedValue(null),
      });

      await expect(
        checkSsoEnforcement({
          email: "eve@free.example.com",
          path: "/api/auth/request-password-reset",
          deps,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the enforced org is not on an enterprise plan", () => {
    it("allows login (silently degrades enforcement when license expires)", async () => {
      const deps = makeDeps({
        findEnforcedSsoProvider: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
        getActivePlanType: vi.fn().mockResolvedValue("FREE"),
      });

      await expect(
        checkSsoEnforcement({
          email: "frank@acme.com",
          path: "/api/auth/sign-in/email",
          deps,
        }),
      ).resolves.toBeUndefined();
    });

    it("allows reset (silently degrades enforcement when license expires)", async () => {
      const deps = makeDeps({
        findEnforcedSsoProvider: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
        getActivePlanType: vi.fn().mockResolvedValue("FREE"),
      });

      await expect(
        checkSsoEnforcement({
          email: "frank@acme.com",
          path: "/api/auth/request-password-reset",
          deps,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the user is the sole active admin (escape hatch)", () => {
    it("allows /sign-in/email even under enforcement", async () => {
      const deps = makeDeps({
        findEnforcedSsoProvider: vi.fn().mockResolvedValue({ organizationId: "org-1" }),
        getActivePlanType: vi.fn().mockResolvedValue("ENTERPRISE"),
        isSoleAdmin: vi.fn().mockResolvedValue(true),
      });

      await expect(
        checkSsoEnforcement({
          email: "sole-admin@acme.com",
          path: "/api/auth/sign-in/email",
          deps,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the email is missing", () => {
    it("does not throw and returns without performing any lookups", async () => {
      const deps = makeDeps();

      await expect(
        checkSsoEnforcement({ email: undefined, path: "/api/auth/sign-in/email", deps }),
      ).resolves.toBeUndefined();

      expect(deps.findEnforcedSsoProvider).not.toHaveBeenCalled();
    });
  });
});
