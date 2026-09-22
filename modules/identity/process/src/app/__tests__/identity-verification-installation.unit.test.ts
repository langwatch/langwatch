import { createApiFixture } from "@langwatch/api-fixture";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { identityServer } from "../../identity.server.ts";

describe("identity verification installation", () => {
  it("composes the ceremony behind IdentityApi and keeps an unlatched user from spending a proof", async () => {
    const runtime = await createApp({ role: "api" })
      .withModules([withMemoryRepositories(identityServer)])
      .withMembers({ producesPipelines: false, adminEmails: [] })
      .withConfig({ identity: { ssoDomainProofDnsServers: [] } })
      .withRelational(createApiFixture<PrismaClient>())
      .withEventing(new EventSourcing({ enabled: false }))
      .provide({
        organization: createApiFixture<OrganizationApi>(),
        authz: createApiFixture<AuthzApi>(),
        auth: createApiFixture<AuthApi>(),
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
