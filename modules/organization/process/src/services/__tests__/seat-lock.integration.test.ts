/**
 * Two writes for the last free full seat at once, against Postgres: the seat lock lets exactly
 * one through and refuses the other with the seat-limit code.
 * @vitest-environment node
 * @see modules/organization/specs/seat-requests.feature
 */
import type { AuthzGrantsService } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
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

import { OrganizationSeatRepository } from "../../repositories/organization-seat.repository.ts";
import type { OrganizationSettingsCipher } from "../../repositories/organization.repository.ts";
import { PrismaOrganizationMembershipRepository } from "../../repositories/prisma/prisma.organization-membership.repository.ts";
import { PrismaOrganizationSeatRepository } from "../../repositories/prisma/prisma.organization-seat.repository.ts";
import { PrismaSeatRequestRepository } from "../../repositories/prisma/prisma.seat-request.repository.ts";
import type { OrganizationAccessNoticeService } from "../organization-access-notice.service.ts";
import { OrganizationMemberAdmissionService } from "../organization-member-admission.service.ts";
import { OrganizationMemberRoleService } from "../organization-member-role.service.ts";
import { OrganizationSeatLicenseService } from "../organization-seat-license.service.ts";
import { SeatLimitNoticeService } from "../seat-limit-notice.service.ts";
import { SeatRequestService, type SeatRequestPeers } from "../seat-request.service.ts";

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

  withSeatLock<T>(input: { organizationId: string; work: () => Promise<T> }): Promise<T> {
    return this.inner.withSeatLock(input);
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
      const roles = OrganizationMemberRoleService.create({
        repository: members,
        seats,
        seatNotices: { memberDisabled: async () => {}, memberEnabled: async () => {} },
        grantCache: { invalidateOrganization: async () => {} },
        ceiling: { assertWithinCaller: async () => {} },
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
        repository: members,
        admissions: createApiFixture<Dependencies["admissions"]>({}),
        seats,
        workspaceNotices: createApiFixture<Dependencies["workspaceNotices"]>({}),
        memberNotices: createApiFixture<Dependencies["memberNotices"]>({}),
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
