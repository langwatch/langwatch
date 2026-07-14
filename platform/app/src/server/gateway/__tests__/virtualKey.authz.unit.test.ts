import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  assertCanManageAllScopes,
  assertCanOperateOnAnyScope,
  type RBACContext,
  type Scope,
} from "../virtualKey.authz";

vi.mock("~/server/api/rbac", () => ({
  hasOrganizationPermission: vi.fn(),
  hasTeamPermission: vi.fn(),
  hasProjectPermission: vi.fn(),
}));

import {
  hasOrganizationPermission,
  hasProjectPermission,
  hasTeamPermission,
} from "~/server/api/rbac";

const orgPerm = vi.mocked(hasOrganizationPermission);
const teamPerm = vi.mocked(hasTeamPermission);
const projectPerm = vi.mocked(hasProjectPermission);

const ctx = {
  prisma: {} as RBACContext["prisma"],
  session: { user: { id: "usr_1" } },
} as unknown as RBACContext;

const ORG: Scope = { scopeType: "ORGANIZATION", scopeId: "org_acme" };
const TEAM_PLATFORM: Scope = { scopeType: "TEAM", scopeId: "team_platform" };
const TEAM_DATA_SCI: Scope = { scopeType: "TEAM", scopeId: "team_data_sci" };
const PROJECT_DEMO: Scope = { scopeType: "PROJECT", scopeId: "proj_demo" };

beforeEach(() => {
  orgPerm.mockReset();
  teamPerm.mockReset();
  projectPerm.mockReset();
  orgPerm.mockResolvedValue(false);
  teamPerm.mockResolvedValue(false);
  projectPerm.mockResolvedValue(false);
});

describe("assertCanManageAllScopes", () => {
  describe("when the caller has virtualKeys:manage on every requested scope", () => {
    it("resolves without throwing", async () => {
      teamPerm.mockResolvedValue(true);
      await expect(
        assertCanManageAllScopes(ctx, [TEAM_PLATFORM, TEAM_DATA_SCI]),
      ).resolves.toBeUndefined();
      expect(teamPerm).toHaveBeenCalledWith(
        ctx,
        "team_platform",
        "virtualKeys:manage",
      );
    });
  });

  describe("when the caller lacks manage on one of the requested scopes", () => {
    it("throws FORBIDDEN naming the unauthorized scope", async () => {
      // manage on platform, not on data-sci
      teamPerm.mockImplementation(async (_ctx, scopeId) => scopeId === "team_platform");
      await expect(
        assertCanManageAllScopes(ctx, [TEAM_PLATFORM, TEAM_DATA_SCI]),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message: "permission_denied: virtualKeys:manage at TEAM:team_data_sci",
      });
    });
  });

  describe("when an ORGANIZATION-scoped create is requested", () => {
    it("checks virtualKeys:manage at the organization scope", async () => {
      orgPerm.mockResolvedValue(true);
      await expect(
        assertCanManageAllScopes(ctx, [ORG]),
      ).resolves.toBeUndefined();
      expect(orgPerm).toHaveBeenCalledWith(
        { prisma: ctx.prisma, session: ctx.session },
        "org_acme",
        "virtualKeys:manage",
      );
    });
  });

  describe("when there is no session", () => {
    it("throws FORBIDDEN without consulting the rbac helpers", async () => {
      const anon = { prisma: ctx.prisma, session: null };
      await expect(
        assertCanManageAllScopes(anon, [ORG]),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(orgPerm).not.toHaveBeenCalled();
    });
  });
});

describe("assertCanOperateOnAnyScope", () => {
  describe("when the caller holds the op permission on at least one scope", () => {
    it("resolves without throwing", async () => {
      projectPerm.mockResolvedValue(true);
      await expect(
        assertCanOperateOnAnyScope(
          ctx,
          [TEAM_PLATFORM, PROJECT_DEMO],
          "virtualKeys:update",
        ),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the caller holds the op permission on none of the scopes", () => {
    it("throws FORBIDDEN naming the permission", async () => {
      await expect(
        assertCanOperateOnAnyScope(ctx, [TEAM_PLATFORM], "virtualKeys:delete"),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        message:
          "permission_denied: virtualKeys:delete at one of the virtual key's scopes",
      });
    });
  });

  it("surfaces a TRPCError instance for callers that switch on code", async () => {
    const err = await assertCanOperateOnAnyScope(
      ctx,
      [TEAM_PLATFORM],
      "virtualKeys:rotate",
    ).catch((e) => e);
    expect(err).toBeInstanceOf(TRPCError);
  });
});
