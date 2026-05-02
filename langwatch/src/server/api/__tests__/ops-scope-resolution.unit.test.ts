/**
 * @vitest-environment node
 *
 * Unit tests for the OpsScope modeling change (lw#3584).
 *
 * - resolveOpsScope is now total: it returns `{ kind: "none" }` for non-ops
 *   users instead of null. The middleware (`checkOpsPermission`) still
 *   throws FORBIDDEN on `kind: "none"` so mutating endpoints stay guarded.
 * - The `getScope` status probe bypasses the middleware so non-ops users
 *   no longer get FORBIDDEN noise on every page load.
 */

import { describe, it, expect, vi } from "vitest";

// Pre-stub the admin lookup so the test isn't coupled to ADMIN_EMAILS env.
vi.mock("../../../../ee/admin/isAdmin", () => ({
  isAdmin: ({ email }: { email: string | null | undefined }) =>
    email === "admin@langwatch.ai",
}));

// We import after the mock so the module sees our stubbed isAdmin.
import { resolveOpsScope, checkOpsPermission } from "../rbac";

describe("resolveOpsScope (lw#3584)", () => {
  describe("when the caller is a non-admin user", () => {
    /** @scenario resolveOpsScope returns kind=none for non-ops users instead of null */
    it("returns { kind: 'none' } so the response is data, not an error", () => {
      const scope = resolveOpsScope({
        userId: "user-1",
        userEmail: "person@example.com",
        permission: "ops:view",
        prisma: {} as unknown,
      });
      expect(scope).toEqual({ kind: "none" });
    });
  });

  describe("when the caller is an admin user", () => {
    /** @scenario resolveOpsScope returns kind=platform for admin users */
    it("returns { kind: 'platform' }", () => {
      const scope = resolveOpsScope({
        userId: "admin-1",
        userEmail: "admin@langwatch.ai",
        permission: "ops:view",
        prisma: {} as unknown,
      });
      expect(scope).toEqual({ kind: "platform" });
    });
  });
});

describe("checkOpsPermission middleware (lw#3584)", () => {
  function fakeCtx(email: string | null) {
    return {
      session: { user: { id: "u1", email } },
      prisma: {} as unknown,
    } as unknown as Parameters<ReturnType<typeof checkOpsPermission>>[0]["ctx"];
  }

  /** @scenario checkOpsPermission still throws FORBIDDEN for non-ops callers */
  it("throws FORBIDDEN when resolveOpsScope returns kind=none (default behavior)", async () => {
    const middleware = checkOpsPermission("ops:view");
    const next = vi.fn();
    await expect(
      middleware({
        ctx: fakeCtx("person@example.com"),
        input: undefined,
        next,
      } as unknown as Parameters<ReturnType<typeof checkOpsPermission>>[0]),
    ).rejects.toThrow(/permission to access ops/);
    expect(next).not.toHaveBeenCalled();
  });

  /** @scenario checkOpsPermission grants access for admin callers */
  it("grants access (calls next, populates ctx.opsScope) for admin callers", async () => {
    const middleware = checkOpsPermission("ops:view");
    const next = vi.fn().mockResolvedValue("OK");
    const ctx = fakeCtx("admin@langwatch.ai");
    const result = await middleware({
      ctx,
      input: undefined,
      next,
    } as unknown as Parameters<ReturnType<typeof checkOpsPermission>>[0]);
    expect(result).toBe("OK");
    expect(next).toHaveBeenCalledTimes(1);
    expect((ctx as { opsScope?: unknown }).opsScope).toEqual({
      kind: "platform",
    });
  });

  /** @scenario checkOpsPermission with throwOnDeny=false populates kind=none for status probes */
  it("with throwOnDeny=false: calls next with ctx.opsScope.kind=none for non-ops callers", async () => {
    const middleware = checkOpsPermission("ops:view", { throwOnDeny: false });
    const next = vi.fn().mockResolvedValue("OK");
    const ctx = fakeCtx("person@example.com");
    const result = await middleware({
      ctx,
      input: undefined,
      next,
    } as unknown as Parameters<ReturnType<typeof checkOpsPermission>>[0]);
    expect(result).toBe("OK");
    expect(next).toHaveBeenCalledTimes(1);
    expect((ctx as { opsScope?: unknown }).opsScope).toEqual({
      kind: "none",
    });
  });
});
