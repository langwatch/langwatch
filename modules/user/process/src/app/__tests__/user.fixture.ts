import type { AuthApi } from "@langwatch/auth-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { EnterpriseGatewayApi } from "@langwatch/enterprise-gateway-contract";
import type { GovernanceRestApi } from "@langwatch/enterprise-governance-contract";
import type { GatewayApi } from "@langwatch/gateway-contract";
import type { RoutingDecision } from "@langwatch/identity-contract";
import {
  type OrganizationApi,
  OrganizationNotFoundForTeamError,
  type PersonalWorkspace,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { type StoredObjectApi, StoredObjectNotFoundError } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { nowInstant, type Instant } from "@langwatch/time";
import { vi } from "vitest";

import { MemoryUserBudgetRequestMailChannel } from "../../channels/memory/memory.user-budget-request-mail.channel.ts";
import type { UserBudgetRequestMailChannel } from "../../channels/user-budget-request-mail.channel.ts";
import type { RecordUserLifecycleCommandData } from "../../eventing/user-lifecycle.events.ts";
import { MemoryUserRepositories } from "../../repositories/memory/memory.user.repositories.ts";
import type { UserRepositories } from "../../repositories/user.repositories.ts";
import type { UserLifecycleSenders } from "../../services/user-lifecycle-notice.service.ts";
import { UserModule, type UserFacts } from "../user.app.ts";

/** The issuer this deployment stores its credential account rows under. */
export const TEST_CREDENTIAL_ISSUER = "local:credential";

/** The one proof the test auth refuses, as a spent or foreign proof is refused. */
export const REFUSED_ADDRESS_PROOF = "refused-address-proof";

/** The proof an installation that cannot send email mints: it proves nothing. */
export const UNCONFIRMED_ADDRESS_PROOF = "unconfirmed-address-proof";

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
    revokeCliTokens: vi.fn(async () => ({ revokedCount: 0 })),
    resolveAuthProvider: vi.fn(async () => provider),
    issuesOwnPasswords: vi.fn(() => issuesOwnPasswords),
    assertSignUpOrigin: vi.fn(async () => undefined),
    claimSignUpAddressProof: vi.fn(
      async ({ token }: { token: string; email: string }) =>
        token !== REFUSED_ADDRESS_PROOF && token !== UNCONFIRMED_ADDRESS_PROOF,
    ),
    claimUnconfirmedSignUpAddressProof: vi.fn(
      async ({ token }: { token: string; email: string }) => token === UNCONFIRMED_ADDRESS_PROOF,
    ),
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

/** Authz as the platform scope asks it: yes for the users named, no for everyone else. */
export function createUserTestAuthorization(operators: ReadonlySet<string> = new Set()) {
  return createApiFixture<AuthzApi>({
    can: async ({ principal, permission, scope }) =>
      scope.type === "platform" &&
      permission.startsWith("ops:") &&
      principal.type === "user" &&
      operators.has(principal.id),
    listPlatformOperators: async () =>
      [...operators].map((userId) => ({
        grantId: `grant-${userId}`,
        userId,
        grantedAt: nowInstant(),
      })),
  });
}

/** user_lifecycle's senders, recording each fact rather than appending it. */
export function createUserTestLifecycle() {
  const recorded: {
    type: "deactivated" | "reactivated" | "registered";
    data: RecordUserLifecycleCommandData;
  }[] = [];
  const senders: UserLifecycleSenders = {
    recordUserDeactivated: {
      send: async (data) => {
        recorded.push({ type: "deactivated", data });
      },
    },
    recordUserReactivated: {
      send: async (data) => {
        recorded.push({ type: "reactivated", data });
      },
    },
    recordUserRegistered: {
      send: async (data) => {
        recorded.push({ type: "registered", data });
      },
    },
  };

  return { senders, recorded };
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
    getPersonalWorkspace: vi.fn(async (): Promise<PersonalWorkspace> => {
      throw new TeamNotFoundError();
    }),
    getOrganizationIdByTeamId: vi.fn(async ({ teamId }: { teamId: string }) => {
      throw new OrganizationNotFoundForTeamError(teamId);
    }),
    isMember: vi.fn(async () => true),
    checkSignUp: vi.fn<OrganizationApi["checkSignUp"]>(async () => ({
      allowed: true,
      via: "open",
    })),
  });
}

/** Stored objects as a test keeps them: each upload answers the next id, reads find nothing. */
export function createUserTestStoredObjects() {
  let uploads = 0;

  return createApiFixture<StoredObjectApi>({
    storeFromBytes: vi.fn<StoredObjectApi["storeFromBytes"]>(async (input) => {
      uploads += 1;

      return {
        reference: {
          projectId: input.projectId,
          id: `object-${uploads}`,
          sha256: "a".repeat(64),
          byteLength: 0,
          filename: input.filename,
          mediaType: input.mediaType,
          audience: input.audience,
        },
        isDuplicate: false,
      };
    }),
    readById: vi.fn(async () => {
      throw new StoredObjectNotFoundError();
    }),
    getReadUrlForPurpose: vi.fn(async () => ({
      url: "/api/stored-objects/avatar/content?sig=test",
    })),
  });
}

/** The gateway peers behind /me: no default policy, no personal key, every budget allowed. */
export function createUserTestGateways() {
  return {
    enterpriseGateway: createApiFixture<EnterpriseGatewayApi>({
      findDefaultRoutingPolicies: vi.fn(async () => []),
      personalVirtualKeyList: vi.fn(async () => []),
    }),
    gateway: createApiFixture<GatewayApi>({
      checkBudget: vi.fn(async () => ({
        decision: "allow" as const,
        warnings: [],
        blockReason: null,
        scopes: [],
        blockedBy: [],
      })),
    }),
  };
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

/** The whole application over memory repositories, recorded mail and a test's own peers. */
export function createUserTestApp(
  input: Readonly<{
    repositories?: UserRepositories;
    dependencies?: Partial<{
      auth: AuthApi;
      authz: AuthzApi;
      enterpriseGateway: EnterpriseGatewayApi;
      gateway: GatewayApi;
      governance: GovernanceRestApi;
      organizations: OrganizationApi;
      projects: ProjectApi;
      storedObjects: StoredObjectApi;
    }>;
    facts?: UserFacts;
    lifecycle?: UserLifecycleSenders;
    budgetRequests?: UserBudgetRequestMailChannel;
    now?: () => Instant;
  }> = {},
): UserModule {
  const gateways = createUserTestGateways();
  const app = UserModule.createForTesting({
    repositories: input.repositories ?? MemoryUserRepositories.create(),
    facts: input.facts ?? TEST_USER_CONFIG,
    budgetRequests: input.budgetRequests ?? MemoryUserBudgetRequestMailChannel.create(),
    passwords: new TestPasswordHasher(),
    ...(input.now ? { now: input.now } : {}),
    dependencies: {
      auth: input.dependencies?.auth ?? createUserTestAuth(),
      authz: input.dependencies?.authz ?? createUserTestAuthorization(),
      enterpriseGateway: input.dependencies?.enterpriseGateway ?? gateways.enterpriseGateway,
      gateway: input.dependencies?.gateway ?? gateways.gateway,
      governance: input.dependencies?.governance ?? createApiFixture<GovernanceRestApi>(),
      organizations: input.dependencies?.organizations ?? createUserTestOrganizations(),
      projects: input.dependencies?.projects ?? createUserTestProjects(),
      storedObjects: input.dependencies?.storedObjects ?? createUserTestStoredObjects(),
    },
  });
  app.connectLifecycle(input.lifecycle ?? createUserTestLifecycle().senders);

  return app;
}
