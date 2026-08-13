/**
 * @vitest-environment node
 *
 * @see specs/rbac/roles-rest-api.feature
 *
 * Deleting a custom role that RoleBinding rows still reference must be
 * refused as in-use, exactly like the legacy TeamUser.assignedRoleId path.
 * Before the RoleBinding-aware check, such a delete slipped past the in-use
 * guard and failed (or dangled) at the storage layer instead of being named.
 */
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { prisma } from "~/server/db";
import { RoleService } from "~/server/role";
import { RoleInUseError } from "~/server/role/errors";
import { RoleRepository } from "~/server/role/repositories/role.repository";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { KSUID_RESOURCES } from "~/utils/constants";

describe("RoleService.deleteRole, given a role referenced by role bindings", () => {
  const ns = `role-delete-${nanoid(8)}`;

  let testOrganization: Organization;
  let userId: string;
  let boundRoleId: string;

  beforeAll(async () => {
    testOrganization = await prisma.organization.create({
      data: { name: "Role Delete Org", slug: `--test-org-${ns}` },
    });

    const user = await prisma.user.create({
      data: { name: "Role Delete User", email: `role-${ns}@example.com` },
    });
    userId = user.id;

    await prisma.organizationUser.create({
      data: {
        userId,
        organizationId: testOrganization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });

    const boundRole = await prisma.customRole.create({
      data: {
        name: `bound-role-${ns}`,
        organizationId: testOrganization.id,
        permissions: ["project:view"],
        kind: "custom",
      },
    });
    boundRoleId = boundRole.id;

    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId: testOrganization.id,
        userId,
        role: TeamUserRole.CUSTOM,
        customRoleId: boundRoleId,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: testOrganization.id,
      },
    });
  });

  afterAll(async () => {
    // Setup may have failed before these were assigned; a delete with an
    // undefined scope is never worth running, and the TypeError would replace
    // the real setup failure in the report.
    if (!testOrganization?.id) return;
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId: testOrganization.id }],
      ["customRole", { organizationId: testOrganization.id }],
      ["organizationUser", { organizationId: testOrganization.id }],
      ...(userId ? ([["user", { id: userId }]] as const) : []),
      ["organization", { id: testOrganization.id }],
    ]);
  });

  /** @scenario Deleting a role that is still bound is refused */
  it("refuses the delete and keeps the role", async () => {
    const service = new RoleService(prisma);

    await expect(service.deleteRole(boundRoleId)).rejects.toBeInstanceOf(
      RoleInUseError,
    );

    const survivor = await prisma.customRole.findUnique({
      where: { id: boundRoleId },
    });
    expect(survivor).not.toBeNull();

    const binding = await prisma.roleBinding.findFirst({
      where: {
        organizationId: testOrganization.id,
        customRoleId: boundRoleId,
      },
    });
    expect(binding).not.toBeNull();
  });

  it("refuses at the storage layer even with the in-use check skipped", async () => {
    // What a binding written after the service's in-use check runs into: the
    // condition rides on the delete statement, so the role survives instead of
    // having its grant silently unhooked.
    const repository = new RoleRepository(prisma);

    await expect(
      repository.deleteIfUnused({
        roleId: boundRoleId,
        organizationId: testOrganization.id,
      }),
    ).resolves.toBe(false);

    expect(
      await prisma.customRole.findUnique({ where: { id: boundRoleId } }),
    ).not.toBeNull();
    expect(
      await prisma.roleBinding.findFirst({
        where: {
          organizationId: testOrganization.id,
          customRoleId: boundRoleId,
        },
      }),
    ).not.toBeNull();
  });

  it("refuses at the storage layer when the only holder is in another organization", async () => {
    // There are no database foreign keys, so a binding can point at a role
    // across organizations. A reference check scoped to this organization
    // would not see it, delete the role, and leave the binding dangling on
    // the built-in permission bag.
    const foreignOrganization = await prisma.organization.create({
      data: { name: "Foreign Org", slug: `--test-foreign-${ns}` },
    });
    const role = await prisma.customRole.create({
      data: {
        name: `cross-org-role-${ns}`,
        organizationId: testOrganization.id,
        permissions: ["project:view"],
        kind: "custom",
      },
    });
    const bindingId = generate(KSUID_RESOURCES.ROLE_BINDING).toString();
    await prisma.roleBinding.create({
      data: {
        id: bindingId,
        organizationId: foreignOrganization.id,
        userId,
        role: TeamUserRole.CUSTOM,
        customRoleId: role.id,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: foreignOrganization.id,
      },
    });

    try {
      const repository = new RoleRepository(prisma);

      await expect(
        repository.deleteIfUnused({
          roleId: role.id,
          organizationId: testOrganization.id,
        }),
      ).resolves.toBe(false);

      expect(
        await prisma.customRole.findUnique({ where: { id: role.id } }),
      ).not.toBeNull();
    } finally {
      await cleanupTestRows(prisma, [
        ["roleBinding", { id: bindingId }],
        ["customRole", { id: role.id }],
        ["organization", { id: foreignOrganization.id }],
      ]);
    }
  });

  it("still deletes a role nothing references", async () => {
    const unboundRole = await prisma.customRole.create({
      data: {
        name: `unbound-role-${ns}`,
        organizationId: testOrganization.id,
        permissions: ["project:view"],
        kind: "custom",
      },
    });

    const service = new RoleService(prisma);
    await expect(service.deleteRole(unboundRole.id)).resolves.toEqual({
      success: true,
    });
  });
});
