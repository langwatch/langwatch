/**
 * `composeOpsCheck`'s scope resolution and throw semantics, isolated from the
 * real /api/trpc handler — lw#3584's status-probe variant lives here because
 * the real-handler suite only ever calls it through `ops.getScope`.
 */
import { describe, expect, it, vi } from "vitest";

import { composeOpsCheck } from "../ops.composition";

const ADMIN_EMAIL = "admin@acme.test";

function opsApp() {
  return {
    isAdmin: ({ email }: { email?: string | null }) => email === ADMIN_EMAIL,
  };
}

function contextFor(email: string | null) {
  return { session: { user: { email } } } as {
    session?: { user?: { email?: string | null } } | null;
    opsScope?: { kind: "platform" | "none" };
    permissionChecked?: boolean;
  };
}

describe("given composeOpsCheck's declared middleware", () => {
  describe("when the caller is not on the allow-list", () => {
    /** @scenario "resolveOpsScope returns kind=none for non-ops users instead of null" */
    /** @scenario "checkOpsPermission with throwOnDeny=false populates kind=none for status probes" */
    it("populates kind=none and invokes next when throwOnDeny is false", async () => {
      const check = composeOpsCheck(opsApp())({ permission: "ops:view", throwOnDeny: false });
      const ctx = contextFor("nobody@acme.test");
      const next = vi.fn().mockResolvedValue("ok");

      await check({ ctx, next } as never);

      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.opsScope).toEqual({ kind: "none" });
    });

    /** @scenario "checkOpsPermission still throws FORBIDDEN for non-ops callers" */
    it("throws forbidden and never invokes next when throwOnDeny defaults true", async () => {
      const check = composeOpsCheck(opsApp())({ permission: "ops:manage" });
      const ctx = contextFor("nobody@acme.test");
      const next = vi.fn().mockResolvedValue("ok");

      await expect(check({ ctx, next } as never)).rejects.toMatchObject({ code: "forbidden" });
      expect(next).not.toHaveBeenCalled();
    });
  });

  describe("when the caller is on the allow-list", () => {
    /** @scenario "resolveOpsScope returns kind=platform for admin users" */
    /** @scenario "checkOpsPermission grants access for admin callers" */
    it("populates kind=platform and invokes next", async () => {
      const check = composeOpsCheck(opsApp())({ permission: "ops:view" });
      const ctx = contextFor(ADMIN_EMAIL);
      const next = vi.fn().mockResolvedValue("ok");

      await check({ ctx, next } as never);

      expect(next).toHaveBeenCalledTimes(1);
      expect(ctx.opsScope).toEqual({ kind: "platform" });
    });
  });
});
