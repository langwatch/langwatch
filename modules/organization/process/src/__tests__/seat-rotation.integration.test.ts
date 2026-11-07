import type { AuthzApi, AuthzGrantsService } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
/**
 * The 30-day seat hold over real rows: removals, disables and demotions keep a full seat counted
 * until 30 days after it was taken, a return takes it back, and freed seats go to who waits.
 * @vitest-environment node
 * @see specs/licensing/seat-rotation.feature
 */
import { createLogger } from "@langwatch/observability";
import { MemberSeatLimitReachedError } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import {
  INVITE_STATUS,
  OrganizationUserRole,
  type PrismaClient,
} from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { fromDate } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, describe, expect, it } from "vitest";

import { InviteSeatCensusService } from "../features/invite/services/invite-seat-census.service.ts";
import type { InviteSendThrottleService } from "../features/invite/services/invite-send-throttle.service.ts";
import { InviteService } from "../features/invite/services/invite.service.ts";
import { PrismaOrganizationInviteRepository } from "../repositories/prisma/prisma.organization-invite.repository.ts";
import { PrismaOrganizationMembershipRepository } from "../repositories/prisma/prisma.organization-membership.repository.ts";
import { PrismaOrganizationSeatRepository } from "../repositories/prisma/prisma.organization-seat.repository.ts";
import { PrismaSeatHoldRepository } from "../repositories/prisma/prisma.seat-hold.repository.ts";
import { PrismaSeatRequestRepository } from "../repositories/prisma/prisma.seat-request.repository.ts";
import type { InviteAssignableRoles } from "../rules/invite-contracts.rules.ts";
import { OrganizationMembershipService } from "../services/organization-membership.service.ts";
import { OrganizationSeatLicenseService } from "../services/organization-seat-license.service.ts";
import { SeatHoldService } from "../services/seat-hold.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const DAY_MS = 24 * 60 * 60 * 1000;
const daysFromNow = (days: number) => new Date(Date.now() + days * DAY_MS);

describe.skipIf(!DB_URL)("Seat rotation", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:seat-rotation"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }))
    .client as PrismaClient;

  /** Set to make every grant write fail, as a ledger outage after the seat committed would. */
  let grantWritesFail = false;
  const grantWrite =
    <T>(answer: T) =>
    async () => {
      if (grantWritesFail) throw new Error("grant ledger unavailable");
      return answer;
    };
  const grants = createApiFixture<AuthzGrantsService>({
    attachBindings: grantWrite({ attached: [], duplicates: [] }),
    revokeBindings: grantWrite(undefined),
    revokeBindingsWhere: grantWrite(0),
    changeBindingRole: grantWrite(undefined),
  });
  const attachedBindings: { organizationId: string; userId: string; role: string }[] = [];
  /** Which step of an admission's grant fails, as a ledger outage after the enable would. */
  let admissionFailure: "attach" | "complete" | null = null;
  /** Organizations whose plan lookup fails, to prove one failing admission spares the others. */
  const unreachablePlans = new Set<string>();
  const plans = createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
    getActivePlan: async ({ organizationId }) => {
      if (unreachablePlans.has(organizationId)) throw new Error("plan lookup unavailable");
      return createApiFixture<Plan>({
        overrideAddingLimitations: false,
        maxMembers: 5,
        maxMembersLite: 5,
      });
    },
  });
  const membershipRepository = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    cipher: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    grants,
  });
  const seatCounts = PrismaOrganizationSeatRepository.create(prisma);
  const seatRequests = PrismaSeatRequestRepository.create(prisma);
  const seatHolds = SeatHoldService.create({
    memberships: membershipRepository,
    holds: PrismaSeatHoldRepository.create(prisma),
  });
  const memberships = OrganizationMembershipService.create({
    repository: membershipRepository,
    seatHolds,
    seatRequests,
    seats: OrganizationSeatLicenseService.create({
      plans,
      memberships: seatCounts,
      notices: { reached: () => {} },
    }),
    creations: { created: async () => {}, reportError: () => {} },
    seatNotices: { memberDisabled: async () => {}, memberEnabled: async () => {} },
    grantCache: { invalidateOrganization: async () => {} },
    testArrivals: { standingFor: async () => ({ testing: false }) as const },
    ceiling: { assertWithinCaller: async () => {} },
    admissions: {
      // As the grant ledger does: a binding needs a live (enabled) membership.
      attachBindings: async ({ organizationId, bindings }) => {
        if (admissionFailure === "attach") throw new Error("grant ledger unavailable");
        for (const binding of bindings) {
          if (!("userId" in binding.principal)) continue;
          const userId = binding.principal.userId;
          const member = await prisma.organizationUser.findUnique({
            where: { userId_organizationId: { userId, organizationId } },
          });
          if (!member || member.disabledAt) throw new Error("no live membership to bind");
          attachedBindings.push({ organizationId, userId, role: binding.role });
        }
        return { attached: [], duplicates: [] };
      },
      // As authz does: clears the intent the grant answered.
      completeAdmission: async ({ organizationId, userId, grantId }) => {
        if (admissionFailure === "complete") throw new Error("admission store unavailable");
        const cleared = await prisma.organizationUser.updateMany({
          where: { organizationId, userId, pendingSsoGrantId: grantId },
          data: { pendingSsoGrantId: null },
        });
        return cleared.count === 1;
      },
    },
    workspaceNotices: { personalWorkspaceArchived: async () => {} },
    memberNotices: { memberRemoved: async () => {}, memberDepartmentChanged: async () => {} },
  });

  const organizationIds: string[] = [];
  const userIds: string[] = [];

  afterAll(async () => {
    if (organizationIds.length === 0) return;
    await cleanupTestRows(prisma, [
      ["seatHold", { organizationId: { in: organizationIds } }],
      ["seatRequest", { organizationId: { in: organizationIds } }],
      ["organizationInvite", { organizationId: { in: organizationIds } }],
      ["organizationUser", { organizationId: { in: organizationIds } }],
      ["organization", { id: { in: organizationIds } }],
      ["user", { id: { in: userIds } }],
    ]);
    await prisma.$disconnect();
  });

  async function person(name: string): Promise<string> {
    const user = await prisma.user.create({
      data: { name, email: `${name.toLowerCase()}-${nanoid(8)}@acme.example` },
    });
    userIds.push(user.id);
    return user.id;
  }

  /**
   * ACME with 5 full member seats, all in use: an administrator, three members and Bar, who took
   * their seat `barTookSeatDaysAgo` days ago. `waiting` people wait for a seat, longest first.
   */
  async function acme({
    barTookSeatDaysAgo = 45,
    waiting = [],
  }: { barTookSeatDaysAgo?: number; waiting?: string[] } = {}) {
    const slug = `--test-org-seat-rotation-${nanoid(8)}`;
    const organization = await prisma.organization.create({ data: { name: "ACME", slug } });
    const organizationId = organization.id;
    organizationIds.push(organizationId);
    const adminId = await person("Admin");
    const bar = await person("Bar");
    const others = [await person("Foo"), await person("Baz"), await person("Bat")];
    await prisma.organizationUser.createMany({
      data: [
        { userId: adminId, organizationId, role: OrganizationUserRole.ADMIN },
        ...others.map((userId) => ({ userId, organizationId, role: OrganizationUserRole.MEMBER })),
        {
          userId: bar,
          organizationId,
          role: OrganizationUserRole.MEMBER,
          createdAt: daysFromNow(-barTookSeatDaysAgo),
        },
      ],
    });
    const waitingIds: string[] = [];
    for (const [index, name] of waiting.entries()) {
      const userId = await person(name);
      waitingIds.push(userId);
      await prisma.organizationUser.create({
        data: {
          userId,
          organizationId,
          role: OrganizationUserRole.EXTERNAL,
          disabledAt: new Date(),
          seatPendingSince: daysFromNow(-(waiting.length - index)),
        },
      });
    }
    return { organizationId, adminId, bar, waitingIds };
  }

  const fullSeatsInUse = async (organizationId: string) =>
    (await seatCounts.countMemberSeats(organizationId)).fullMembers;

  const membershipOf = (organizationId: string, userId: string) =>
    prisma.organizationUser.findUnique({
      where: { userId_organizationId: { userId, organizationId } },
      select: {
        role: true,
        disabledAt: true,
        fullSeatSince: true,
        seatPendingSince: true,
        pendingSsoGrantId: true,
      },
    });

  const remove = (organizationId: string, adminId: string, userId: string, giveTo?: string) =>
    memberships.removeMember({
      organizationId,
      userId,
      actingUserId: adminId,
      giveSeatToUserId: giveTo ?? null,
      caller: { type: "user", id: adminId },
    });

  async function heldUntil({
    organizationId,
    userId,
    seatTakenAt,
    until,
  }: {
    organizationId: string;
    userId: string;
    seatTakenAt: Date;
    until: Date;
  }) {
    await prisma.seatHold.create({
      data: {
        id: nanoid(),
        organizationId,
        userId,
        email: null,
        name: "Bar",
        seatTakenAt,
        heldUntil: until,
        reason: "REMOVED",
      },
    });
  }

  describe("when a full member is removed or disabled, their seat is held until 30 days after they took it", () => {
    /** @scenario "Removing someone who took their seat over 30 days ago frees it at once" */
    it("frees a seat taken over 30 days ago at once", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 45 });

      await remove(organizationId, adminId, bar);

      expect(await membershipOf(organizationId, bar)).toBeNull();
      expect(await fullSeatsInUse(organizationId)).toBe(4);
      expect(await seatHolds.findHeld({ organizationId })).toEqual([]);
    });

    /** @scenario "Removing someone who took their seat under 30 days ago holds it until 30 days after" */
    it("holds a seat taken under 30 days ago until 30 days after it was taken", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });
      const taken = (
        await prisma.organizationUser.findUniqueOrThrow({
          where: { userId_organizationId: { userId: bar, organizationId } },
        })
      ).createdAt;

      await remove(organizationId, adminId, bar);

      expect(await membershipOf(organizationId, bar)).toBeNull();
      expect(await fullSeatsInUse(organizationId)).toBe(5);
      const [held] = await seatHolds.findHeld({ organizationId });
      expect(held).toMatchObject({ userId: bar, name: "Bar", reason: "REMOVED" });
      expect(held?.heldUntil.epochMilliseconds).toBe(taken.getTime() + 30 * DAY_MS);
    });

    /** @scenario "Disabling a full member holds their seat the same way" */
    it("holds a disabled member's recent seat", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });

      await memberships.setMemberDisabled({
        organizationId,
        userId: bar,
        disabled: true,
        actingUser: { id: adminId },
      });

      expect((await membershipOf(organizationId, bar))?.disabledAt).not.toBeNull();
      expect(await fullSeatsInUse(organizationId)).toBe(5);
    });

    /** @scenario "Demoting a full member to Lite holds their full seat the same way" */
    it("holds a demoted member's recent full seat", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });

      await memberships.changeMemberRole({
        organizationId,
        userId: bar,
        role: OrganizationUserRole.EXTERNAL,
        currentUserId: adminId,
        caller: { type: "user", id: adminId },
      });

      expect((await membershipOf(organizationId, bar))?.role).toBe(OrganizationUserRole.EXTERNAL);
      expect(await fullSeatsInUse(organizationId)).toBe(5);
    });

    /** @scenario "A role change whose grants fail keeps the seat as it was" */
    it("puts back the role, seat date and hold when a demotion's grants fail", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });
      // Bar's organization binding, so the demotion has a grant to revoke.
      await prisma.roleBinding.create({
        data: {
          organizationId,
          userId: bar,
          role: "MEMBER",
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
        },
      });
      const before = await membershipOf(organizationId, bar);
      grantWritesFail = true;

      try {
        await expect(
          memberships.changeMemberRole({
            organizationId,
            userId: bar,
            role: OrganizationUserRole.EXTERNAL,
            currentUserId: adminId,
            caller: { type: "user", id: adminId },
          }),
        ).rejects.toThrow("grant ledger unavailable");
      } finally {
        grantWritesFail = false;
      }

      expect(await membershipOf(organizationId, bar)).toEqual(before);
      expect(await prisma.seatHold.count({ where: { organizationId } })).toBe(0);
    });

    /** @scenario "A role change whose grants fail keeps the seat as it was" */
    it("keeps the hold when a promotion back to a full seat fails", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });
      await memberships.changeMemberRole({
        organizationId,
        userId: bar,
        role: OrganizationUserRole.EXTERNAL,
        currentUserId: adminId,
        caller: { type: "user", id: adminId },
      });
      const [hold] = await seatHolds.findHeld({ organizationId });
      const demoted = await membershipOf(organizationId, bar);
      grantWritesFail = true;

      try {
        await expect(
          memberships.changeMemberRole({
            organizationId,
            userId: bar,
            role: OrganizationUserRole.MEMBER,
            currentUserId: adminId,
            caller: { type: "user", id: adminId },
          }),
        ).rejects.toThrow("grant ledger unavailable");
      } finally {
        grantWritesFail = false;
      }

      expect(await membershipOf(organizationId, bar)).toEqual(demoted);
      expect(await seatHolds.findHeld({ organizationId })).toEqual([hold]);
      expect(await fullSeatsInUse(organizationId)).toBe(5);
    });

    /** @scenario "A held seat frees on its own when the hold ends" */
    it("stops counting a hold that ended yesterday", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 45 });
      await remove(organizationId, adminId, bar);
      await heldUntil({
        organizationId,
        userId: bar,
        seatTakenAt: daysFromNow(-31),
        until: daysFromNow(-1),
      });

      expect(await fullSeatsInUse(organizationId)).toBe(4);
      expect(await seatHolds.findHeld({ organizationId })).toEqual([]);
    });

    /** @scenario "A person added back within their hold reuses the held seat" */
    it("gives a returning person their held seat back with its original date", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 20 });
      const taken = (
        await prisma.organizationUser.findUniqueOrThrow({
          where: { userId_organizationId: { userId: bar, organizationId } },
        })
      ).createdAt;
      await remove(organizationId, adminId, bar);
      expect(await fullSeatsInUse(organizationId)).toBe(5);

      // Every seat is taken, the held one included: only the hold lets Bar back in.
      const admission = await memberships.createMembership({
        organizationId,
        userId: bar,
        seat: "MEMBER",
      });

      expect(admission).toMatchObject({ outcome: "created", seat: "MEMBER", pending: false });
      expect(await fullSeatsInUse(organizationId)).toBe(5);
      expect((await membershipOf(organizationId, bar))?.fullSeatSince?.getTime()).toBe(
        taken.getTime(),
      );
      expect(await seatHolds.findHeld({ organizationId })).toEqual([]);
    });

    /** @scenario "A pending invitation that is revoked frees its seat at once" */
    it("counts a pending full invitation until it is revoked", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 45 });
      await remove(organizationId, adminId, bar);
      const invite = await prisma.organizationInvite.create({
        data: {
          email: `new-${nanoid(6)}@acme.example`,
          inviteCode: nanoid(),
          organizationId,
          role: OrganizationUserRole.MEMBER,
          teamIds: "",
          expiration: daysFromNow(7),
        },
      });
      expect(await fullSeatsInUse(organizationId)).toBe(5);

      await prisma.organizationInvite.update({
        where: { id: invite.id },
        data: { status: INVITE_STATUS.REVOKED },
      });

      expect(await fullSeatsInUse(organizationId)).toBe(4);
    });
  });

  describe("when a person comes back by a path that writes the membership itself", () => {
    const tookSeatOn = async (organizationId: string, userId: string) =>
      (
        await prisma.organizationUser.findUniqueOrThrow({
          where: { userId_organizationId: { userId, organizationId } },
        })
      ).createdAt;

    /** @scenario "Unassigning and reassigning someone in the identity provider reuses their held seat" */
    it("holds the seat a directory offboarding takes and gives it back on re-provisioning", async () => {
      const { organizationId, bar } = await acme({ barTookSeatDaysAgo: 3 });
      const taken = await tookSeatOn(organizationId, bar);

      // The directory's offboarding asks organization first, then authz deletes the row itself.
      await seatHolds.holdSeatOfDepartingMember({ organizationId, userId: bar });
      await prisma.organizationUser.delete({
        where: { userId_organizationId: { userId: bar, organizationId } },
      });
      expect(await fullSeatsInUse(organizationId)).toBe(5);

      // Re-provisioning writes the row itself, then asks organization to take the hold back.
      await prisma.organizationUser.create({
        data: { userId: bar, organizationId, role: OrganizationUserRole.MEMBER },
      });
      expect(await seatHolds.takeBackHeldSeat({ organizationId, userId: bar })).toBe(true);

      expect(await fullSeatsInUse(organizationId)).toBe(5);
      expect((await membershipOf(organizationId, bar))?.fullSeatSince?.getTime()).toBe(
        taken.getTime(),
      );
      expect(await seatHolds.findHeld({ organizationId })).toEqual([]);
    });

    it("keeps no seat for a directory offboarding of someone who held it over 30 days", async () => {
      const { organizationId, bar } = await acme({ barTookSeatDaysAgo: 45 });

      await seatHolds.holdSeatOfDepartingMember({ organizationId, userId: bar });

      expect(await seatHolds.findHeld({ organizationId })).toEqual([]);
    });

    /** @scenario "A person who accepts an invitation within their hold takes the held seat" */
    it("counts an invitation back once and gives the held seat back on acceptance", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });
      const taken = await tookSeatOn(organizationId, bar);
      const { email } = await prisma.user.findUniqueOrThrow({ where: { id: bar } });
      await remove(organizationId, adminId, bar);
      const invites = InviteService.create({
        invites: PrismaOrganizationInviteRepository.create({ database: prisma }),
        seats: InviteSeatCensusService.create(seatCounts, seatHolds),
        plans,
        grants: createApiFixture<AuthzApi>({
          revokeBindingsWhere: async () => 0,
          attachBindings: async () => ({ attached: [], duplicates: [] }),
        }),
        roles: createApiFixture<InviteAssignableRoles>(),
        throttle: createApiFixture<InviteSendThrottleService>(),
        baseHost: "https://app.langwatch.example",
      });

      // Every seat is taken, Bar's held one included: inviting Bar back needs no other.
      await invites.checkLicenseLimits({
        organizationId,
        newInvites: [{ role: OrganizationUserRole.MEMBER, teams: [], email: email ?? "" }],
      });
      const row = await prisma.organizationInvite.create({
        data: {
          email: email ?? "",
          inviteCode: nanoid(),
          organizationId,
          role: OrganizationUserRole.MEMBER,
          teamIds: "",
          expiration: daysFromNow(7),
        },
      });
      expect(await fullSeatsInUse(organizationId)).toBe(5);

      await invites.applyInvite({
        userId: bar,
        invite: {
          ...row,
          expiration: row.expiration ? fromDate(row.expiration) : null,
          createdAt: fromDate(row.createdAt),
          updatedAt: fromDate(row.updatedAt),
        },
      });

      expect(await fullSeatsInUse(organizationId)).toBe(5);
      expect((await membershipOf(organizationId, bar))?.fullSeatSince?.getTime()).toBe(
        taken.getTime(),
      );
      expect(await seatHolds.findHeld({ organizationId })).toEqual([]);
    });

    /** @scenario "A person who comes back as a Lite Member leaves the full seat held" */
    it("leaves the full seat held for someone who comes back on a Lite Member seat", async () => {
      const { organizationId, adminId, bar } = await acme({ barTookSeatDaysAgo: 3 });
      await remove(organizationId, adminId, bar);
      await prisma.organizationUser.create({
        data: { userId: bar, organizationId, role: OrganizationUserRole.EXTERNAL },
      });

      expect(await seatHolds.takeBackHeldSeat({ organizationId, userId: bar })).toBe(false);

      expect(await fullSeatsInUse(organizationId)).toBe(5);
      expect(await seatHolds.findHeld({ organizationId })).toMatchObject([
        { userId: bar, reason: "REMOVED" },
      ]);
    });
  });

  describe("when a seat frees, it goes to whoever is waiting", () => {
    /** @scenario "The removal of a long-held seat offers it to the person waiting" */
    it("gives the freed seat to the person waiting", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;

      const result = await remove(organizationId, adminId, bar, qux);

      expect(result).toEqual({ seatGivenToUserId: qux, seatHandoverFailed: false });
      expect(await membershipOf(organizationId, qux)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
        seatPendingSince: null,
      });
      expect(attachedBindings).toContainEqual({ organizationId, userId: qux, role: "MEMBER" });
      expect(await fullSeatsInUse(organizationId)).toBe(5);
    });

    /** @scenario "The removal can leave the freed seat empty" */
    it("leaves the seat empty when it is not given away", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });

      await remove(organizationId, adminId, bar);

      expect((await membershipOf(organizationId, waitingIds[0]!))?.seatPendingSince).not.toBeNull();
      expect(await fullSeatsInUse(organizationId)).toBe(4);
    });

    /** @scenario "A failed seat handover still removes the member" */
    it("keeps the removal and the person waiting when giving the seat fails", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;
      unreachablePlans.add(organizationId);
      try {
        const result = await remove(organizationId, adminId, bar, qux);

        expect(result).toEqual({ seatGivenToUserId: null, seatHandoverFailed: true });
      } finally {
        unreachablePlans.delete(organizationId);
      }
      expect(await membershipOf(organizationId, bar)).toBeNull();
      expect((await membershipOf(organizationId, qux))?.seatPendingSince).not.toBeNull();
    });

    /** @scenario "A seat handover whose grant fails after the enable still gives the seat" */
    it("answers the seat as given when the grant fails after the enable", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;
      admissionFailure = "attach";
      try {
        const result = await remove(organizationId, adminId, bar, qux);

        expect(result).toEqual({ seatGivenToUserId: qux, seatHandoverFailed: false });
      } finally {
        admissionFailure = null;
      }
      expect(await membershipOf(organizationId, bar)).toBeNull();
      expect(await membershipOf(organizationId, qux)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
        seatPendingSince: null,
        pendingSsoGrantId: expect.any(String),
      });
    });

    /** @scenario "A seat handover whose admission cannot be completed still gives the seat" */
    it("answers the seat as given when completing the admission fails", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;
      admissionFailure = "complete";
      try {
        const result = await remove(organizationId, adminId, bar, qux);

        expect(result).toEqual({ seatGivenToUserId: qux, seatHandoverFailed: false });
      } finally {
        admissionFailure = null;
      }
      expect(attachedBindings).toContainEqual({ organizationId, userId: qux, role: "MEMBER" });
      expect(await membershipOf(organizationId, qux)).toMatchObject({
        disabledAt: null,
        seatPendingSince: null,
        pendingSsoGrantId: expect.any(String),
      });
    });

    /** @scenario "The seat hold check finishes an admission whose grant failed" */
    it("lands the grant and completes the admission on the next seat hold check", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;
      admissionFailure = "attach";
      try {
        await remove(organizationId, adminId, bar, qux);
      } finally {
        admissionFailure = null;
      }
      expect(attachedBindings).not.toContainEqual({ organizationId, userId: qux, role: "MEMBER" });

      const outcome = await memberships.runSeatHoldCheck();

      expect(outcome.failures.map((failure) => failure.organizationId)).not.toContain(
        organizationId,
      );
      expect(attachedBindings).toContainEqual({ organizationId, userId: qux, role: "MEMBER" });
      expect((await membershipOf(organizationId, qux))?.pendingSsoGrantId).toBeNull();
    });

    /** @scenario "Enabling a person waiting for a seat admits them" */
    it("gives a waiting person their grant when an administrator enables them", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;
      await remove(organizationId, adminId, bar);

      await memberships.setMemberDisabled({
        organizationId,
        userId: qux,
        disabled: false,
        actingUser: { id: adminId },
      });

      expect(await membershipOf(organizationId, qux)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
        seatPendingSince: null,
      });
      expect(attachedBindings).toContainEqual({ organizationId, userId: qux, role: "MEMBER" });
    });

    /** @scenario "A person given a seat while waiting has their seat request closed" */
    it("approves the open seat request of a waiting person once they are admitted", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;
      const quxRow = await prisma.user.findUniqueOrThrow({ where: { id: qux } });
      const opened = await seatRequests.open({
        id: `seat-request-${nanoid(8)}`,
        organizationId,
        email: quxRow.email ?? "",
        userId: qux,
        name: "Qux",
        source: "pending",
        idpRefused: false,
        idpKind: null,
        at: Date.now(),
      });
      await remove(organizationId, adminId, bar);

      await memberships.setMemberDisabled({
        organizationId,
        userId: qux,
        disabled: false,
        actingUser: { id: adminId },
      });

      expect((await membershipOf(organizationId, qux))?.disabledAt).toBeNull();
      expect(await seatRequests.findOpen({ organizationId })).toEqual([]);
      expect(
        (await seatRequests.findForUser({ userId: qux })).find(
          (request) => request.id === opened.request.id,
        ),
      ).toMatchObject({ status: "APPROVED", resolvedByUserId: adminId });
    });

    /** @scenario "Enabling a person waiting for a seat is refused while no full seat fits" */
    it("keeps a waiting person waiting when no full seat fits, even with Lite seats free", async () => {
      const { organizationId, waitingIds } = await acme({ waiting: ["Qux"] });
      const qux = waitingIds[0]!;

      await expect(
        memberships.setMemberDisabled({ organizationId, userId: qux, disabled: false }),
      ).rejects.toBeInstanceOf(MemberSeatLimitReachedError);

      expect((await membershipOf(organizationId, qux))?.seatPendingSince).not.toBeNull();
      expect((await membershipOf(organizationId, qux))?.disabledAt).not.toBeNull();
    });

    /** @scenario "A hold that ends admits the person waiting longest" */
    it("admits the person waiting longest when a hold ends", async () => {
      const { organizationId, adminId, bar, waitingIds } = await acme({
        waiting: ["Qux", "Quux"],
      });
      const [qux, quux] = waitingIds;
      await remove(organizationId, adminId, bar);
      await heldUntil({
        organizationId,
        userId: bar,
        seatTakenAt: daysFromNow(-30),
        until: new Date(Date.now() - 60 * 60 * 1000),
      });

      await memberships.runSeatHoldCheck();

      expect(await membershipOf(organizationId, qux!)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      expect(attachedBindings).toContainEqual({ organizationId, userId: qux, role: "MEMBER" });
      expect((await membershipOf(organizationId, quux!))?.seatPendingSince).not.toBeNull();
      expect(await prisma.seatHold.count({ where: { organizationId } })).toBe(0);
    });

    /** @scenario "A seat hold check that fails in one organization retries it and admits in the others" */
    it("retries an organization whose admission failed without holding up the others", async () => {
      const failing = await acme({ waiting: ["Qux"] });
      const healthy = await acme({ waiting: ["Qux"] });
      for (const org of [failing, healthy]) {
        await remove(org.organizationId, org.adminId, org.bar);
        await heldUntil({
          organizationId: org.organizationId,
          userId: org.bar,
          seatTakenAt: daysFromNow(-30),
          until: new Date(Date.now() - 60 * 60 * 1000),
        });
      }
      unreachablePlans.add(failing.organizationId);

      const first = await memberships.runSeatHoldCheck();

      expect(first.failures.map((failure) => failure.organizationId)).toContain(
        failing.organizationId,
      );
      expect(await membershipOf(healthy.organizationId, healthy.waitingIds[0]!)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      expect(
        await prisma.seatHold.count({ where: { organizationId: healthy.organizationId } }),
      ).toBe(0);
      expect(
        (await membershipOf(failing.organizationId, failing.waitingIds[0]!))?.seatPendingSince,
      ).not.toBeNull();
      expect(
        await prisma.seatHold.count({ where: { organizationId: failing.organizationId } }),
      ).toBe(1);

      unreachablePlans.delete(failing.organizationId);
      await memberships.runSeatHoldCheck();

      expect(await membershipOf(failing.organizationId, failing.waitingIds[0]!)).toMatchObject({
        role: OrganizationUserRole.MEMBER,
        disabledAt: null,
      });
      expect(
        await prisma.seatHold.count({ where: { organizationId: failing.organizationId } }),
      ).toBe(0);
    });

    /** @scenario "A hold that ends with nobody waiting just frees the seat" */
    it("just frees the seat when nobody waits", async () => {
      const { organizationId, adminId, bar } = await acme();
      await remove(organizationId, adminId, bar);
      await heldUntil({
        organizationId,
        userId: bar,
        seatTakenAt: daysFromNow(-30),
        until: new Date(Date.now() - 60 * 60 * 1000),
      });

      await memberships.runSeatHoldCheck();

      expect(await fullSeatsInUse(organizationId)).toBe(4);
      expect(await prisma.seatHold.count({ where: { organizationId } })).toBe(0);
    });
  });

  describe("when the remove dialog opens, it says what happens to the seat", () => {
    /** @scenario "Removing a long-held seat with someone waiting" */
    it("says the seat frees at once and names who waits", async () => {
      const { organizationId, bar, waitingIds } = await acme({ waiting: ["Qux"] });

      const preview = await seatHolds.removalPreview({ organizationId, userId: bar });

      expect(preview).toMatchObject({
        holdsFullSeat: true,
        seatFreesAt: null,
        waiting: { userId: waitingIds[0], name: "Qux" },
      });
    });

    /** @scenario "Removing a recent seat" */
    it("says until when a recent seat stays taken", async () => {
      const { organizationId, bar, waitingIds } = await acme({
        barTookSeatDaysAgo: 3,
        waiting: ["Qux"],
      });
      const taken = (
        await prisma.organizationUser.findUniqueOrThrow({
          where: { userId_organizationId: { userId: bar, organizationId } },
        })
      ).createdAt;

      const preview = await seatHolds.removalPreview({ organizationId, userId: bar });

      expect(waitingIds).toHaveLength(1);
      expect(preview.holdsFullSeat).toBe(true);
      expect(preview.waiting).toBeNull();
      expect(preview.seatFreesAt?.epochMilliseconds).toBe(taken.getTime() + 30 * DAY_MS);
    });
  });
});
