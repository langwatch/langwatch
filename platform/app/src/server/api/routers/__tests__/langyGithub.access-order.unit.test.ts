import { TRPCError } from "@trpc/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

// The langyGithub procedures chain checkOrganizationPermission("langy:manage")
// -> enforceOrganizationMembership -> enforceLangyAccess. This suite locks that
// ORDER: authorization must be settled before the org-scoped rollout flag, so a
// caller who fails it can't leak an arbitrary org's Langy rollout state
// (a denial-when-enabled that differs from denial-when-disabled would be a
// cross-tenant probe).
//
// The permission middleware is stubbed to a controllable gate — whether the
// role matrix grants `langy:manage` is pinned separately in
// `api/__tests__/rbac.langy.unit.test.ts`; what matters here is the sequence.
const {
  isOrganizationMember,
  getAllForOrganization,
  isEnabled,
  hasOrgPermission,
} = vi.hoisted(() => ({
  isOrganizationMember: vi.fn(),
  getAllForOrganization: vi.fn(),
  isEnabled: vi.fn(),
  hasOrgPermission: vi.fn(),
}));

vi.mock("~/server/api/rbac", async (importOriginal) => {
  const actual = await importOriginal<typeof import("~/server/api/rbac")>();
  return {
    ...actual,
    checkOrganizationPermission:
      () =>
      async ({ ctx, next }: any) => {
        if (!hasOrgPermission()) {
          // The top-level TRPCError binding is safe here: this closure runs
          // at request time, long after the hoisted factory phase.
          throw new TRPCError({
            code: "UNAUTHORIZED",
            message: "You do not have permission",
          });
        }
        ctx.permissionChecked = true;
        return next();
      },
  };
});

vi.mock("~/server/app-layer", () => ({
  getApp: () => ({
    langy: {
      githubInstallations: {
        configured: true,
        isOrganizationMember,
        getAllForOrganization,
      },
    },
  }),
}));
vi.mock("~/server/featureFlag", () => ({
  featureFlagService: { isEnabled },
}));
vi.mock("~/server/auditLog", () => ({ auditLog: vi.fn() }));

import { langyGithubRouter } from "../langyGithub";

const user = { id: "user-1", email: "user@example.com", emailVerified: true };

function caller() {
  return langyGithubRouter.createCaller(
    createInnerTRPCContext({
      session: { user, expires: "1" } as any,
      permissionChecked: false,
    }),
  );
}

describe("langyGithubRouter membership-before-rollout gate", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    getAllForOrganization.mockResolvedValue([]);
    hasOrgPermission.mockReturnValue(true);
  });

  describe("when the caller lacks langy:manage on the organization", () => {
    /** @scenario "Connecting the organization's GitHub App is admin-only" */
    it("is refused without ever evaluating the flag", async () => {
      hasOrgPermission.mockReturnValue(false);
      isOrganizationMember.mockResolvedValue(true);
      isEnabled.mockResolvedValue(true);

      await expect(
        caller().getInstallStatus({ organizationId: "org-1" }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when an authorized non-member probes an org with the rollout enabled", () => {
    it("throws FORBIDDEN without ever evaluating the flag", async () => {
      isOrganizationMember.mockResolvedValue(false);
      isEnabled.mockResolvedValue(true);

      await expect(
        caller().getInstallStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when an authorized non-member probes an org with the rollout disabled", () => {
    it("throws the same FORBIDDEN (response independent of the org's flag)", async () => {
      isOrganizationMember.mockResolvedValue(false);
      isEnabled.mockResolvedValue(false);

      await expect(
        caller().getInstallStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when an authorized member's org has the rollout enabled", () => {
    it("passes the gate (evaluated with the org scope) and returns install status", async () => {
      isOrganizationMember.mockResolvedValue(true);
      isEnabled.mockResolvedValue(true);

      const result = await caller().getInstallStatus({
        organizationId: "org-1",
      });

      expect(result).toMatchObject({ configured: true });
      expect(isEnabled).toHaveBeenCalledWith(
        "release_langy_enabled",
        expect.objectContaining({ organizationId: "org-1" }),
      );
    });
  });

  describe("when an authorized member's org has the rollout disabled", () => {
    it("throws NOT_FOUND from the gate after membership passes", async () => {
      isOrganizationMember.mockResolvedValue(true);
      isEnabled.mockResolvedValue(false);

      await expect(
        caller().getInstallStatus({ organizationId: "org-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
