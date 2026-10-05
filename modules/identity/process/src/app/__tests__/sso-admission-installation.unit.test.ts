import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
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

/** An empty secrets chain: every optional handle, the sign-ups webhook included, reads as unset. */
const noSecretsChain = SecretsResolver.over(SecretsChain.start({ environment: {} }));

const bootIdentity = () =>
  createApp({ role: "api", secrets: (owner, declared) => noSecretsChain.scopeTo(owner, declared) })
    .withModules([identityProcessModule])
    .withStores(memoryStores())
    .withConfig({
      identity: { ssoDomainProofDnsServers: [], isSaas: false, publicBaseUrl: undefined },
    })
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
