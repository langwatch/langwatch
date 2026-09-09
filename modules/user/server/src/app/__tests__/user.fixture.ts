import type { AuthApi } from "@langwatch/auth-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { ResourceScope } from "@langwatch/runtime-composition";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { vi } from "vitest";

import { UserApp, type UserAvatarStorage, type UserInfrastructure } from "../user.app.ts";
import type { UserRepositories } from "../../repositories/user.repositories.ts";
import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";

/** The issuer a test deployment stores its credential account rows under. */
export const TEST_CREDENTIAL_ISSUER = "credential";

export function createUserTestAuth() {
  return Object.assign(createApiFixture<AuthApi>(), {
    revokeOtherBrowserSessions: vi.fn(async () => undefined),
    revokeAllBrowserSessions: vi.fn(async () => undefined),
  });
}

export function createUserTestOps(isAdmin = false) {
  return createApiFixture<OpsApi>({ isAdmin: () => isAdmin });
}

export function createUserTestOrganizations(projectId = "project-1") {
  return Object.assign(createApiFixture<OrganizationApi>(), {
    ensurePersonalWorkspace: vi.fn(async () => ({
      project: { id: projectId },
      team: { id: "team-1" },
    })),
    tryFindPersonalWorkspace: vi.fn(async () => null),
    tryGetOrganizationIdByTeamId: vi.fn(async () => null),
  });
}

/** The avatar bytes, kept in the test rather than in an object store. */
export class TestUserAvatarStorage implements UserAvatarStorage {
  readonly stored: Array<{ projectId: string; userId: string }> = [];

  async store(input: {
    projectId: string;
    userId: string;
    mediaType: string;
    bytes: Uint8Array;
  }): Promise<{ id: string }> {
    this.stored.push({ projectId: input.projectId, userId: input.userId });

    return { id: `object-${this.stored.length}` };
  }
}

/** A reversible stand-in for bcrypt, so a hash is recognisable in assertions. */
export class TestPasswordHasher {
  async hash({ password }: { password: string }): Promise<string> {
    return `hashed:${password}`;
  }

  async matches({ password, hash }: { password: string; hash: string }): Promise<boolean> {
    return hash === `hashed:${password}`;
  }
}

/**
 * Everything the process holds, as a test supplies it: an email deployment
 * that offers no passkeys, budgets nobody has spent, and every capability the
 * account doors reach recorded rather than performed.
 */
export function createUserTestInfrastructure(
  overrides: Partial<UserInfrastructure> = {},
): UserInfrastructure {
  return {
    credentialIssuer: TEST_CREDENTIAL_ISSUER,
    avatarStorage: new TestUserAvatarStorage(),
    passwords: new TestPasswordHasher(),
    deployment: {
      authProvider: vi.fn(async () => "email"),
      offersPasskeys: vi.fn(() => false),
      findBaseUrl: vi.fn(() => null),
    },
    rateLimit: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
    analytics: { trackServerEvent: vi.fn() },
    federatedPasswords: {
      findDatabaseAccount: vi.fn(async () => null),
      changePassword: vi.fn(async () => ({ outcome: "failed" as const })),
    },
    cliCredentials: { revokeForUser: vi.fn(async () => undefined) },
    organizations: {
      isMember: vi.fn(async () => true),
      findSupportContact: vi.fn(async () => null),
      getBudgetIncreaseRecipient: vi.fn(async () => "admin@example.com"),
      findName: vi.fn(async () => null),
      findFirstProjectSlug: vi.fn(async () => null),
    },
    projects: {
      findById: vi.fn(async () => null),
      findGovernanceProject: vi.fn(async () => null),
    },
    gateway: {
      findDefaultRoutingPolicy: vi.fn(async () => null),
      listPersonalVirtualKeys: vi.fn(async () => []),
      checkBudget: vi.fn(async () => ({ decision: "allow", scopes: [], blockedBy: [] })),
    },
    budgetRequests: { sendBudgetIncreaseRequest: vi.fn(async () => undefined) },
    verification: { completeEmailVerification: vi.fn(async () => undefined) },
    personalUsage: {
      personalUsage: vi.fn(async () => ({
        summary: {
          spentUsd: 0,
          billedUsd: 0,
          requests: 0,
          promptTokens: 0,
          completionTokens: 0,
          mostUsedModel: null,
        },
        dailyBuckets: [],
        breakdownByModel: [],
      })),
    },
    avatarObjects: { findById: vi.fn(async () => null) },
    ...overrides,
  };
}

/** The whole application over memory repositories and a test's own process. */
export function createUserTestApp(
  input: Readonly<{
    repositories?: UserRepositories;
    infrastructure?: Partial<UserInfrastructure>;
    dependencies?: Partial<{
      auth: AuthApi;
      organizations: OrganizationApi;
      ops: OpsApi;
    }>;
  }> = {},
): UserApp {
  return UserApp.create({
    repositories: input.repositories ?? MemoryUserRepositories.create(),
    infrastructure: createUserTestInfrastructure(input.infrastructure ?? {}),
    dependencies: {
      auth: input.dependencies?.auth ?? createUserTestAuth(),
      organizations: input.dependencies?.organizations ?? createUserTestOrganizations(),
      ops: input.dependencies?.ops ?? createUserTestOps(),
    },
    config: void 0,
    resources: new ResourceScope(),
  });
}
