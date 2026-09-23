import { createApiFixture } from "@langwatch/api-fixture";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { identityServer } from "../../identity.server.ts";

describe("identity verification installation", () => {
  it("composes the ceremony behind IdentityApi and keeps an unlatched user from spending a proof", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([withMemoryRepositories(identityServer)])
      .withMembers({
        producesPipelines: false,
        adminEmails: [],
        publicBaseUrl: undefined,
        isSaas: false,
        rateLimiter: { check: async () => ({ allowed: true }) },
      })
      .withEncryption({ encrypt: (value) => value, decrypt: (value) => value })
      .withConfig({ identity: { ssoDomainProofDnsServers: [] } })
      .withRelational(createApiFixture<PrismaClient>())
      .withEventing(new EventSourcing({ enabled: false, processManagerMode: "producer-only" }))
      .provide({
        organization: createApiFixture<OrganizationApi>(),
        authz: createApiFixture<AuthzApi>(),
        auth: createApiFixture<AuthApi>(),
        user: createApiFixture<UserApi>(),
        entitlement: createApiFixture<EntitlementApi>(),
        "audit-log": createApiFixture<AuditLogApi>(),
        licensing: createApiFixture<LicensingApi>(),
      })
      .boot();

    try {
      const identity = runtime.service(IdentityApi);

      await expect(
        identity.completeEmailVerification({
          userId: "user_1",
          identifierId: "identifier_1",
          verificationId: "verification_1",
          token: "mailbox-token",
          codeVerifier: "a".repeat(43),
        }),
      ).rejects.toMatchObject({ code: "identity_verification_invalid" });
    } finally {
      await runtime.stop();
    }
  });
});
import { EventSourcing } from "@langwatch/eventing";
