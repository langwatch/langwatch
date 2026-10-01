/**
 * @vitest-environment node
 *
 * The SCIM gate behind `group.listAll` reads the organization's plan, as main did.
 * @see specs/features/scim-group-mapping.feature
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi, Plan } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it } from "vitest";

import type { InviteAssignableRoles } from "../../rules/invite-contracts.rules.ts";
import { SignupAnnouncementService } from "../../services/signup-announcement.service.ts";
import { buildOrganizationInfrastructure } from "../organization-composition.build.ts";

function planGateFor({ planType }: { planType: string }) {
  const entitlement = createApiFixture<Pick<EntitlementApi, "getActivePlan" | "requestBound">>({
    getActivePlan: async () => createApiFixture<Plan>({ type: planType }),
  });

  return buildOrganizationInfrastructure({
    prisma: createApiFixture<ProcessMembers["prisma"]>(),
    encryption: { encrypt: (value) => value, decrypt: (value) => value },
    logger: createApiFixture<Logger>(),
    redis: createApiFixture<RedisConnection>(),
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
      notifications: createApiFixture<Pick<NotificationService, "sendEmail" | "getMailDelivery">>(),
    },
  }).plans;
}

describe("the SCIM plan gate", () => {
  it("admits an organization on an Enterprise plan", async () => {
    const plans = planGateFor({ planType: "ENTERPRISE" });

    await expect(plans.assertScimAllowed({ organizationId: "org-1" })).resolves.toBeUndefined();
  });

  /** @scenario "Non-enterprise org cannot access group management endpoints" */
  it("refuses an organization whose plan is not Enterprise", async () => {
    const plans = planGateFor({ planType: "FREE" });

    await expect(plans.assertScimAllowed({ organizationId: "org-1" })).rejects.toMatchObject({
      code: "enterprise_plan_required",
    });
  });
});
