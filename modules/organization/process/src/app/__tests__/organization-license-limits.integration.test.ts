/**
 * @vitest-environment node
 *
 * `licenseEnforcement.checkLimit` answers from the plan and the seats the
 * organization holds, over real rows: the read that used to refuse every call.
 * @see specs/licensing/enforcement-members.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import { createLogger, type Logger } from "@langwatch/observability";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import { OrganizationUserRole } from "@langwatch/prisma-client/generated";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { cleanupTestRows } from "@langwatch/test-harness/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { InviteAssignableRoles } from "../../rules/invite-contracts.rules.ts";
import { LicenseLimitService } from "../../services/license-limit.service.ts";
import { buildOrganizationInfrastructure } from "../organization-composition.build.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;

describe.skipIf(!DB_URL)("given an organization with two full members and one lite member", () => {
  const prisma = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:organization:test:license-limits"),
  }).connect(
    PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
  ).client;

  function limitsOnPlan(plan: Partial<Plan>): LicenseLimitService {
    const entitlement = createApiFixture<Pick<EntitlementApi, "getActivePlan" | "requestBound">>({
      getActivePlan: async () =>
        createApiFixture<Plan>({ overrideAddingLimitations: false, ...plan }),
    });
    const infrastructure = buildOrganizationInfrastructure({
      prisma,
      encryption: { encrypt: (value) => value, decrypt: (value) => value },
      logger: createApiFixture<Logger>(),
      redis: createApiFixture<RedisConnection>(),
      publicBaseUrl: undefined,
      processName: "test",
      demoProject: { userId: "demo-user", projectId: "demo-project" },
      dependencies: {
        projects: createApiFixture<ProjectApi>(),
        identity: createApiFixture<Pick<IdentityApi, "verifiedEmailsOf" | "joinRequests">>(),
        entitlement,
        permissions: createApiFixture<AuthzApi>(),
        roles: createApiFixture<InviteAssignableRoles>(),
        governance: createApiFixture<Pick<GovernanceRestApi, "aiToolEnsureDefaultCatalog">>(),
      },
    });
    return LicenseLimitService.create({
      seats: infrastructure.seats,
      notices: null,
      signals: infrastructure.signals,
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
});
