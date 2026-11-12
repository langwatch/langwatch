/**
 * Two writes for the last free full seat at once, against Postgres: the seat lock lets exactly
 * one through and refuses the other with the seat-limit code.
 * @vitest-environment node
 * @see modules/organization/specs/seat-requests.feature
 */
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { EntitlementApi, MemberType, Plan } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationMemberSeats } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole, type PrismaClient } from "@langwatch/prisma-client/generated";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  type OrganizationSeatHolding,
  OrganizationSeatRepository,
  type SeatLease,
} from "../../repositories/organization-seat.repository.ts";
import type { OrganizationSettingsCipher } from "../../repositories/organization.repository.ts";
import { PrismaOrganizationMembershipRepository } from "../../repositories/prisma/prisma.organization-membership.repository.ts";
import { PrismaOrganizationSeatRepository } from "../../repositories/prisma/prisma.organization-seat.repository.ts";
import { PrismaSeatHoldRepository } from "../../repositories/prisma/prisma.seat-hold.repository.ts";
import { PrismaSeatRequestRepository } from "../../repositories/prisma/prisma.seat-request.repository.ts";
import type { OrganizationAccessNoticeService } from "../organization-access-notice.service.ts";
import { OrganizationMemberAdmissionService } from "../organization-member-admission.service.ts";
import { OrganizationMembershipService } from "../organization-membership.service.ts";
import { OrganizationSeatLeaseService } from "../organization-seat-lease.service.ts";
import { OrganizationSeatLicenseService } from "../organization-seat-license.service.ts";
import { SeatLimitNoticeService } from "../seat-limit-notice.service.ts";
import { SeatRequestService, type SeatRequestPeers } from "../seat-request.service.ts";
import { withSeatHolds } from "./support/seat-holds.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

/** How long every seat count holds its answer before handing it back. */
const COUNT_DELAY_MS = 300;

/**
 * The Postgres seat repository, with every seat count answered COUNT_DELAY_MS after it was
 * read, so two racing writes both count before either writes unless the lease keeps the
 * second out until the first has written.
 */
class DelayedCountSeatRepository extends OrganizationSeatRepository {
  constructor(private readonly inner: OrganizationSeatRepository) {
    super();
  }

  getMemberCount(organizationId: string): Promise<number> {
    return this.inner.getMemberCount(organizationId);
  }

  getMembersLiteCount(organizationId: string): Promise<number> {
    return this.inner.getMembersLiteCount(organizationId);
  }

  getMembersDeveloperCount(organizationId: string): Promise<number> {
    return this.inner.getMembersDeveloperCount(organizationId);
  }

  async countMemberSeats(organizationId: string): Promise<OrganizationMemberSeats> {
    const seats = await this.inner.countMemberSeats(organizationId);
    await new Promise((resolve) => setTimeout(resolve, COUNT_DELAY_MS));
    return seats;
  }

  findFullSeatHolderIds(organizationId: string): Promise<string[]> {
    return this.inner.findFullSeatHolderIds(organizationId);
  }

  findSeatHolders(organizationId: string): Promise<OrganizationSeatHolding[]> {
    return this.inner.findSeatHolders(organizationId);
  }

  findMemberSeat(input: { organizationId: string; userId: string }): Promise<MemberType | null> {
    return this.inner.findMemberSeat(input);
  }

  findInvitationSeat(input: {
    organizationId: string;
    inviteId: string;
  }): Promise<MemberType | null> {
    return this.inner.findInvitationSeat(input);
  }

  withSeatLock<T>(input: {
    organizationId: string;
    work: (lease: SeatLease) => Promise<T>;
  }): Promise<T> {
    return this.inner.withSeatLock(input);
  }

  acquireSeatLease(input: { organizationId: string }) {
    return this.inner.acquireSeatLease(input);
  }

  renewSeatLease(input: { organizationId: string; holder: string }): Promise<boolean> {
    return this.inner.renewSeatLease(input);
  }

  releaseSeatLease(input: { organizationId: string; holder: string }): Promise<void> {
    return this.inner.releaseSeatLease(input);
  }
}

describe.skipIf(!DB_URL)("two seat-taking writes for the last free full seat", () => {
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:seat-lock"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client as PrismaClient;
  const namespace = `seat-lock-${nanoid(8)}`;
  const organizationIds: string[] = [];
  const userIds: string[] = [];

  /** Every organization here allows two full seats; the administrator holds one. */
  const plan = createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
    getActivePlan: async () =>
      createApiFixture<Plan>({
        overrideAddingLimitations: false,
        maxMembers: 2,
        maxMembersLite: 100,
      }),
  });
  const seatLimits = SeatLimitNoticeService.create({ signals: { reportError: () => {} } });
  seatLimits.connect({ send: async () => {} });
  const seats = OrganizationSeatLicenseService.create({
    plans: plan,
    memberships: new DelayedCountSeatRepository(PrismaOrganizationSeatRepository.create(prisma)),
    notices: seatLimits,
  });
  const members = PrismaOrganizationMembershipRepository.create({
    database: prisma,
    grants: createApiFixture<AuthzGrantsService>({}),
    cipher: createApiFixture<OrganizationSettingsCipher>({}),
  });

  async function person(label: string): Promise<{ id: string; email: string }> {
    const email = `${label}-${namespace}@acme.example`;
    const user = await prisma.user.create({ data: { name: label, email } });
    userIds.push(user.id);
    return { id: user.id, email };
  }

  /** An organization whose administrator holds the first of its two full seats. */
  async function organizationWithOneSeatFree(): Promise<{
    organizationId: string;
    adminId: string;
  }> {
    const organization = await prisma.organization.create({
      data: { name: `ACME ${namespace}`, slug: `--test-org-${namespace}-${nanoid(6)}` },
    });
    organizationIds.push(organization.id);
    const admin = await person(`admin-${organization.id}`);
    await prisma.organizationUser.create({
      data: { userId: admin.id, organizationId: organization.id, role: OrganizationUserRole.ADMIN },
    });
    return { organizationId: organization.id, adminId: admin.id };
  }

  afterAll(async () => {
    await cleanupTestRows(prisma, [
      ["seatRequest", { organizationId: { in: organizationIds } }],
      ["organizationUser", { organizationId: { in: organizationIds } }],
      ["organization", { id: { in: organizationIds } }],
      ["user", { id: { in: userIds } }],
    ]);
    await connection.closeOnce();
  });

  describe("when two administrators approve two held people's seat requests at once", () => {
    const requests = PrismaSeatRequestRepository.create(prisma);
    let organizationId = "";
    let adminId = "";
    const held: { userId: string; requestId: string }[] = [];

    beforeAll(async () => {
      ({ organizationId, adminId } = await organizationWithOneSeatFree());
      for (const label of ["first", "second"]) {
        const { id: userId, email } = await person(label);
        await prisma.organizationUser.create({
          data: {
            userId,
            organizationId,
            role: OrganizationUserRole.MEMBER,
            disabledAt: new Date(),
          },
        });
        const opened = await requests.open({
          id: `${namespace}-${label}`,
          organizationId,
          email,
          userId,
          name: label,
          source: "pending",
          idpRefused: false,
          idpKind: null,
          at: Date.now(),
        });
        held.push({ userId, requestId: opened.request.id });
      }
    });

    /** @scenario "Two approvals for the last free full seat at once: exactly one wins" */
    it("enables exactly one, refuses the other with member_seat_limit_reached and keeps it open", async () => {
      type Dependencies = Parameters<typeof OrganizationMembershipService.create>[0];
      const roles = OrganizationMembershipService.create({
        ...withSeatHolds({
          repository: members,
          holds: PrismaSeatHoldRepository.create(prisma),
          seatRequests: requests,
        }),
        seats,
        seatNotices: { memberDisabled: async () => {}, memberEnabled: async () => {} },
        grantCache: { invalidateOrganization: async () => {} },
        ceiling: { assertWithinCaller: async () => {} },
        creations: createApiFixture<Dependencies["creations"]>({}),
        testArrivals: createApiFixture<Dependencies["testArrivals"]>({}),
        admissions: createApiFixture<Dependencies["admissions"]>({}),
        workspaceNotices: createApiFixture<Dependencies["workspaceNotices"]>({}),
        memberNotices: createApiFixture<Dependencies["memberNotices"]>({}),
      });
      const service = SeatRequestService.create({
        requests,
        members,
        memberships: {
          changeMemberRole: (input) => roles.changeMemberRole(input),
          setMemberDisabled: (input) => roles.setMemberDisabled(input),
          findAdministrators: async () => [],
        },
        seats,
        notices: createApiFixture<OrganizationAccessNoticeService>({}),
        peers: createApiFixture<SeatRequestPeers>({}),
        isSaas: true,
        now: () => Date.now(),
        newId: () => nanoid(),
        logger: createTestLogger().logger,
      });

      const outcomes = await Promise.allSettled(
        held.map(({ requestId }) =>
          service.approve({ organizationId, seatRequestId: requestId, by: { id: adminId } }),
        ),
      );

      const won = outcomes.filter((outcome) => outcome.status === "fulfilled");
      const refused = outcomes.flatMap((outcome) =>
        outcome.status === "rejected" ? [outcome.reason] : [],
      );
      expect(won).toEqual([{ status: "fulfilled", value: { outcome: "enabled" } }]);
      expect(refused).toEqual([expect.objectContaining({ code: "member_seat_limit_reached" })]);

      const rows = await prisma.organizationUser.findMany({
        where: { organizationId, userId: { in: held.map(({ userId }) => userId) } },
        select: { userId: true, disabledAt: true },
      });
      expect(rows.filter((row) => row.disabledAt === null)).toHaveLength(1);
      const losing = held[outcomes.findIndex((outcome) => outcome.status === "rejected")];
      await expect(
        requests.getOpen({ organizationId, id: losing?.requestId ?? "" }),
      ).resolves.toMatchObject({ id: losing?.requestId });
    });
  });

  describe("when two people arrive by single sign-on asking for a full seat at once", () => {
    /** @scenario "Two single sign-on arrivals for the last free full seat at once: exactly one gets it" */
    it("admits exactly one as a full member and the other as a Lite Member", async () => {
      const { organizationId } = await organizationWithOneSeatFree();
      const arrivals = [await person("sso-first"), await person("sso-second")];
      type Dependencies = Parameters<typeof OrganizationMemberAdmissionService.create>[0];
      // An arrival with no admitting actor writes only its membership row.
      const admission = OrganizationMemberAdmissionService.create({
        admissions: createApiFixture<Dependencies["admissions"]>({}),
        seats,
        workspaceNotices: createApiFixture<Dependencies["workspaceNotices"]>({}),
        memberNotices: createApiFixture<Dependencies["memberNotices"]>({}),
        ...withSeatHolds({ repository: members, holds: PrismaSeatHoldRepository.create(prisma) }),
      });

      const admitted = await Promise.all(
        arrivals.map(({ id }) =>
          admission.createMembership({ organizationId, userId: id, seat: "MEMBER" }),
        ),
      );

      expect(admitted.map((entry) => entry.outcome)).toEqual(["created", "created"]);
      const seatsTaken = admitted.map((entry) => (entry.outcome === "created" ? entry.seat : null));
      expect(seatsTaken.toSorted((a, b) => String(a).localeCompare(String(b)))).toEqual([
        "EXTERNAL",
        "MEMBER",
      ]);
    });
  });

  describe("when a directory admission holds the seat lease through the organization Api", () => {
    /** @scenario "A seat lease taken through the organization Api holds off the organization's own seat writes" */
    it("keeps the organization's own seat write waiting until the lease is released", async () => {
      const seatRepository = PrismaOrganizationSeatRepository.create(prisma);
      const lease = OrganizationSeatLeaseService.create(seatRepository);
      const organizationId = `${namespace}-api-lease`;
      const events: string[] = [];

      const { holder } = await lease.acquire({ organizationId });
      const write = seatRepository.withSeatLock({
        organizationId,
        work: async () => {
          events.push("organization write");
        },
      });
      await new Promise((resolve) => setTimeout(resolve, 400));
      events.push("directory released");
      await lease.release({ organizationId, holder });
      await write;

      expect(events).toEqual(["directory released", "organization write"]);
    });
  });

  describe("when the holder of a seat lease renews it", () => {
    /** @scenario "Renewing a seat lease extends only the holder's own lease" */
    it("pushes out that holder's expiry and leaves a lease held by someone else alone", async () => {
      const lease = OrganizationSeatLeaseService.create(
        PrismaOrganizationSeatRepository.create(prisma),
      );
      const organizationId = `${namespace}-renew`;
      const expiry = async () =>
        (await prisma.organizationSeatLease.findUniqueOrThrow({ where: { organizationId } }))
          .expiresAt;

      const { holder } = await lease.acquire({ organizationId });
      try {
        await prisma.organizationSeatLease.update({
          where: { organizationId },
          data: { expiresAt: new Date(Date.now() + 1_000) },
        });
        const shortened = await expiry();

        expect(await lease.renew({ organizationId, holder: "someone-else" })).toBe(false);
        expect(await expiry()).toEqual(shortened);

        expect(await lease.renew({ organizationId, holder })).toBe(true);
        expect((await expiry()).getTime()).toBeGreaterThan(shortened.getTime() + 10_000);
      } finally {
        await lease.release({ organizationId, holder });
      }
    });
  });

  describe("when the seat lease expires mid-change and another change takes it", () => {
    /** @scenario "A seat change whose lease was taken over writes nothing" */
    it("refuses the first change's write seat_change_busy and lets the new holder write", async () => {
      const seatRepository = PrismaOrganizationSeatRepository.create(prisma);
      const organizationId = `${namespace}-fence`;
      const writes: string[] = [];

      const first = seatRepository.withSeatLock({
        organizationId,
        work: async (lease) => {
          // The holder stalls past its expiry, and a second change takes the lease meanwhile.
          await prisma.organizationSeatLease.update({
            where: { organizationId },
            data: { expiresAt: new Date(Date.now() - 1_000) },
          });
          await seatRepository.withSeatLock({
            organizationId,
            work: async (taken) => {
              await taken.assertHeld();
              writes.push("second");
            },
          });
          await lease.assertHeld();
          writes.push("first");
        },
      });

      await expect(first).rejects.toMatchObject({ code: "seat_change_busy" });
      expect(writes).toEqual(["second"]);
    });
  });

  describe("when many organizations change seats at once on a pool of two connections", () => {
    /** @scenario "Seat changes on many organizations at once never starve the connection pool" */
    it("completes every one, since a held lease pins no connection", async () => {
      const url = new URL(DB_URL ?? "");
      url.searchParams.set("connection_limit", "2");
      url.searchParams.set("pool_timeout", "3");
      const small = PrismaConnectionService.create({
        guard: PrismaTenancyGuardService.create(),
        logger: createLogger("langwatch:organization:test:seat-lock-pool"),
      }).connect(
        PrismaConfigService.create().resolve({ databaseUrl: url.toString(), log: ["error"] }),
      );
      const smallClient = small.client as PrismaClient;
      const seatRepository = PrismaOrganizationSeatRepository.create(smallClient);
      const organizations = Array.from({ length: 8 }, (_, index) => `${namespace}-pool-${index}`);

      try {
        const counted = await Promise.all(
          organizations.map((organizationId) =>
            seatRepository.withSeatLock({
              organizationId,
              // A count, then a write in its own transaction, as an invitation batch does.
              work: async () => {
                const seats = await seatRepository.countMemberSeats(organizationId);
                await smallClient.$transaction(async (transaction) => {
                  await transaction.organizationUser.findMany({ where: { organizationId } });
                  await new Promise((resolve) => setTimeout(resolve, 50));
                });
                return seats.fullMembers;
              },
            }),
          ),
        );

        expect(counted).toEqual(organizations.map(() => 0));
      } finally {
        await small.closeOnce();
      }
    });
  });
});
