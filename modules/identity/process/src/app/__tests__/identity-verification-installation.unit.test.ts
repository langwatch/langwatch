import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { identityProcessModule } from "../../identity.module.ts";

describe("identity verification installation", () => {
  it("composes the ceremony behind IdentityApi and keeps an unlatched user from spending a proof", async () => {
    const runtime = await createApp({
      role: "api",
      secrets: (owner, declared) => noSecretsChain.scopeTo(owner, declared),
    })
      .withModules([identityProcessModule])
      .withStores(memoryStores())
      .withMembers({ publicBaseUrl: undefined })
      .withConfig({ identity: { ssoDomainProofDnsServers: [], isSaas: false } })
      .withEventing(new EventSourcing({ enabled: false, processManagerMode: "producer-only" }))
      .provide({
        organization: createApiFixture<OrganizationApi>(),
        authz: createApiFixture<AuthzApi>(),
        auth: createApiFixture<AuthApi>(),
        user: createApiFixture<UserApi>(),
        entitlement: createApiFixture<EntitlementApi>(),
        "audit-log": createApiFixture<AuditLogApi>(),
        licensing: createApiFixture<LicensingApi>(),
        scim: createApiFixture<ScimApi>(),
        notification: createApiFixture<NotificationService>(),
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

/** An empty secrets chain: every optional handle, the sign-ups webhook included, reads as unset. */
const noSecretsChain = SecretsResolver.over(SecretsChain.start({ environment: {} }));
