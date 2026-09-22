import { createApiFixture } from "@langwatch/api-fixture";
import { AuthApi } from "@langwatch/auth-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { EventSourcing } from "@langwatch/eventing";
import { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { identityServer } from "../../identity.server.ts";

const bootIdentity = () =>
  createApp({ role: "api" })
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

describe("sso admission installation", () => {
  it("composes the pre-link gate, which refuses a provider that is not a connection", async () => {
    const runtime = await bootIdentity();

    try {
      const identity = runtime.service(IdentityApi);

      const decision = await identity.ssoAssertion().decide({
        providerId: "credential",
        email: "someone@example.com",
      });

      expect(decision).toMatchObject({ action: "reject" });
      if (decision.action !== "reject") throw new Error("the gate answered continue");
      expect(decision.reason).toBe("provider-is-not-a-connection");
      expect(decision.error.code).toBe("sso_sign_in_refused");
    } finally {
      await runtime.stop();
    }
  });

  it("composes the gate over this module's own rows: an unknown connection is refused", async () => {
    const runtime = await bootIdentity();

    try {
      const decision = await runtime.service(IdentityApi).ssoAssertion().decide({
        providerId: "local_ssoc_absent",
        email: "someone@example.com",
      });

      expect(decision).toMatchObject({ action: "reject", reason: "connection-not-found" });
    } finally {
      await runtime.stop();
    }
  });

  it("composes the arrival, which admits nobody through a provider that is not a connection", async () => {
    const runtime = await bootIdentity();

    try {
      // The peers are fixtures that throw by name on anything unconfigured,
      // so reaching either one here would fail this assertion.
      await expect(
        runtime
          .service(IdentityApi)
          .ssoArrival()
          .admit({
            user: { id: "user_1", email: "someone@example.com", name: "Someone" },
            connectionId: "credential",
            domain: "example.com",
          }),
      ).resolves.toBeUndefined();
    } finally {
      await runtime.stop();
    }
  });
});
