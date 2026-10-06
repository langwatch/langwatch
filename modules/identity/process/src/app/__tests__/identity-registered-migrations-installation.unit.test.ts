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
import { IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME } from "../../rules/identity-migration-names.rules.ts";
import { grandfatheredConnectionFacts } from "../../rules/sso-connection-grandfather-facts.rules.ts";

/** An empty secrets chain: every optional handle, the sign-ups webhook included, reads as unset. */
const noSecretsChain = SecretsResolver.over(SecretsChain.start({ environment: {} }));

// Spec: specs/migration/system-migrations-runner.feature

/** An email-mode deployment: no federated provider, no licence, no passkeys, its own passwords. */
async function bootIdentity() {
  return createApp({
    role: "api",
    secrets: (owner, declared) => noSecretsChain.scopeTo(owner, declared),
  })
    .withModules([identityProcessModule])
    .withStores(memoryStores())
    .withConfig({
      identity: { ssoDomainProofDnsServers: [], isSaas: false, publicBaseUrl: undefined },
    })
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

describe("identity's registered migrations", () => {
  describe("when any system migration entry point reads the installed registry", () => {
    /** @scenario "The D04 connection grandfather migration is declared in the shared registry" */
    it("declares D04 under its state key and runs it on a fresh self-hosted start", async () => {
      const runtime = await bootIdentity();
      try {
        const registered = runtime.service(IdentityApi).registeredMigrations();
        const d04 = registered.find(
          (migration) => migration.name === IDENTITY_CONNECTION_GRANDFATHER_MIGRATION_NAME,
        );

        expect(d04).toMatchObject({
          name: "identity-d04-connection-grandfather",
          runsAutomaticallyOnSelfHosted: true,
          enrolledAutomatically: true,
        });
      } finally {
        await runtime.stop();
      }
    });

    /** @scenario "The D04 connection grandfather migration is declared in the shared registry" */
    it("records the legacy route as configuration, never as a proof of ownership", () => {
      const facts = grandfatheredConnectionFacts({
        connectionId: "conn-1",
        organizationId: "org-1",
        domains: ["acme.com"],
        actor: { type: "system", id: null },
        source: "legacy-grandfathered",
        type: "oidc",
        arrivalPolicy: "admit",
        idp: { issuer: null, providerId: "okta", clientIdRef: null, secretRef: null, certRefs: [] },
        commandId: "cmd-1",
        tenantId: "org-1",
        occurredAtMs: 1,
      } as Parameters<typeof grandfatheredConnectionFacts>[0]);
      const verified = facts.filter((fact) => fact.type.includes("verified"));

      expect(verified.length).toBeGreaterThan(0);
      for (const fact of verified) {
        expect(fact.data).toMatchObject({ method: "legacy-configuration" });
      }
    });
  });
});
