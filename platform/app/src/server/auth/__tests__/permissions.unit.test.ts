import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationUserRole } from "~/generated/prisma/client";

const resolveProjectPermissionMock = vi.fn();

// The App-composed permissions double reads all three legacy resolvers when it
// answers a decision; only the project one decides anything here, and the other
// two exist so destructuring the module does not throw before it is reached.
vi.mock("~/server/api/rbac", () => ({
  resolveProjectPermission: (...args: unknown[]) => resolveProjectPermissionMock(...args),
  resolveTeamPermission: vi.fn(),
  hasOrganizationPermission: vi.fn(),
}));

// The wrapper resolves its service from the App.
vi.mock("~/server/app-layer/app", async () => {
  const { appPermissionsMock } = await import("~/test-utils/appPermissionsMock");
  return appPermissionsMock();
});

import { requireProjectPermission } from "../permissions";

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
        }),
      ).resolves.toBeUndefined();
    });
  });

  describe("when the user is not a member", () => {
    /**
     * A denial is knowable and the caller can act on it — ask an admin for the
     * permission `meta` names — so it is a handled error, not the bare `Error`
     * it used to be. Asserted on `code` and `meta`, never on the sentence: a
     * route once told a 403 from a 500 by comparing that sentence word for
     * word, which is exactly what this shape exists to stop.
     */
    /** @scenario "A project permission denial names itself" */
    it("refuses with a code, the customer's fault, and the permission", async () => {
      resolveProjectPermissionMock.mockResolvedValueOnce({
        permitted: false,
        organizationRole: null,
      });

      await expect(
        requireProjectPermission({
          userId: "user_not_member",
          projectId: "proj_1",
          permission: "traces:view",
        }),
      ).rejects.toMatchObject({
        code: "project_permission_denied",
        httpStatus: 403,
        fault: "customer",
        meta: { permission: "traces:view" },
      });
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
        }),
      ).rejects.toMatchObject({ code: "project_permission_denied" });
    });
  });

  describe("when the user is a Lite Member (EXTERNAL) and is denied", () => {
    /**
     * Asserted on `code`, not `instanceof`. Two classes named
     * `LiteMemberRestrictedError` exist — the legacy one in
     * `~/server/app-layer/permissions/errors` that `~/server/api/rbac` still
     * throws, and the one in `@langwatch/authz-contract` that the authz
     * service throws — and they are byte-identical in code, message, meta and
     * status. Which class arrives depends on which path refused, and no
     * caller can tell the difference; the code is what every caller reads.
     */
    it("refuses with the Lite-Member code rather than the generic denial", async () => {
      resolveProjectPermissionMock.mockResolvedValueOnce({
        permitted: false,
        organizationRole: OrganizationUserRole.EXTERNAL,
      });

      await expect(
        requireProjectPermission({
          userId: "user_lite",
          projectId: "proj_1",
          permission: "scenarios:manage",
        }),
      ).rejects.toMatchObject({
        code: "lite_member_restricted",
        httpStatus: 401,
        meta: { resource: "scenarios" },
      });
    });
  });
});
