/**
 * Shared seeding for the management REST API integration suites.
 *
 * Every family authenticates the same way: an organization on a plan the
 * suite controls, an admin member, an explicit ORGANIZATION-ADMIN role
 * binding, and an organization-scoped API key minted through the real
 * `ApiKeyService`, so the six suites build on one seed instead of six
 * hand-rolled copies that drift.
 *
 * The plan is a `vi.fn` the caller installs into `createTestApp`'s plan
 * provider, so a test can move the organization between FREE and Enterprise
 * (or shrink its seats) per scenario.
 */
import { FREE_PLAN } from "@langwatch/enterprise-licensing-contract";
import type { PlanInfo } from "@langwatch/enterprise-licensing-contract";
import { generate } from "@langwatch/ksuid";
import { nanoid } from "nanoid";
import {
  type Organization,
  OrganizationUserRole,
  type PrismaClient,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { getApp } from "~/server/app-layer/app";
import { KSUID_RESOURCES } from "~/utils/constants";

/**
 * Enterprise with room: the management suites are about the APIs, not the
 * seat math, so the default plan never trips a limit by accident. Seat
 * scenarios shrink `maxMembers` deliberately, per test.
 */
export const ENTERPRISE_TEST_PLAN = {
  ...FREE_PLAN,
  type: "ENTERPRISE",
  free: false,
  maxMembers: 100,
  maxMembersLite: 100,
} satisfies PlanInfo;

export interface ManagementTestOrg {
  organization: Organization;
  adminUserId: string;
  adminEmail: string;
  /** Personal organization-admin API key acting as the admin member. */
  adminToken: string;
}

/**
 * One organization with an ADMIN member and their org-scoped admin API key.
 * Slugs and emails carry `ns` so parallel worktrees can never collide, and
 * teardown can sweep by `organizationId` alone.
 */
export async function seedManagementOrg({
  prisma,
  ns,
}: {
  prisma: PrismaClient;
  ns: string;
}): Promise<ManagementTestOrg> {
  const organization = await prisma.organization.create({
    data: { name: `Management Org ${ns}`, slug: `--test-org-${ns}` },
  });

  const admin = await prisma.user.create({
    data: {
      name: `Management Admin ${ns}`,
      email: `mgmt-admin-${ns}@example.com`,
    },
  });

  await prisma.organizationUser.create({
    data: {
      userId: admin.id,
      organizationId: organization.id,
      role: OrganizationUserRole.ADMIN,
    },
  });

  await prisma.roleBinding.create({
    data: {
      id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
      organizationId: organization.id,
      userId: admin.id,
      role: TeamUserRole.ADMIN,
      scopeType: RoleBindingScopeType.ORGANIZATION,
      scopeId: organization.id,
    },
  });

  const created = await getApp().apiKeys.apiKeyService.create({
    name: `mgmt-admin-key-${nanoid(6)}`,
    userId: admin.id,
    createdByUserId: admin.id,
    organizationId: organization.id,
    permissionMode: "all",
    bindings: [
      {
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
    ],
  });

  return {
    organization,
    adminUserId: admin.id,
    adminEmail: admin.email ?? "",
    adminToken: created.token,
  };
}

/**
 * The binding role each organization role carries at ORGANIZATION scope.
 * `OrganizationUserRole` and `TeamUserRole` are separate enums that happen to
 * share two names today, so the pairing is written out: a new organization
 * role then fails to compile here rather than writing a value the
 * `RoleBinding.role` column rejects at runtime. `EXTERNAL` is absent because
 * an external member holds no organization-scoped binding at all.
 */
const ORGANIZATION_BINDING_ROLE = {
  [OrganizationUserRole.ADMIN]: TeamUserRole.ADMIN,
  [OrganizationUserRole.MEMBER]: TeamUserRole.MEMBER,
} satisfies Record<
  Exclude<OrganizationUserRole, typeof OrganizationUserRole.EXTERNAL>,
  TeamUserRole
>;

/**
 * An additional organization member with the given role, plus (optionally)
 * their own personal org-scoped API key so a test can exercise access AS
 * that member.
 */
export async function seedOrgMember({
  prisma,
  ns,
  organizationId,
  role,
  label,
  hasOrgBinding = false,
}: {
  prisma: PrismaClient;
  ns: string;
  organizationId: string;
  role: OrganizationUserRole;
  label: string;
  /**
   * Also write the ORGANIZATION-scoped role binding invite acceptance would
   * have written. Leave false to model a legacy member whose access derives
   * from TeamUser rows alone. Ignored for `EXTERNAL` members: they never hold
   * an organization-scoped binding.
   */
  hasOrgBinding?: boolean;
}): Promise<{ userId: string; email: string }> {
  const user = await prisma.user.create({
    data: {
      name: `Member ${label} ${ns}`,
      email: `member-${label}-${ns}@example.com`,
    },
  });
  await prisma.organizationUser.create({
    data: { userId: user.id, organizationId, role },
  });
  if (hasOrgBinding && role !== OrganizationUserRole.EXTERNAL) {
    await prisma.roleBinding.create({
      data: {
        id: generate(KSUID_RESOURCES.ROLE_BINDING).toString(),
        organizationId,
        userId: user.id,
        role: ORGANIZATION_BINDING_ROLE[role],
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });
  }
  return { userId: user.id, email: user.email ?? "" };
}
