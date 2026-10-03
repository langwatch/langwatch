/**
 * @vitest-environment node
 *
 * The sign-up policy on the paths better-auth creates a user through: the
 * social and generic OAuth callbacks and the single sign-on plugin.
 * @see specs/auth/sign-up-restriction.feature
 */
import type { SignUpVerdict } from "@langwatch/organization-contract";
import { describe, expect, it, vi } from "vitest";

import {
  createBeforeUserCreateHook,
  SIGN_UP_RESTRICTED_CODE,
} from "../../channels/http/http.better-auth-hooks.channel.ts";

function userCreateBefore({
  verdict,
  governingConnections = [],
}: {
  verdict: SignUpVerdict;
  governingConnections?: readonly string[];
}) {
  const checkSignUp = vi.fn(async () => verdict);
  const findGoverningConnections = vi.fn(async () => governingConnections);
  const before = createBeforeUserCreateHook({
    policy: { checkSignUp },
    findGoverningConnections,
  });

  const create = (email: string, extra: Record<string, unknown> = {}) =>
    Reflect.apply(before, null, [{ email, name: "Sam", ...extra }, null]);

  return { create, checkSignUp, findGoverningConnections };
}

const REFUSED: SignUpVerdict = { allowed: false, reason: "invite_only" };
const ADMITTED: SignUpVerdict = { allowed: true, via: "invitation" };

describe("user.create.before", () => {
  describe("when the sign-up policy refuses the address", () => {
    /** @scenario "An identity provider sign-in for an uninvited address creates no account" */
    it("refuses with the restricted code the sign-in error page renders", async () => {
      const { create, checkSignUp } = userCreateBefore({ verdict: REFUSED });

      await expect(create("stranger@example.com")).rejects.toMatchObject({
        body: { code: SIGN_UP_RESTRICTED_CODE },
      });
      expect(checkSignUp).toHaveBeenCalledWith({ email: "stranger@example.com" });
    });
  });

  describe("when an organization's own connection governs the address", () => {
    /** @scenario "An address an organization's own SSO connection governs is not restricted" */
    it("creates the account even though the policy refuses the address", async () => {
      const { create, checkSignUp } = userCreateBefore({
        verdict: REFUSED,
        governingConnections: ["ssoc_acme"],
      });

      await expect(create("sam@acme.com")).resolves.toBeUndefined();
      expect(checkSignUp).toHaveBeenCalled();
    });
  });

  describe("when the policy admits the address", () => {
    it("creates the account without asking which connection governs it", async () => {
      const { create, findGoverningConnections } = userCreateBefore({ verdict: ADMITTED });

      await expect(create("sam@acme.com")).resolves.toBeUndefined();
      expect(findGoverningConnections).not.toHaveBeenCalled();
    });
  });

  describe("when the account being created is deactivated", () => {
    it("blocks it before the policy is asked", async () => {
      const { create, checkSignUp } = userCreateBefore({ verdict: ADMITTED });

      await expect(create("sam@acme.com", { deactivatedAt: new Date(0) })).resolves.toBe(false);
      expect(checkSignUp).not.toHaveBeenCalled();
    });
  });
});
