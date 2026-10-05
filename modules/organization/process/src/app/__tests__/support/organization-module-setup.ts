import type { ApiKeyApi } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { ResourceScope } from "@langwatch/process";
import type { ProjectApi } from "@langwatch/project-contract";
import type { RoleApi } from "@langwatch/role-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import type { ShareApi } from "@langwatch/share-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { UserApi } from "@langwatch/user-contract";

import { MemoryOrganizationRepositories } from "../../../repositories/memory/memory.organization.repositories.ts";
import type { OrganizationModule } from "../../organization.app.ts";

export type OrganizationModuleSetup = Parameters<typeof OrganizationModule.create>[0];

type Peers = OrganizationModuleSetup["dependencies"];

/** No secret resolves: the sign-up announcement composes with no channel. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/**
 * What `OrganizationModule.create` receives at boot, over the memory tier of the module's own
 * registry. Every peer a suite does not name is a fixture that throws by name when touched.
 */
export function organizationModuleSetup(peers: Partial<Peers> = {}): OrganizationModuleSetup {
  return {
    dependencies: {
      projects: peers.projects ?? createApiFixture<ProjectApi>({}, "ProjectApi"),
      permissions: peers.permissions ?? createApiFixture<AuthzApi>({}, "AuthzApi"),
      users: peers.users ?? createApiFixture<UserApi>({}, "UserApi"),
      shares: peers.shares ?? createApiFixture<ShareApi>({}, "ShareApi"),
      apiKeys: peers.apiKeys ?? createApiFixture<ApiKeyApi>({}, "ApiKeyApi"),
      identity: peers.identity ?? createApiFixture<IdentityApi>({}, "IdentityApi"),
      entitlement: peers.entitlement ?? createApiFixture<EntitlementApi>({}, "EntitlementApi"),
      roles: peers.roles ?? createApiFixture<RoleApi>({}, "RoleApi"),
      notifications:
        peers.notifications ?? createApiFixture<NotificationService>({}, "NotificationService"),
    },
    config: {
      signUp: { mode: "open", allowedDomains: [], adminEmails: [] },
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
    repositories: MemoryOrganizationRepositories.create(),
  };
}
