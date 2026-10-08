import type { AuthzApi } from "@langwatch/authz-contract";
import type { BillingApi } from "@langwatch/enterprise-billing-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { IdentityApi } from "@langwatch/identity-contract";
import type { NotificationService } from "@langwatch/notification-contract";
import { ResourceScope } from "@langwatch/process";
import type { RoleApi } from "@langwatch/role-contract";
import { ScopedSecrets } from "@langwatch/secrets";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, type Instant } from "@langwatch/time";

import { MemoryOrganizationDatabase } from "../../../repositories/memory/memory.organization.database.ts";
import { memoryOrganizationRepositories } from "../../../repositories/memory/memory.organization.repositories.ts";
import type { OrganizationModule } from "../../organization.app.ts";

export type OrganizationModuleSetup = Parameters<typeof OrganizationModule.create>[0];

type Peers = OrganizationModuleSetup["dependencies"];

/** No secret resolves: the sign-up announcement composes with no channel. */
const noSecrets = new ScopedSecrets(async (_handle, build) => build(undefined));

/**
 * What `OrganizationModule.create` receives at boot, over the memory tier of the module's own
 * registry. Every peer a suite does not name is a fixture that throws by name when touched.
 */
export function organizationModuleSetup(
  peers: Partial<Peers> & { memory?: MemoryOrganizationDatabase } = {},
): OrganizationModuleSetup {
  const { memory = MemoryOrganizationDatabase.create() } = peers;
  return {
    dependencies: {
      permissions: peers.permissions ?? createApiFixture<AuthzApi>({}, "AuthzApi"),
      identity: peers.identity ?? createApiFixture<IdentityApi>({}, "IdentityApi"),
      entitlement: peers.entitlement ?? createApiFixture<EntitlementApi>({}, "EntitlementApi"),
      roles: peers.roles ?? createApiFixture<RoleApi>({}, "RoleApi"),
      notifications:
        peers.notifications ?? createApiFixture<NotificationService>({}, "NotificationService"),
      billing: peers.billing ?? createApiFixture<BillingApi>({}, "BillingApi"),
    },
    config: {
      signUp: { mode: "open", allowedDomains: [], adminEmails: [] },
      publicBaseUrl: "https://app.langwatch.test",
    },
    resources: new ResourceScope(),
    secrets: noSecrets,
    repositories: memoryOrganizationRepositories({ memory }),
  };
}

/** One live project row in the memory store, as the `Project` share reads it. */
export function seedMemoryProject({
  memory,
  id,
  name,
  slug = id,
  teamId,
  organizationId,
  kind,
  at = nowInstant(),
}: {
  memory: MemoryOrganizationDatabase;
  id: string;
  name: string;
  slug?: string;
  teamId: string;
  organizationId: string;
  /** The project's kind; absent seeds an ordinary application. */
  kind?: string;
  at?: Instant;
}): void {
  memory.projects.set(id, {
    id,
    name,
    slug,
    apiKey: `sk-lw-${id}`,
    ...(kind === void 0 ? {} : { kind }),
    teamId,
    isPersonal: false,
    ownerUserId: null,
    organizationId,
    archivedAt: null,
    createdAt: at,
    updatedAt: at,
    personalFeatures: null,
  });
}
