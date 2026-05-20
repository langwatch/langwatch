import { OrganizationUserRole } from "@prisma/client";
import { beforeEach, describe, expect, it, vi } from "vitest";

const resolveProjectPermissionMock = vi.fn();

vi.mock("~/server/api/rbac", () => ({
  resolveProjectPermission: (...args: unknown[]) =>
    resolveProjectPermissionMock(...args),
}));

import { requireProjectPermission } from "../permissions";
import { LiteMemberRestrictedError } from "~/server/app-layer/permissions/errors";

const prisma = {} as any;

beforeEach(() => {
  resolveProjectPermissionMock.mockReset();
});

describe("requireProjectPermission", () => {
  describe("when the user is a project member with the permission", () => {
    it("resolves", async () => {
      resolveProjectPermissionMock.mockResolvedValueOnce({
        permitted: true,
        organizationRole: OrganizationUserRole.MEMBER,
      });

      await expect(
        requireProjectPermission({
          userId: "user_1",
          projectId: "proj_1",
          permission: "traces:view",
          prisma,
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the user is not a member", () => {
    it("throws", async () => {
      resolveProjectPermissionMock.mockResolvedValueOnce({
        permitted: false,
        organizationRole: null,
      });

      await expect(
        requireProjectPermission({
          userId: "user_not_member",
          projectId: "proj_1",
          permission: "traces:view",
          prisma,
        }),
      ).rejects.toThrow("You do not have permission to access this project resource");
    });
  });

  describe("when the user is a member but lacks the permission", () => {
    it("throws", async () => {
      resolveProjectPermissionMock.mockResolvedValueOnce({
        permitted: false,
        organizationRole: OrganizationUserRole.MEMBER,
      });

      await expect(
        requireProjectPermission({
          userId: "user_viewer",
          projectId: "proj_1",
          permission: "project:delete",
          prisma,
        }),
      ).rejects.toThrow("You do not have permission to access this project resource");
    });
  });

  describe("when the user is a Lite Member (EXTERNAL) and is denied", () => {
    it("throws LiteMemberRestrictedError", async () => {
      resolveProjectPermissionMock.mockResolvedValueOnce({
        permitted: false,
        organizationRole: OrganizationUserRole.EXTERNAL,
      });

      await expect(
        requireProjectPermission({
          userId: "user_lite",
          projectId: "proj_1",
          permission: "scenarios:manage",
          prisma,
        }),
      ).rejects.toBeInstanceOf(LiteMemberRestrictedError);
    });
  });
});
