import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { createApp } from "@langwatch/process";
import { memoryStores } from "@langwatch/process-stores";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { isDeclaredMigrationStep, isTenantMigrationStep } from "@langwatch/upgrade/step";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { grandfatheredConnectionFacts } from "../../features/sso-connection/rules/sso-connection-grandfather-facts.rules.ts";
import { identityProcessModule } from "../../identity.module.ts";

/** An empty secrets chain: every optional handle, the sign-ups webhook included, reads as unset. */
const noSecretsChain = SecretsResolver.over(SecretsChain.start({ environment: {} }));

// Spec: specs/migration/system-migrations-runner.feature

/** An email-mode deployment: no federated provider, no licence, no passkeys, its own passwords. */
async function bootIdentity() {
  return createApp({
    role: "worker",
    secrets: (owner, declared) => noSecretsChain.scopeTo(owner, declared),
  })
    .withModules([identityProcessModule])
    .withStores(memoryStores())
    .withConfig({
      identity: {
        ssoDomainProofDnsServers: [],
        outboundProxy: {
          HTTPS_PROXY: undefined,
          https_proxy: undefined,
          HTTP_PROXY: undefined,
          http_proxy: undefined,
          NO_PROXY: undefined,
          no_proxy: undefined,
        },
        isSaas: false,
        publicBaseUrl: undefined,
        passkeysEnabled: false,
        mfaEnrollmentOpen: false,
        localPasswords: false,
        identifierBackfillMaxQueuedJobs: 5000,
      },
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

describe("identity's declared tenant steps", () => {
  describe("when any system migration entry point reads the installed registry", () => {
    /** @scenario "The D04 connection grandfather migration is declared in the shared registry" */
    it("declares the five tenant steps, D04 among them, each after old writers", async () => {
      const runtime = await bootIdentity();
      try {
        const steps = runtime.migrationSteps(isDeclaredMigrationStep).filter(isTenantMigrationStep);

        expect(steps.map(({ id, tenants }) => ({ id, tenants }))).toEqual([
          { id: "identity:identifier-backfill", tenants: "user" },
          { id: "identity:secret-heal", tenants: "user" },
          { id: "identity:connection-grandfather", tenants: "organization" },
          { id: "identity:sso-domain-ownership-backfill", tenants: "organization" },
        ]);
        expect(steps.every((step) => step.needsOldWritersGone)).toBe(true);
        expect(steps.find(({ id }) => id === "identity:connection-grandfather")).toMatchObject({
          runsAutomaticallyOnSelfHosted: true,
          enrolledAutomatically: true,
        });
        expect(steps.find(({ id }) => id === "identity:secret-heal")).toMatchObject({
          migratedIsSteady: true,
        });
        expect(steps.find(({ id }) => id === "identity:identifier-backfill")).toMatchObject({
          pauseWhileQueuedAbove: 5000,
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
