/**
 * @vitest-environment node
 *
 * See specs/licensing/seat-reconciliation.feature.
 *
 * A deployment runs uncapped before it buys a license, so an organization can
 * easily hold more members than the seats it just paid for. Disabling is how it
 * gets back within them. These exercise the two halves that have to be true
 * together: the seat is actually returned to the pool, and the person actually
 * loses access. Either one alone is a bug (billing for a locked door, or a free
 * seat that still works).
 */

import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  OrganizationUserRole,
  RoleBindingScopeType,
} from "~/generated/prisma/client";
import { UNLIMITED_PLAN } from "../../../../../ee/licensing/constants";
import { cleanupTestRows } from "../../../../test-utils/cleanupTestRows";
import { globalForApp, resetApp } from "../../../app-layer/app";
import { OrganizationService } from "../../../app-layer/organizations/organization.service";
import { PrismaOrganizationRepository } from "../../../app-layer/organizations/repositories/organization.prisma.repository";
import { createTestApp } from "../../../app-layer/presets";
import { PlanProviderService } from "../../../app-layer/subscription/plan-provider";
import { traced } from "../../../app-layer/tracing";
import { prisma } from "../../../db";
import { createLicenseEnforcementService } from "../../../license-enforcement";
import { LicenseEnforcementRepository } from "../../../license-enforcement/license-enforcement.repository";
import { PromptTagRepository } from "../../../prompt-config/repositories/prompt-tag.repository";
import { appRouter } from "../../root";
import { createInnerTRPCContext } from "../../trpc";

describe("organization.setMemberDisabled", () => {
  const ns = `seat-recon-${nanoid(8)}`;
  let organizationId: string;
  let adminUserId: string;
  let secondAdminUserId: string;
  let memberUserId: string;
  let departmentId: string;
  let adminCaller: ReturnType<typeof appRouter.createCaller>;
  let repo: PrismaOrganizationRepository;
  let seats: LicenseEnforcementRepository;
  /** Seats the stand-in license covers; raised or lowered per scenario. */
  let licensedSeats = 50;

  const emails = () => [
    `admin-${ns}@test.com`,
    `admin2-${ns}@test.com`,
    `member-${ns}@test.com`,
  ];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Seat Reconciliation Org", slug: `--test-${ns}` },
    });
    organizationId = organization.id;

    const department = await prisma.department.create({
      data: { id: `dept-${nanoid(8)}`, organizationId, name: "Engineering" },
    });
    departmentId = department.id;

    const [admin, secondAdmin, member] = await Promise.all([
      prisma.user.create({
        data: { email: `admin-${ns}@test.com`, name: "Admin" },
      }),
      prisma.user.create({
        data: { email: `admin2-${ns}@test.com`, name: "Second Admin" },
      }),
      prisma.user.create({
        data: { email: `member-${ns}@test.com`, name: "Member" },
      }),
    ]);
    adminUserId = admin.id;
    secondAdminUserId = secondAdmin.id;
    memberUserId = member.id;

    await prisma.organizationUser.createMany({
      data: [
        {
          userId: adminUserId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: secondAdminUserId,
          organizationId,
          role: OrganizationUserRole.ADMIN,
        },
        {
          userId: memberUserId,
          organizationId,
          role: OrganizationUserRole.MEMBER,
          departmentId,
        },
      ],
    });

    // role=ADMIN on its own is not enough for `organization:manage`; the
    // permission check reads the binding.
    await prisma.roleBinding.create({
      data: {
        id: `rb-${nanoid(8)}`,
        organizationId,
        userId: adminUserId,
        role: OrganizationUserRole.ADMIN,
        scopeType: RoleBindingScopeType.ORGANIZATION,
        scopeId: organizationId,
      },
    });

    repo = new PrismaOrganizationRepository(prisma);
    seats = new LicenseEnforcementRepository(prisma);

    globalForApp.__langwatch_app = createTestApp({
      organizations: traced(
        new OrganizationService(repo, new PromptTagRepository(prisma)),
        "OrganizationService",
      ),
      // `createTestApp` otherwise pins FREE_PLAN, whose single seat is not the
      // situation under test. `licensedSeats` stands in for the license so both
      // sides of the seat check can be exercised.
      planProvider: PlanProviderService.create({
        getActivePlan: async () => ({
          ...UNLIMITED_PLAN,
          planSource: "license" as const,
          type: "ENTERPRISE",
          free: false,
          overrideAddingLimitations: false,
          maxMembers: licensedSeats,
        }),
      }),
    });

    adminCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: adminUserId }, expires: "1" },
      }),
    );
  });

  afterAll(async () => {
    await resetApp();
    await cleanupTestRows(prisma, [
      ["roleBinding", { organizationId }],
      ["organizationUser", { organizationId }],
      ["department", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { email: { in: emails() } }],
    ]);
  });

  // Placed first, while every member is still active: these describe the state
  // an organization lands in the moment it activates a license for fewer seats
  // than it already uses.
  describe("given more active members than the license covers", () => {
    /** @scenario Activating a license for fewer seats than the org has succeeds */
    it("leaves every existing member able to act, so nobody is locked out", async () => {
      licensedSeats = 1;

      for (const userId of [adminUserId, secondAdminUserId, memberUserId]) {
        expect(
          await repo.getUserOrgRole({ userId, organizationId }),
        ).not.toBeNull();
      }

      licensedSeats = 50;
    });

    /** @scenario Inviting another member is refused while over the seat count */
    it("refuses to add anyone new until the org is back within its seats", async () => {
      licensedSeats = 1;

      const enforcement = createLicenseEnforcementService(prisma);
      const result = await enforcement.checkLimit(organizationId, "members");

      expect(result.allowed).toBe(false);

      licensedSeats = 50;
    });
  });

  describe("when a member is disabled", () => {
    /** @scenario Disabling a member returns their seat */
    /** @scenario Disabled members are not counted against the license */
    it("returns their seat to the pool", async () => {
      const before = await seats.getMemberCount(organizationId);

      await adminCaller.organization.setMemberDisabled({
        organizationId,
        userId: memberUserId,
        disabled: true,
      });

      expect(await seats.getMemberCount(organizationId)).toBe(before - 1);
    });

    /** @scenario A disabled member loses access but keeps their record */
    it("revokes their access to the organization", async () => {
      const role = await repo.getUserOrgRole({
        userId: memberUserId,
        organizationId,
      });

      expect(role).toBeNull();
    });

    /** @scenario A disabled member loses access but keeps their record */
    it("leaves their role and department untouched, so nothing is rebuilt on re-enable", async () => {
      const membership = await prisma.organizationUser.findUnique({
        where: {
          userId_organizationId: { userId: memberUserId, organizationId },
        },
        select: { role: true, departmentId: true, disabledAt: true },
      });

      expect(membership).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        departmentId,
      });
      expect(membership?.disabledAt).toBeInstanceOf(Date);
    });

    /** @scenario A disabled member can be re-enabled when a seat is free */
    it("restores access when re-enabled", async () => {
      await adminCaller.organization.setMemberDisabled({
        organizationId,
        userId: memberUserId,
        disabled: false,
      });

      const role = await repo.getUserOrgRole({
        userId: memberUserId,
        organizationId,
      });

      expect(role).toBe(OrganizationUserRole.MEMBER);
    });
  });

  describe("when re-enabling would take the organization past its seats", () => {
    /** @scenario Re-enabling a member is refused when it would exceed the seats */
    it("refuses, so a disabled seat cannot be quietly reclaimed", async () => {
      await adminCaller.organization.setMemberDisabled({
        organizationId,
        userId: memberUserId,
        disabled: true,
      });

      // Exactly the seats now in use, so putting anyone back is one too many.
      licensedSeats = await seats.getMemberCount(organizationId);

      // FORBIDDEN plus the seat counts is what the client's global handler
      // reads to open the limit modal, so asserting the shape is asserting
      // that the admin is actually told why.
      await expect(
        adminCaller.organization.setMemberDisabled({
          organizationId,
          userId: memberUserId,
          disabled: false,
        }),
      ).rejects.toMatchObject({
        code: "FORBIDDEN",
        cause: {
          limitType: "members",
          current: licensedSeats,
          max: licensedSeats,
        },
      });

      // Still disabled, and still not consuming a seat.
      expect(
        await repo.getUserOrgRole({ userId: memberUserId, organizationId }),
      ).toBeNull();

      licensedSeats = 50;
    });
  });

  describe("when disabling would leave the organization without an admin", () => {
    /** @scenario Disabling the last admin is refused */
    it("refuses, so someone can always still sign in and fix it", async () => {
      // Take the org down to a single active admin first.
      await adminCaller.organization.setMemberDisabled({
        organizationId,
        userId: secondAdminUserId,
        disabled: true,
      });

      // Driven at the repository, where the guard lives: routing it through
      // the caller would trip the permission check first (the only remaining
      // admin cannot disable themselves) and prove nothing about the guard.
      await expect(
        repo.setMemberDisabled({
          organizationId,
          userId: adminUserId,
          disabled: true,
        }),
      ).rejects.toMatchObject({ code: "BAD_REQUEST" });

      // And the admin is genuinely still standing.
      expect(
        await repo.getUserOrgRole({ userId: adminUserId, organizationId }),
      ).toBe(OrganizationUserRole.ADMIN);
    });
  });
});
