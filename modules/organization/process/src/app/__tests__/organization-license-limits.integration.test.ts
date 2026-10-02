import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { OrganizationInviteRateLimit } from "../organization.members.ts";
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
import type { InviteAssignableRoles } from "../../rules/invite-contracts.rules.ts";
import { LicenseLimitService } from "../../services/license-limit.service.ts";
import { SignupAnnouncementService } from "../../services/signup-announcement.service.ts";
import { buildOrganizationInfrastructure } from "../organization-composition.build.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given an organization with two full members and one lite member", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:license-limits"),
  }).connect(
    PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
  ).client;

  function infrastructureOnPlan(plan: Partial<Plan>) {
    const entitlement = createApiFixture<Pick<EntitlementApi, "getActivePlan" | "requestBound">>({
      getActivePlan: async () =>
        createApiFixture<Plan>({ overrideAddingLimitations: false, ...plan }),
    });
    const infrastructure = buildOrganizationInfrastructure({
      prisma,
      encryption: { encrypt: (value) => value, decrypt: (value) => value },
      logger: createApiFixture<Logger>(),
      inviteRateLimit: createApiFixture<OrganizationInviteRateLimit>(),
      publicBaseUrl: undefined,
      signupAnnouncements: SignupAnnouncementService.create({
        channel: undefined,
        publicBaseUrl: undefined,
        logger: createApiFixture<Logger>(),
      }),
      processName: "test",
      demoProject: { userId: "demo-user", projectId: "demo-project" },
      dependencies: {
        projects: createApiFixture<ProjectApi>(),
        identity: createApiFixture<Pick<IdentityApi, "verifiedEmailsOf" | "joinRequests">>(),
        entitlement,
        permissions: createApiFixture<AuthzApi>(),
        roles: createApiFixture<InviteAssignableRoles>(),
        notifications:
          createApiFixture<Pick<NotificationService, "sendEmail" | "getMailDelivery">>(),
      },
    });
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
});
