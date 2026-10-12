import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { ScimApi } from "@langwatch/enterprise-scim-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/process";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import { IdentityModule } from "../app/identity.app.ts";
import { MemoryIdentityChannels } from "../channels/memory/memory.identity.channels.ts";
import { MemoryIdentityRepositories } from "../repositories/memory/memory.identity.repositories.ts";

const LATCHED = "user-latched";
const ACCOUNT = {
  id: "account-1",
  userId: LATCHED,
  providerId: "credential",
  accountId: LATCHED,
  createdAt: new Date(0),
};

/** Identity installed over its memory twins, one user already latched; no event stack connected. */
async function identityWithLatchedUser(): Promise<IdentityModule> {
  const repositories = MemoryIdentityRepositories.create();
  await repositories.latch.recordFinalized({ userId: LATCHED, report: null });
  const config = {
    ssoDomainProofDnsServers: [],
    isSaas: false,
    publicBaseUrl: undefined,
    passkeysEnabled: false,
    mfaEnrollmentOpen: false,
    localPasswords: true,
  };
  return IdentityModule.create({
    config,
    dependencies: {
      organizations: createApiFixture<OrganizationApi>(),
      permissions: createApiFixture<AuthzApi>(),
      users: createApiFixture<UserApi>(),
      entitlements: createApiFixture<EntitlementApi>(),
      auditLog: createApiFixture<AuditLogApi>(),
      licensing: createApiFixture<LicensingApi>(),
      scim: createApiFixture<ScimApi>(),
      notifications: createApiFixture<NotificationService>(),
    },
    resources: new ResourceScope(),
    secrets: new ScopedSecrets(async (_handle, build) => build(undefined)),
    repositories,
    channels: MemoryIdentityChannels.create({
      config,
      bound: {
        authReads: createApiFixture<AuthApi>(),
        authCommands: createApiFixture<AuthApi>(),
        notifications: createApiFixture<NotificationService>(),
      },
    }),
  });
}

describe("given a latched user", () => {
  describe("when auth's account hooks run beside the identity adapter", () => {
    /** @scenario "The API process composes the identity branch when it has an event stack" */
    it("binds the bridge ceremonies, leaving the account attach to the adapter alone", async () => {
      const identity = await identityWithLatchedUser();

      // The raw ceremony would pin the row and state the attach; with no event stack it
      // would throw.
      await expect(identity.ceremonies().createAccountIdentifier(ACCOUNT)).resolves.toEqual({
        pinned: false,
      });
      await expect(identity.ceremonies().beforeAccountDelete(ACCOUNT)).resolves.toBeUndefined();
    });
  });
});
