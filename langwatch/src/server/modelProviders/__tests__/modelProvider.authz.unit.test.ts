import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const hasOrganizationPermissionMock = vi.fn();
const hasTeamPermissionMock = vi.fn();
const hasProjectPermissionMock = vi.fn();

vi.mock("../../api/rbac", () => ({
  hasOrganizationPermission: (...args: unknown[]) =>
    hasOrganizationPermissionMock(...args),
  hasTeamPermission: (...args: unknown[]) => hasTeamPermissionMock(...args),
  hasProjectPermission: (...args: unknown[]) =>
    hasProjectPermissionMock(...args),
}));

import {
  assertCanManageAllScopes,
  assertCanManageScope,
  canReadAnyScope,
  requiredManagePermission,
} from "../modelProvider.authz";

const ctx = {
  prisma: {} as any,
  session: { user: { id: "u_1" } } as any,
};

beforeEach(() => {
  hasOrganizationPermissionMock.mockReset();
  hasTeamPermissionMock.mockReset();
  hasProjectPermissionMock.mockReset();
});

describe("requiredManagePermission", () => {
  it("maps each scope tier to its manage permission", () => {
    expect(requiredManagePermission("ORGANIZATION")).toBe(
      "organization:manage",
    );
    expect(requiredManagePermission("TEAM")).toBe("team:manage");
    expect(requiredManagePermission("PROJECT")).toBe("project:manage");
  });
});

describe("assertCanManageScope", () => {
  describe("given the caller has the right manage permission", () => {
    it("resolves silently for ORGANIZATION scope", async () => {
      hasOrganizationPermissionMock.mockResolvedValueOnce(true);
      await expect(
        assertCanManageScope(ctx, {
          scopeType: "ORGANIZATION",
          scopeId: "org_acme",
        }),
      ).resolves.toBeUndefined();
      expect(hasOrganizationPermissionMock).toHaveBeenCalledWith(
        expect.objectContaining({ prisma: expect.anything() }),
        "org_acme",
        "organization:manage",
      );
    });

    it("resolves silently for TEAM scope", async () => {
      hasTeamPermissionMock.mockResolvedValueOnce(true);
      await expect(
        assertCanManageScope(ctx, {
          scopeType: "TEAM",
          scopeId: "team_platform",
        }),
      ).resolves.toBeUndefined();
      expect(hasTeamPermissionMock).toHaveBeenCalledWith(
        ctx,
        "team_platform",
        "team:manage",
      );
    });

    it("resolves silently for PROJECT scope", async () => {
      hasProjectPermissionMock.mockResolvedValueOnce(true);
      await expect(
        assertCanManageScope(ctx, {
          scopeType: "PROJECT",
          scopeId: "proj_web",
        }),
      ).resolves.toBeUndefined();
      expect(hasProjectPermissionMock).toHaveBeenCalledWith(
        ctx,
        "proj_web",
        "project:manage",
      );
    });
  });

  describe("given the caller lacks the permission", () => {
    it("throws FORBIDDEN with the permission name in the message", async () => {
      hasTeamPermissionMock.mockResolvedValueOnce(false);
      await expect(
        assertCanManageScope(ctx, {
          scopeType: "TEAM",
          scopeId: "team_marketing",
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: expect.stringContaining("team:manage"),
      });
    });

    it("throws TRPCError specifically (so tRPC maps to 403)", async () => {
      hasOrganizationPermissionMock.mockResolvedValueOnce(false);
      await expect(
        assertCanManageScope(ctx, {
          scopeType: "ORGANIZATION",
          scopeId: "org_beta",
        }),
      ).rejects.toBeInstanceOf(TRPCError);
    });
  });

  describe("given no session on the ctx", () => {
    it("rejects before calling the RBAC helper", async () => {
      await expect(
        assertCanManageScope(
          { prisma: {} as any, session: null },
          { scopeType: "ORGANIZATION", scopeId: "org_x" },
        ),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(hasOrganizationPermissionMock).not.toHaveBeenCalled();
    });
  });
});

describe("assertCanManageAllScopes", () => {
  describe("when every entry passes authz", () => {
    it("resolves without throwing", async () => {
      hasOrganizationPermissionMock.mockResolvedValue(true);
      hasTeamPermissionMock.mockResolvedValue(true);
      await expect(
        assertCanManageAllScopes(ctx, [
          { scopeType: "ORGANIZATION", scopeId: "org_acme" },
          { scopeType: "TEAM", scopeId: "team_platform" },
        ]),
      ).resolves.toBeUndefined();
    });
  });

  describe("when one entry fails authz mid-list", () => {
    it("rejects atomically on the failing scope", async () => {
      hasOrganizationPermissionMock.mockResolvedValueOnce(true);
      hasTeamPermissionMock.mockResolvedValueOnce(false); // marketing fails

      await expect(
        assertCanManageAllScopes(ctx, [
          { scopeType: "ORGANIZATION", scopeId: "org_acme" },
          { scopeType: "TEAM", scopeId: "team_marketing" },
          { scopeType: "PROJECT", scopeId: "proj_x" },
        ]),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      // Short-circuits: never gets to the PROJECT check.
      expect(hasProjectPermissionMock).not.toHaveBeenCalled();
    });
  });
});

describe("canReadAnyScope", () => {
  it("returns true when at least one scope is readable", async () => {
    hasOrganizationPermissionMock.mockResolvedValueOnce(false);
    hasTeamPermissionMock.mockResolvedValueOnce(true);
    expect(
      await canReadAnyScope(ctx, [
        { scopeType: "ORGANIZATION", scopeId: "org_a" },
        { scopeType: "TEAM", scopeId: "team_b" },
      ]),
    ).toBe(true);
  });

  it("returns false when no scope is readable", async () => {
    hasOrganizationPermissionMock.mockResolvedValue(false);
    hasTeamPermissionMock.mockResolvedValue(false);
    hasProjectPermissionMock.mockResolvedValue(false);
    expect(
      await canReadAnyScope(ctx, [
        { scopeType: "ORGANIZATION", scopeId: "org_a" },
        { scopeType: "TEAM", scopeId: "team_b" },
        { scopeType: "PROJECT", scopeId: "proj_c" },
      ]),
    ).toBe(false);
  });

  it("returns false for an empty scope set", async () => {
    expect(await canReadAnyScope(ctx, [])).toBe(false);
  });

  it("returns false when session is missing", async () => {
    expect(
      await canReadAnyScope({ prisma: {} as any, session: null }, [
        { scopeType: "PROJECT", scopeId: "proj_x" },
      ]),
    ).toBe(false);
  });
});
