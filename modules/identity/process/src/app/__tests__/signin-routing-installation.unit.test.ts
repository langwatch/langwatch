import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
import { IdentityApi } from "@langwatch/identity-contract";
import { createApp, withMemoryRepositories } from "@langwatch/kernel";
import type { EmailDelivery } from "@langwatch/mail";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { identityServer } from "../../identity.server.ts";

// Spec: specs/identity/signin-router.feature

/** An email-mode deployment: no federated provider, no licence, no passkeys, its own passwords. */
async function bootIdentity() {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(identityServer)])
    .withMembers({
      mail: createApiFixture<EmailDelivery>(),
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
