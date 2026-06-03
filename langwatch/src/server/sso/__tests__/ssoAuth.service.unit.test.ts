import { beforeEach, describe, expect, it, vi } from "vitest";

const repoMock = vi.hoisted(() => ({
  isUserDeactivated: vi.fn(),
  findMembership: vi.fn(),
  createMembership: vi.fn(),
  updateMembershipRole: vi.fn(),
}));

vi.mock("../ssoAuth.repository", () => ({
  SsoAuthRepository: { create: () => repoMock },
}));

import { SsoAuthService, SsoLoginRejectedError } from "../ssoAuth.service";
import type { SsoProvisioningPolicy } from "../ssoAuth.service";

const service = SsoAuthService.create({} as never);

const basePolicy: SsoProvisioningPolicy = {
  organizationId: "org_1",
  jitProvisioning: false,
  defaultOrgRole: "MEMBER",
  roleMapping: null,
};

const provision = (overrides: {
  policy?: Partial<SsoProvisioningPolicy>;
  rawClaims?: Record<string, unknown>;
}) =>
  service.provisionSsoUser({
    userId: "user_1",
    policy: { ...basePolicy, ...overrides.policy },
    rawClaims: overrides.rawClaims ?? {},
  });

describe("SsoAuthService.provisionSsoUser", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    repoMock.isUserDeactivated.mockResolvedValue(false);
    repoMock.findMembership.mockResolvedValue(null);
  });

  describe("given the provider is not linked to an organization", () => {
    it("returns without provisioning anything", async () => {
      await provision({ policy: { organizationId: null } });
      expect(repoMock.findMembership).not.toHaveBeenCalled();
      expect(repoMock.createMembership).not.toHaveBeenCalled();
    });
  });

  describe("given the user is deactivated", () => {
    it("rejects the login", async () => {
      repoMock.isUserDeactivated.mockResolvedValue(true);
      await expect(provision({})).rejects.toMatchObject({
        name: "SsoLoginRejectedError",
        reason: "deactivated",
      });
      expect(repoMock.createMembership).not.toHaveBeenCalled();
    });
  });

  describe("given no membership and JIT provisioning is off", () => {
    it("rejects the login as not provisioned", async () => {
      await expect(
        provision({ policy: { jitProvisioning: false } }),
      ).rejects.toBeInstanceOf(SsoLoginRejectedError);
      await expect(
        provision({ policy: { jitProvisioning: false } }),
      ).rejects.toMatchObject({ reason: "not_provisioned" });
    });
  });

  describe("given no membership and JIT provisioning is on", () => {
    it("creates the membership at the default role", async () => {
      await provision({
        policy: { jitProvisioning: true, defaultOrgRole: "MEMBER" },
      });
      expect(repoMock.createMembership).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
        role: "MEMBER",
      });
    });

    it("does not re-apply role mapping over the freshly-created default role", async () => {
      await provision({ policy: { jitProvisioning: true } });
      expect(repoMock.updateMembershipRole).not.toHaveBeenCalled();
    });
  });

  describe("given an existing non-SCIM membership", () => {
    it("promotes the user when their IdP group maps to ADMIN", async () => {
      repoMock.findMembership.mockResolvedValue({
        role: "MEMBER",
        scimManaged: false,
      });
      await provision({
        policy: {
          roleMapping: {
            groupMappings: [{ group: "platform-admins", role: "ADMIN" }],
          },
        },
        rawClaims: { groups: ["platform-admins"] },
      });
      expect(repoMock.updateMembershipRole).toHaveBeenCalledWith({
        userId: "user_1",
        organizationId: "org_1",
        role: "ADMIN",
      });
    });

    it("leaves the role unchanged when no mapping matches", async () => {
      repoMock.findMembership.mockResolvedValue({
        role: "MEMBER",
        scimManaged: false,
      });
      await provision({ rawClaims: { groups: ["unmapped"] } });
      expect(repoMock.updateMembershipRole).not.toHaveBeenCalled();
    });
  });

  describe("given a SCIM-managed membership", () => {
    it("never overrides the directory-owned role", async () => {
      repoMock.findMembership.mockResolvedValue({
        role: "MEMBER",
        scimManaged: true,
      });
      await provision({
        policy: {
          roleMapping: {
            groupMappings: [{ group: "admins", role: "ADMIN" }],
          },
        },
        rawClaims: { groups: ["admins"] },
      });
      expect(repoMock.updateMembershipRole).not.toHaveBeenCalled();
    });
  });
});
