import { createApiFixture } from "@langwatch/api-fixture";
import type { AuthApi } from "@langwatch/auth-contract";
import type { IdentityApi, RoutingDecision } from "@langwatch/identity-contract";
import type { OpsApi } from "@langwatch/ops-contract";
import {
  type OrganizationApi,
  OrganizationNotFoundForTeamError,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { vi } from "vitest";

import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import type { UserRepositories } from "../../repositories/user.repositories.ts";
import { UserApp, type UserFacts } from "../user.app.ts";
import type { UserAvatarStorage, UserInfrastructure } from "../user.members.ts";

/** The issuer this deployment stores its credential account rows under. */
export const TEST_CREDENTIAL_ISSUER = "local:credential";

/**
 * The auth peer a suite runs against; `provider` is what ADR-027 resolved,
 * `issuesOwnPasswords` the D09 switch, and `governedDomain` a domain an
 * organization routes through its own connection.
 */
export function createUserTestAuth(
  provider = "email",
  {
    issuesOwnPasswords = false,
    governedDomain,
  }: { issuesOwnPasswords?: boolean; governedDomain?: string } = {},
) {
  return Object.assign(createApiFixture<AuthApi>(), {
    revokeOtherBrowserSessions: vi.fn(async () => undefined),
    revokeAllBrowserSessions: vi.fn(async () => undefined),
    resolveAuthProvider: vi.fn(async () => provider),
    issuesOwnPasswords: vi.fn(() => issuesOwnPasswords),
    route: vi.fn(async ({ identifier }: { identifier: string | null }): Promise<RoutingDecision> =>
      governedDomain !== undefined && identifier?.endsWith(`@${governedDomain}`)
        ? {
            outcome: "redirect_to_connection",
            connectionId: "conn-1",
            methodSet: [{ id: "okta", kind: "federated", connectionId: "conn-1" }],
            reasonCode: "domain_routed",
          }
        : {
            outcome: "method_picker",
            methodSet: [{ id: "password", kind: "password", connectionId: null }],
            reasonCode: "no_domain_match",
          },
    ),
  });
}

export function createUserTestOps(isAdmin = false) {
  return createApiFixture<OpsApi>({ isAdmin: () => isAdmin });
}

export function createUserTestProjects() {
  return createApiFixture<ProjectApi>({ findIdentity: async () => null });
}

export function createUserTestOrganizations(projectId = "project-1") {
  return Object.assign(createApiFixture<OrganizationApi>(), {
    ensurePersonalWorkspace: vi.fn(async () => ({
      project: { id: projectId },
      team: { id: "team-1" },
    })),
    tryFindPersonalWorkspace: vi.fn(async () => null),
    getOrganizationIdByTeamId: vi.fn(async ({ teamId }: { teamId: string }) => {
      throw new OrganizationNotFoundForTeamError(teamId);
    }),
    isMember: vi.fn(async () => true),
  });
}

/** The avatar bytes, kept in the test rather than in an object store. */
export class TestUserAvatarStorage implements UserAvatarStorage {
  readonly stored: { projectId: string; userId: string }[] = [];

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

/** The deployment a suite runs against: no passkeys, no public base URL. */
export const TEST_USER_CONFIG: UserFacts = { passkeysEnabled: false, baseUrl: null };

/**
 * What the process still hands this module, as a test supplies it: budgets
 * nobody has spent, and every capability the account doors reach recorded
 * rather than performed.
 */
export function createUserTestInfrastructure(
  overrides: Partial<UserInfrastructure> = {},
): UserInfrastructure {
  return {
    avatarStorage: new TestUserAvatarStorage(),
    passwords: new TestPasswordHasher(),
    rateLimit: vi.fn(async () => ({ allowed: true, resetAt: 0 })),
    analytics: { trackServerEvent: vi.fn() },
    federatedPasswords: {
      findDatabaseAccount: vi.fn(async () => null),
      changePassword: vi.fn(async () => ({ outcome: "failed" as const })),
    },
    cliCredentials: { revokeForUser: vi.fn(async () => undefined) },
    organizations: {
      findSupportContact: vi.fn(async () => null),
      getBudgetIncreaseRecipient: vi.fn(async () => "admin@example.com"),
      findName: vi.fn(async () => null),
      findFirstProjectSlug: vi.fn(async () => null),
    },
    governanceProjects: { findGovernanceProject: vi.fn(async () => null) },
    gateway: {
      findDefaultRoutingPolicy: vi.fn(async () => null),
      listPersonalVirtualKeys: vi.fn(async () => []),
      checkBudget: vi.fn(async () => ({ decision: "allow", scopes: [], blockedBy: [] })),
    },
    budgetRequests: { sendBudgetIncreaseRequest: vi.fn(async () => undefined) },
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
    members?: Partial<UserInfrastructure>;
    dependencies?: Partial<{
      auth: AuthApi;
      identity: IdentityApi;
      organizations: OrganizationApi;
      ops: OpsApi;
      projects: ProjectApi;
    }>;
    facts?: UserFacts;
  }> = {},
): UserApp {
  return UserApp.createForTesting({
    repositories: input.repositories ?? MemoryUserRepositories.create(),
    members: createUserTestInfrastructure(input.members ?? {}),
    facts: input.facts ?? TEST_USER_CONFIG,
    dependencies: {
      auth: input.dependencies?.auth ?? createUserTestAuth(),
      identity: input.dependencies?.identity ?? createApiFixture<IdentityApi>(),
      organizations: input.dependencies?.organizations ?? createUserTestOrganizations(),
      ops: input.dependencies?.ops ?? createUserTestOps(),
      projects: input.dependencies?.projects ?? createUserTestProjects(),
    },
  });
}
