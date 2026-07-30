/**
 * @vitest-environment node
 *
 * Caller authorization for the role router.
 *
 * `role-api.test.ts` covers what the service does once it is called; nothing
 * covered who is allowed to call it. Role definition and assignment is a
 * privilege-escalation surface — whoever can write roles can write their own
 * permissions — so each mutation is exercised from a caller who must not reach
 * it, and from another organization's admin.
 *
 * Every case here is a denial in the router's own middleware, which runs ahead
 * of the plan check and the resolver, so no App or plan wiring is needed.
 */
import { generate } from "@langwatch/ksuid";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import { KSUID_RESOURCES } from "~/utils/constants";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

const ns = `role-authz-${nanoid(8)}`;

const callerFor = (userId: string) =>
  appRouter.createCaller(
    createInnerTRPCContext({ session: { user: { id: userId }, expires: "1" } }),
  );

describe("Feature: role router caller authorization", () => {
  let organizationId: string;
  let teamId: string;
  let otherOrganizationId: string;
  let customRoleId: string;
  let memberUserId: string;

  let adminCaller: ReturnType<typeof callerFor>;
  let memberCaller: ReturnType<typeof callerFor>;
  let outsiderAdminCaller: ReturnType<typeof callerFor>;

  const makeUser = async (
    label: string,
    orgId: string,
    role: OrganizationUserRole,
    bindingRole: TeamUserRole,
  ) => {
    const user = await prisma.user.create({
      data: { name: `${label} ${ns}`, email: `${label}-${ns}@example.com` },
    });
    await prisma.organizationUser.create({
      data: { userId: user.id, organizationId: orgId, role },
    });
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: orgId,
        userId: user.id,
        role: bindingRole,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: orgId,
      },
    });
    return user.id;
  };

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `Role Authz Org ${ns}`, slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;

    const team = await prisma.team.create({
      data: {
        name: `Role Authz Team ${ns}`,
        slug: `--test-team-${ns}`,
        organizationId,
      },
    });
    teamId = team.id;

    const other = await prisma.organization.create({
      data: { name: `Other Org ${ns}`, slug: `--test-other-org-${ns}` },
    });
    otherOrganizationId = other.id;

    const adminUserId = await makeUser(
      "admin",
      organizationId,
      OrganizationUserRole.ADMIN,
      TeamUserRole.ADMIN,
    );
    memberUserId = await makeUser(
      "member",
      organizationId,
      OrganizationUserRole.MEMBER,
      TeamUserRole.MEMBER,
    );
    const outsiderAdminUserId = await makeUser(
      "outsider",
      otherOrganizationId,
      OrganizationUserRole.ADMIN,
      TeamUserRole.ADMIN,
    );

    const customRole = await prisma.customRole.create({
      data: {
        organizationId,
        name: `Role ${ns}`,
        permissions: ["traces:view"],
      },
    });
    customRoleId = customRole.id;

    adminCaller = callerFor(adminUserId);
    memberCaller = callerFor(memberUserId);
    outsiderAdminCaller = callerFor(outsiderAdminUserId);
  });

  afterAll(async () => {
    for (const orgId of [organizationId, otherOrganizationId]) {
      await prisma.roleBinding
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => {});
      await prisma.customRole
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => {});
      await prisma.teamUser
        .deleteMany({ where: { team: { organizationId: orgId } } })
        .catch(() => {});
      await prisma.team
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => {});
      await prisma.organizationUser
        .deleteMany({ where: { organizationId: orgId } })
        .catch(() => {});
      await prisma.organization
        .delete({ where: { id: orgId } })
        .catch(() => {});
    }
    await prisma.user
      .deleteMany({ where: { email: { contains: ns } } })
      .catch(() => {});
  });

  describe("given a caller who can only view the organization", () => {
    it("refuses to list the organization's roles", async () => {
      await expect(
        memberCaller.role.getAll({ organizationId }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    /** A member who could mint roles could mint themselves any permission. */
    it("refuses to create a role", async () => {
      await expect(
        memberCaller.role.create({
          organizationId,
          name: `Escalated ${ns}`,
          permissions: ["organization:manage"],
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses to delete a role", async () => {
      await expect(
        memberCaller.role.delete({ roleId: customRoleId }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses to assign a role to a user", async () => {
      await expect(
        memberCaller.role.assignToUser({
          userId: memberUserId,
          teamId,
          customRoleId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses to remove a role from a user", async () => {
      await expect(
        memberCaller.role.removeFromUser({
          userId: memberUserId,
          teamId,
          customRoleId,
        }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("leaves the role untouched after the refused calls", async () => {
      const role = await prisma.customRole.findUnique({
        where: { id: customRoleId },
      });

      expect(role).not.toBeNull();
      expect(role?.permissions).toEqual(["traces:view"]);
    });
  });

  describe("given an administrator of a different organization", () => {
    it("refuses to list this organization's roles", async () => {
      await expect(
        outsiderAdminCaller.role.getAll({ organizationId }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses to read one of its roles by id", async () => {
      await expect(
        outsiderAdminCaller.role.getById({ roleId: customRoleId }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });

    it("refuses to delete one of its roles", async () => {
      await expect(
        outsiderAdminCaller.role.delete({ roleId: customRoleId }),
      ).rejects.toMatchObject({ code: "UNAUTHORIZED" });
    });
  });

  describe("given an administrator of the organization", () => {
    /** Control: the refusals above are about authority, not a broken router. */
    it("lists the organization's roles", async () => {
      const roles = await adminCaller.role.getAll({ organizationId });

      expect(roles.map((role) => role.id)).toContain(customRoleId);
    });
  });
});
