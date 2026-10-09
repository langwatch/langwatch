/**
 * An invite link's landing is organization's read, reached through auth's peers (WEB-860).
 * @see modules/organization/specs/invitations.feature
 */
import type { AuditLogApi } from "@langwatch/audit-log-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { LicensingApi } from "@langwatch/enterprise-licensing-contract";
import type { SsoApi } from "@langwatch/enterprise-sso-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryAuthChannels } from "../../channels/memory/memory.auth.channels.ts";
import { MemoryAuthRepositories } from "../../repositories/memory/memory.auth.repositories.ts";
import { AuthModule } from "../auth.app.ts";
import { NO_SIGN_IN_PROVIDERS } from "./support/sign-in-providers.ts";
import { TestUserApi } from "./support/test-user-api.ts";

const LANDING = {
  organizationName: "Acme",
  inviterName: "Ana",
  alreadyAccepted: false,
};

async function appWith(organizations: OrganizationApi): Promise<AuthModule> {
  return AuthModule.create({
    config: {
      sessionUrl: undefined,
      mfaEnrollmentOpen: false,
      passkeysEnabled: false,
      passkeyHandleSecret: undefined,
      trustedIdpOrigins: undefined,
      idpSimulatorUrl: undefined,
      localPasswords: false,
      auth0ManagementClientId: undefined,
      cliRefreshTokenTtlSeconds: undefined,
      isSaas: false,
      signInProviders: NO_SIGN_IN_PROVIDERS,
      signUpMode: "open",
      publicBaseUrl: undefined,
      nodeEnvironment: undefined,
    },
    repositories: MemoryAuthRepositories.create(),
    dependencies: {
      projects: createApiFixture<ProjectApi>(),
      users: new TestUserApi({}) as never,
      apiKeys: {} as never,
      featureFlags: {} as never,
      identity: createApiFixture<IdentityApi>({
        createStorageAdapter: ({ legacyEngine }) => legacyEngine,
      }),
      organizations,
      entitlements: createApiFixture<EntitlementApi>(),
      licensing: createApiFixture<LicensingApi>(),
      notifications: createApiFixture<NotificationService>(),
      sso: createApiFixture<SsoApi>(),
      authz: createApiFixture<AuthzApi>({}),
      auditLog: createApiFixture<AuditLogApi>(),
    },
    channels: MemoryAuthChannels.create({
      bound: { notifications: createApiFixture<NotificationService>() },
    }),
    resources: { own: () => undefined } as never,
    secrets: new ScopedSecrets(async (_handle, build) => build(void 0)),
  });
}

describe("given an invitee opening an invite link", () => {
  describe("when auth reads the landing", () => {
    it("answers organization's landing for the code", async () => {
      const getInviteLanding = vi.fn(async () => LANDING);
      const app = await appWith(createApiFixture<OrganizationApi>({ getInviteLanding }));

      await expect(app.readInviteLanding({ inviteCode: "code-1" })).resolves.toEqual(LANDING);
      expect(getInviteLanding).toHaveBeenCalledWith({ inviteCode: "code-1" });
    });
  });

  describe("when the invitee asks for a fresh invite", () => {
    it("asks organization to tell the admins", async () => {
      const requestFreshInvite = vi.fn(async () => undefined);
      const app = await appWith(createApiFixture<OrganizationApi>({ requestFreshInvite }));

      await app.requestFreshInvite({ inviteCode: "code-1" });

      expect(requestFreshInvite).toHaveBeenCalledWith({ inviteCode: "code-1" });
    });
  });
});
