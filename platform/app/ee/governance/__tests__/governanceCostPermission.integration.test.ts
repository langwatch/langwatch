// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Who may read the organization's cost figures.
 *
 * The cost router gates on `governanceCost:view` through `.permission()`,
 * which routes to `hasOrganizationPermission` — so that is what these tests
 * drive, against real Postgres rows rather than a mocked resolver. A mock
 * would assert that a function was called; the promise is that a real
 * membership in a real organization does not open another one's money.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type Organization,
  OrganizationUserRole,
  RoleBindingScopeType,
  TeamUserRole,
} from "~/generated/prisma/client";
import { hasOrganizationPermission } from "~/server/api/rbac";
import { prisma } from "~/server/db";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";

const ns = `govcost-${nanoid(8)}`;

/** The ctx shape `hasOrganizationPermission` reads: prisma plus the session. */
const ctxFor = (userId: string) =>
  ({
    prisma,
    session: { user: { id: userId } },
  }) as unknown as Parameters<typeof hasOrganizationPermission>[0];

describe("reading an organization's cost figures", () => {
  /** The organization whose costs are being asked for. */
  let organization: Organization;
  /** A different organization, where the actor is an admin. */
  let otherOrganization: Organization;
  /** Member of `organization`, admin of `otherOrganization`. */
  let memberHereAdminThereId: string;
  /** Admin of `organization` — the non-vacuity control. */
  let adminHereId: string;

  beforeAll(async () => {
    organization = await prisma.organization.create({
      data: { name: "Cost Org", slug: `--test-org-${ns}` },
    });
    otherOrganization = await prisma.organization.create({
      data: { name: "Other Cost Org", slug: `--test-org-other-${ns}` },
    });

    const crossUser = await prisma.user.create({
      data: { name: "Cross Org User", email: `${ns}-cross@example.com` },
    });
    memberHereAdminThereId = crossUser.id;

    const adminUser = await prisma.user.create({
      data: { name: "Admin Here", email: `${ns}-admin@example.com` },
    });
    adminHereId = adminUser.id;

    // A MEMBER of THIS organization — not a stranger. A non-member would be
    // refused by the membership check alone, so that configuration would pass
    // even against a resolver that ignored grant scope entirely, which is the
    // exact failure these tests exist to catch.
    await prisma.organizationUser.create({
      data: {
        userId: memberHereAdminThereId,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    // …and an ADMIN over there, which is where the permission really is held.
    await prisma.organizationUser.create({
      data: {
        userId: memberHereAdminThereId,
        organizationId: otherOrganization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.organizationUser.create({
      data: {
        userId: adminHereId,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });

    // Admin power comes from an ORGANIZATION-scoped RoleBinding, not from the
    // OrganizationUser.role field on its own — a bare role=ADMIN deliberately
    // does not escalate (rbac.ts, the universal personal-context floor). So the
    // grants have to be bindings, or the "admin can read" controls below would
    // fail for a reason that has nothing to do with this permission.
    await prisma.roleBinding.create({
      data: {
        id: `rb_${ns}_admin_here`,
        organizationId: organization.id,
        userId: adminHereId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organization.id,
      },
    });
    // The cross-org actor's grant lives ONLY over there. No binding of any
    // kind names them in `organization` — their membership here is the bare
    // MEMBER row above.
    await prisma.roleBinding.create({
      data: {
        id: `rb_${ns}_admin_there`,
        organizationId: otherOrganization.id,
        userId: memberHereAdminThereId,
        role: TeamUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: otherOrganization.id,
      },
    });
  });

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId: organization.id }],
      ["roleBinding", { organizationId: otherOrganization.id }],
      ["organizationUser", { organizationId: organization.id }],
      ["organizationUser", { organizationId: otherOrganization.id }],
      ["user", { id: memberHereAdminThereId }],
      ["user", { id: adminHereId }],
      ["organization", { id: organization.id }],
      ["organization", { id: otherOrganization.id }],
    ]);
  });

  describe("given a member of the organization without the cost permission", () => {
    /** @scenario "Viewing requires the organization-scoped governance cost permission" */
    it("refuses the cost read", async () => {
      // The control: somebody in this organization CAN read the costs, so a
      // refusal below is about this actor's grants and not about the
      // permission being unreachable for everyone.
      await expect(
        hasOrganizationPermission(
          ctxFor(adminHereId),
          organization.id,
          "governanceCost:view",
        ),
      ).resolves.toBe(true);

      await expect(
        hasOrganizationPermission(
          ctxFor(memberHereAdminThereId),
          organization.id,
          "governanceCost:view",
        ),
      ).resolves.toBe(false);
    });
  });

  describe("given the actor holds the cost permission on a different organization", () => {
    /** @scenario "A grant on another organization does not open this organization's costs" */
    it("still refuses this organization's cost read", async () => {
      // The grant over there is real — without this the refusal here could be
      // a resolver that never grants the permission anywhere.
      await expect(
        hasOrganizationPermission(
          ctxFor(memberHereAdminThereId),
          otherOrganization.id,
          "governanceCost:view",
        ),
      ).resolves.toBe(true);

      await expect(
        hasOrganizationPermission(
          ctxFor(memberHereAdminThereId),
          organization.id,
          "governanceCost:view",
        ),
      ).resolves.toBe(false);
    });
  });
});
