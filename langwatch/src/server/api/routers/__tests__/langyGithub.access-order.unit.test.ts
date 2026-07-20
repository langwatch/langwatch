import { beforeEach, describe, expect, it, vi } from "vitest";
import { createInnerTRPCContext } from "../../trpc";

// The langyGithub procedures chain authorizeInResolver -> enforceOrganizationMembership
// -> enforceLangyAccess. This suite locks that ORDER: membership must be proven
// before the org-scoped rollout flag, so a non-member's response can't leak an
// arbitrary org's Langy rollout state (FORBIDDEN-when-enabled vs
// NOT_FOUND-when-disabled would be a cross-tenant probe).
const { isOrganizationMember, getAllForOrganization, isEnabled } = vi.hoisted(
  () => ({
    isOrganizationMember: vi.fn(),
    getAllForOrganization: vi.fn(),
    isEnabled: vi.fn(),
  }),
);

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
  });

  describe("when a non-member probes an org with the rollout enabled", () => {
    it("throws FORBIDDEN without ever evaluating the flag", async () => {
      isOrganizationMember.mockResolvedValue(false);
      isEnabled.mockResolvedValue(true);

      await expect(
        caller().getInstallStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when a non-member probes an org with the rollout disabled", () => {
    it("throws the same FORBIDDEN (response independent of the org's flag)", async () => {
      isOrganizationMember.mockResolvedValue(false);
      isEnabled.mockResolvedValue(false);

      await expect(
        caller().getInstallStatus({ organizationId: "victim-org" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      expect(isEnabled).not.toHaveBeenCalled();
    });
  });

  describe("when a non-staff member's org has the rollout enabled", () => {
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

  describe("when a non-staff member's org has the rollout disabled", () => {
    it("throws NOT_FOUND from the gate after membership passes", async () => {
      isOrganizationMember.mockResolvedValue(true);
      isEnabled.mockResolvedValue(false);

      await expect(
        caller().getInstallStatus({ organizationId: "org-1" }),
      ).rejects.toMatchObject({ code: "NOT_FOUND" });
    });
  });
});
