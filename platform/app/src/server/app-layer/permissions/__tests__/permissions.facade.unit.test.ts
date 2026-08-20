/** @vitest-environment node */

/**
 * The typed imperative facade (ADR-092 decision 25): the scope argument is
 * derived from the permission's registry tiers, and the runtime decides
 * through the same fork-aware resolvers the declared `.permission()` runs.
 * The `@ts-expect-error` lines are compile-time assertions enforced by
 * `pnpm typecheck:tests`.
 */
import { PermissionDeniedError } from "@langwatch/authz";
import { describe, expect, it, vi } from "vitest";

const resolveProjectPermission = vi.fn();
const resolveTeamPermission = vi.fn();
const hasOrganizationPermission = vi.fn();

vi.mock("~/server/api/rbac", () => ({
  resolveProjectPermission: (...args: unknown[]) =>
    resolveProjectPermission(...args),
  resolveTeamPermission: (...args: unknown[]) => resolveTeamPermission(...args),
  hasOrganizationPermission: (...args: unknown[]) =>
    hasOrganizationPermission(...args),
}));

const { PermissionsService } = await import("../permissions.service");

const service = new PermissionsService({} as never);

describe("PermissionsService typed facade", () => {
  describe("when an imperative check names its scope id", () => {
    /** @scenario "An imperative check names its scope id to match the permission" */
    it("decides through the tier's fork-aware resolver", async () => {
      resolveProjectPermission.mockResolvedValue({
        permitted: true,
        organizationRole: "MEMBER",
      });
      await expect(
        service.hasPermission({
          userId: "alice",
          permission: "traces:view",
          projectId: "proj-1",
        }),
      ).resolves.toBe(true);
      expect(resolveProjectPermission).toHaveBeenCalledWith(
        expect.anything(),
        "proj-1",
        "traces:view",
      );

      hasOrganizationPermission.mockResolvedValue(false);
      await expect(
        service.requirePermission({
          userId: "alice",
          permission: "organization:manage",
          organizationId: "org-1",
        }),
      ).rejects.toBeInstanceOf(PermissionDeniedError);
    });

    it("refuses tier-mismatched scope ids at compile time", () => {
      void service.hasPermission({
        userId: "alice",
        permission: "governance:view",
        // @ts-expect-error — governance is organization-only; a projectId is a category error
        projectId: "proj-1",
      });
      // @ts-expect-error — exactly one scope id: two at once is ambiguous
      void service.hasPermission({
        userId: "alice",
        permission: "traces:view",
        projectId: "proj-1",
        organizationId: "org-1",
      });
      // @ts-expect-error — ops is platform-tier; no scope id can address it
      void service.hasPermission({
        userId: "alice",
        permission: "ops:view",
        organizationId: "org-1",
      });
      expect(true).toBe(true);
    });
  });
});
