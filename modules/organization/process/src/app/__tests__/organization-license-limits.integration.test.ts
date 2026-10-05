import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import { createLogger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
/**
 * @vitest-environment node
 *
 * `licenseEnforcement.checkLimit` answers from the plan and the seats the
 * organization holds, over real rows: the read that used to refuse every call.
 * @see specs/licensing/enforcement-members.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { RecordSeatLimitReachedCommandData } from "../../eventing/seat-limit.events.ts";
import { PrismaOrganizationSeatRepository } from "../../repositories/prisma/prisma.organization-seat.repository.ts";
import { LicenseLimitService } from "../../services/license-limit.service.ts";
import { OrganizationSeatLicenseService } from "../../services/organization-seat-license.service.ts";
import { SeatLimitNoticeService } from "../../services/seat-limit-notice.service.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given an organization with two full members and one lite member", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:license-limits"),
  }).connect(
    PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
  ).client;

  function infrastructureOnPlan(plan: Partial<Plan>) {
    const entitlement = createApiFixture<Pick<EntitlementApi, "getActivePlan">>({
      getActivePlan: async () =>
        createApiFixture<Plan>({ overrideAddingLimitations: false, ...plan }),
    });
    const seatLimits = SeatLimitNoticeService.create({
      signals: { reportError: () => {} },
    });
    const infrastructure = {
      seatLimits,
      seats: OrganizationSeatLicenseService.create({
        plans: entitlement,
        memberships: PrismaOrganizationSeatRepository.create(prisma),
        notices: seatLimits,
      }),
    };
    const recorded: RecordSeatLimitReachedCommandData[] = [];
    infrastructure.seatLimits.connect({
      send: async (data: RecordSeatLimitReachedCommandData) => {
        recorded.push(data);
      },
    });
    return { infrastructure, recorded };
  }

  function limitsOnPlan(plan: Partial<Plan>): LicenseLimitService {
    const { infrastructure } = infrastructureOnPlan(plan);
    return LicenseLimitService.create({
      seats: infrastructure.seats,
      notices: infrastructure.seatLimits,
    });
  }

  const namespace = `license-limits-${nanoid(8)}`;
  const userIds: string[] = [];
  let organizationId = "";

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: `ACME ${namespace}`, slug: `--test-org-${namespace}` },
    });
    organizationId = organization.id;
    const roles = [
      OrganizationUserRole.ADMIN,
      OrganizationUserRole.MEMBER,
      OrganizationUserRole.EXTERNAL,
      // Counted in neither pool: every count below stays 2 full and 1 lite.
      OrganizationUserRole.DEVELOPER,
    ];
    for (const [index, role] of roles.entries()) {
      const user = await prisma.user.create({
        data: { name: `Person ${index}`, email: `person-${index}-${namespace}@example.com` },
      });
      userIds.push(user.id);
      await prisma.organizationUser.create({ data: { userId: user.id, organizationId, role } });
    }
  });

  afterAll(async () => {
    if (!organizationId) return;
    await cleanupTestRows(prisma, [
      ["organizationUser", { organizationId }],
      ["organization", { id: organizationId }],
      ["user", { id: { in: userIds } }],
    ]);
  });

  /** @scenario "The members limit read answers the seats taken and the plan's allowance" */
  it("answers the members limit with the seats taken and the plan's allowance", async () => {
    const limits = limitsOnPlan({ maxMembers: 5, maxMembersLite: 1 });

    await expect(
      limits.check({ organizationId, limitType: "members" }, { id: userIds[0] ?? "" }),
    ).resolves.toEqual({ allowed: true, current: 2, max: 5, limitType: "members" });
  });

  it("refuses the next seat once the plan's allowance is spent", async () => {
    const limits = limitsOnPlan({ maxMembers: 2, maxMembersLite: 1 });

    const all = await limits.checkAll({ organizationId }, { id: userIds[0] ?? "" });

    expect(all).toEqual({
      members: { allowed: false, current: 2, max: 2, limitType: "members" },
      membersLite: { allowed: false, current: 1, max: 1, limitType: "membersLite" },
    });
  });

  /** @scenario "Role change refused at a seat limit triggers notification" */
  it("refuses promoting the lite member past the plan and records the seat-limit event", async () => {
    const { infrastructure, recorded } = infrastructureOnPlan({ maxMembers: 2, maxMembersLite: 1 });

    await expect(
      infrastructure.seats.assertRoleChangeAllowed({
        organizationId,
        currentRole: OrganizationUserRole.EXTERNAL,
        userPermissions: undefined,
        role: OrganizationUserRole.MEMBER,
      }),
    ).rejects.toMatchObject({ code: "resource_limit_exceeded" });
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([
      expect.objectContaining({ organizationId, limitType: "members", current: 2, max: 2 }),
    ]);
  });

  /** @scenario Developers are counted and never capped */
  it("lets a full member move onto a Developer seat with both pools full", async () => {
    const { infrastructure, recorded } = infrastructureOnPlan({ maxMembers: 2, maxMembersLite: 1 });

    await expect(
      infrastructure.seats.assertRoleChangeAllowed({
        organizationId,
        currentRole: OrganizationUserRole.MEMBER,
        userPermissions: undefined,
        role: OrganizationUserRole.DEVELOPER,
      }),
    ).resolves.toBeUndefined();
    await new Promise((resolve) => setImmediate(resolve));
    expect(recorded).toEqual([]);
  });
});
