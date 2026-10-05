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

// Spec: specs/identity/signin-router.feature

/** An email-mode deployment: no federated provider, no licence, no passkeys, its own passwords. */
async function bootIdentity() {
  return createApp({
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
      auth: createApiFixture<AuthApi>({
        resolveAuthProvider: async () => "email",
        offersPasskeys: () => false,
        issuesOwnPasswords: () => false,
      }),
      user: createApiFixture<UserApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      "audit-log": createApiFixture<AuditLogApi>(),
      licensing: createApiFixture<LicensingApi>({ isPlatformSsoLicensed: async () => false }),
      scim: createApiFixture<ScimApi>(),
      notification: createApiFixture<NotificationService>(),
    })
    .boot();
}

describe("sign-in routing installation", () => {
  describe("when an address nobody holds is submitted to the installed router", () => {
    /** @scenario "The installed router sends an address nobody holds to sign-up" */
    it("routes it to sign-up and offers no method", async () => {
      const runtime = await bootIdentity();
      try {
        const decision = await runtime
          .service(IdentityApi)
          .routeSignIn({ identifier: "nobody@home.net", breakGlass: false });

        expect(decision).toMatchObject({
          outcome: "route_to_signup",
          reasonCode: "identifier_unknown",
          methodSet: [],
        });
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when the front door asks before any address is typed", () => {
    it("offers this deployment's local password method", async () => {
      const runtime = await bootIdentity();
      try {
        const decision = await runtime
          .service(IdentityApi)
          .routeSignIn({ identifier: null, breakGlass: false });

        expect(decision).toMatchObject({
          outcome: "method_picker",
          methodSet: [{ id: "password", kind: "password", connectionId: null }],
        });
      } finally {
        await runtime.stop();
      }
    });
  });
});
