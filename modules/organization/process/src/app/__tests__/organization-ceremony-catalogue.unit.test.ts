/**
 * @vitest-environment node
 *
 * The sign-up ceremony seeds the standard AI-tool catalogue through governance,
 * as main's onboarding did.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { Logger } from "@langwatch/observability";
import type { ProcessMembers } from "@langwatch/process-stores/members";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RedisConnection } from "@langwatch/redis-client";
import { describe, expect, it, vi } from "vitest";

import type { InviteAssignableRoles } from "../../rules/invite-contracts.rules.ts";
import { SignupAnnouncementService } from "../../services/signup-announcement.service.ts";
import { buildOrganizationInfrastructure } from "../organization-composition.build.ts";

function ceremonyOver({
  governance,
}: {
  governance: Pick<GovernanceRestApi, "aiToolEnsureDefaultCatalog">;
}) {
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
      entitlement: createApiFixture<Pick<EntitlementApi, "getActivePlan" | "requestBound">>(),
      permissions: createApiFixture<AuthzApi>(),
      roles: createApiFixture<InviteAssignableRoles>(),
      notifications: createApiFixture<Pick<NotificationService, "sendEmail" | "getMailDelivery">>(),
      governance,
    },
  }).ceremony;
}

describe("the sign-up ceremony's catalogue seed", () => {
  it("asks governance to seed the new organization's default catalogue", async () => {
    const aiToolEnsureDefaultCatalog = vi.fn(async () => ({ hasSeeded: true, created: 3 }));

    await ceremonyOver({ governance: { aiToolEnsureDefaultCatalog } }).ensureDefaultAiToolCatalog({
      organizationId: "org-new",
    });

    expect(aiToolEnsureDefaultCatalog).toHaveBeenCalledWith({ organizationId: "org-new" });
  });

  it("passes a governance refusal on for the initialization service to report", async () => {
    const refusal = new Error("governance unavailable");
    const ceremony = ceremonyOver({
      governance: {
        aiToolEnsureDefaultCatalog: vi.fn(async () => {
          throw refusal;
        }),
      },
    });

    await expect(ceremony.ensureDefaultAiToolCatalog({ organizationId: "org-new" })).rejects.toBe(
      refusal,
    );
  });
});
