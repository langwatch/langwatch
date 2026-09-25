import { createApiFixture } from "@langwatch/api-fixture";
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EventSourcing } from "@langwatch/eventing";
import type { IdentityLookupApi } from "@langwatch/identity-contract";
import { createApp, type FeatureTrpcHost, withMemoryRepositories } from "@langwatch/kernel";
import type { EmailDelivery } from "@langwatch/mail";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { identityServer } from "../../identity.server.ts";

/** A process's tRPC root, answering with the app each namespace was handed. */
function recordingTrpcHost(): FeatureTrpcHost<Readonly<{ app: unknown }>> {
  return { mount: (_declaration, app) => ({ app: app() }) };
}

/** The door-facing token is served by the module's one app, which the mount hands the router. */
function isIdentityLookupApi(value: unknown): value is IdentityLookupApi {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "lookupAddress") === "function"
  );
}

async function bootIdentity() {
  return createApp({ role: "api" })
    .withModules([withMemoryRepositories(identityServer)])
    .withMembers({
      mail: createApiFixture<EmailDelivery>(),
      adminEmails: ["olive@langwatch.ai"],
      publicBaseUrl: undefined,
      isSaas: false,
      rateLimiter: { check: async () => ({ allowed: true }) },
    })
    .withEncryption({ encrypt: (value) => value, decrypt: (value) => value })
    .withConfig({ identity: { ssoDomainProofDnsServers: [] } })
    .withRelational(createApiFixture<PrismaClient>())
    .withEventing(new EventSourcing({ enabled: false, processManagerMode: "producer-only" }))
    .expose(() => ({ hosts: { trpc: recordingTrpcHost() }, serve: () => undefined }))
    .provide({
      organization: createApiFixture<OrganizationApi>(),
      authz: createApiFixture<AuthzApi>(),
      auth: createApiFixture<AuthApi>(),
      user: createApiFixture<UserApi>(),
      entitlement: createApiFixture<EntitlementApi>(),
      "audit-log": createApiFixture<AuditLogApi>({
        record: async () => ({ id: "audit_1", occurredAt: 0 }),
      }),
      licensing: createApiFixture<LicensingApi>(),
      scim: createApiFixture<ScimApi>(),
    })
    .boot();
}

describe("identity lookup installation", () => {
  describe("when the identity module boots in the api role", () => {
    it("mounts the identityLookup tRPC namespace on the module's own app", async () => {
      const runtime = await bootIdentity();
      try {
        expect(runtime.transports.trpc.identityLookup).toBeDefined();
      } finally {
        await runtime.stop();
      }
    });
  });

  describe("when somebody outside the staff list resolves an address", () => {
    it("refuses with the generic not_found through IdentityLookupApi", async () => {
      const runtime = await bootIdentity();
      try {
        const lookup = runtime.transports.trpc.identityLookup?.app;
        if (!isIdentityLookupApi(lookup)) throw new Error("identityLookup mounted no lookup app");

        await expect(
          lookup.lookupAddress({ address: "sam@acme.com", operator: { userId: "user_mallory" } }),
        ).rejects.toMatchObject({ code: "not_found", httpStatus: 404 });
      } finally {
        await runtime.stop();
      }
    });
  });
});
