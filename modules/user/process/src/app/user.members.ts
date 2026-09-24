/**
 * The closed record of what the process supplies this module (ADR-144): what
 * it builds from its own stores, and the peer capabilities no owner's `*Api`
 * declares yet. Each of the latter names the module it belongs to.
 */

import type { Instant } from "@langwatch/time";
import type { MeUsage, UserAvatarMediaType, UserAvatarObjectRead } from "@langwatch/user-contract";

/**
 * Where an uploaded avatar's bytes go. Owner: stored-object.
 * `StoredObjectApi.storeFromBytes` takes a delivery `audience` from the authz
 * vocabulary, which registers no avatar or user read permission.
 */
export interface UserAvatarStorage {
  store(input: {
    projectId: string;
    userId: string;
    mediaType: UserAvatarMediaType;
    bytes: Uint8Array;
  }): Promise<{ id: string }>;
}

/**
 * The avatar bytes, by project and content-addressed id. Owner: stored-object.
 * `StoredObjectApi.readById` answers this, but hands an `AsyncIterable`
 * where this module's contract carries a `ReadableStream`.
 */
export interface UserAvatarObjects {
  findById(input: { projectId: string; id: string }): Promise<UserAvatarObjectRead>;
}

/**
 * The deployment's stored-password format, as the one operation that compares
 * a hash and the one that writes a new one. The cost factor is part of the
 * STORED format, so the process states it once and both halves run through it.
 */
export interface UserPasswordHasher {
  hash(input: { password: string }): Promise<string>;
  matches(input: { password: string; hash: string }): Promise<boolean>;
}

/** The shared fixed-window counter every account throttle meters through. */
export type UserRateLimiter = (
  input: Readonly<{ key: string; windowSeconds: number; max: number }>,
) => Promise<Readonly<{ allowed: boolean; resetAt: number }>>;

/** The product-analytics trail; never fatal to the request. */
export interface UserAnalytics {
  trackServerEvent(
    input: Readonly<{
      userId: string;
      event: string;
      properties?: Readonly<Record<string, unknown>>;
    }>,
  ): void;
}

/** What the identity provider can answer to a password change. */
export type UserFederatedPasswordOutcome =
  | { outcome: "changed" }
  | { outcome: "wrong_password" }
  /** The provider's own policy refused the new password; its wording. */
  | { outcome: "weak_password"; message: string }
  | { outcome: "insufficient_scope" }
  | { outcome: "password_grant_not_enabled" }
  | { outcome: "not_configured" }
  | { outcome: "failed" };

/**
 * The identity provider this deployment federates through. Owner: auth, which
 * resolves the provider but declares no operation over its tenant's
 * identities. Social identities are their upstream IdP's, never this one's.
 */
export interface UserFederatedPasswords {
  /** The provider's DATABASE identity, the only one whose password moves. */
  findDatabaseAccount(input: {
    userId: string;
  }): Promise<Readonly<{ providerAccountId: string }> | null>;
  changePassword(
    input: Readonly<{
      email: string;
      providerUserId: string;
      currentPassword: string;
      newPassword: string;
    }>,
  ): Promise<UserFederatedPasswordOutcome>;
}

/**
 * The credentials a deactivation must end beside the browser sessions.
 * Owner: auth, which owns the cli-token subject but declares no revocation.
 */
export interface UserCliCredentials {
  revokeForUser(input: { userId: string }): Promise<void>;
}

/**
 * The organization rows the /me dashboard reads. Owner: organization, whose
 * `OrganizationApi` declares none of these four — the first admin's address,
 * the display name, and the caller's first project in the organization.
 */
export interface UserOrganizationDirectory {
  /** Admin-configured support contact, else the first admin's address. */
  findSupportContact(input: { organizationId: string }): Promise<string | null>;
  /** Who a budget-increase request goes to. Refuses when nobody administers. */
  getBudgetIncreaseRecipient(input: { organizationId: string }): Promise<string>;
  findName(input: { organizationId: string }): Promise<string | null>;
  /** The caller's first non-archived project in the organization, by age. */
  findFirstProjectSlug(input: { organizationId: string; userId: string }): Promise<string | null>;
}

/** The gateway budget check, at the caller's own personal workspace. */
export type UserBudgetCheckInput = Readonly<{
  organizationId: string;
  teamId: string;
  projectId: string;
  virtualKeyId: string;
  principalUserId: string;
  projectedCostUsd: number;
}>;

/** One budget the gateway weighed, as the banner and the chip read it. */
export type UserBudgetScopeDecision = Readonly<{
  scope: string;
  scopeId: string;
  spentUsd: string;
  limitUsd: string;
  window: string;
}>;

/** The gateway's own pre-check answer, at `projectedCostUsd: 0`. */
export type UserBudgetDecision = Readonly<{
  decision: string;
  scopes: readonly UserBudgetScopeDecision[];
  blockedBy: readonly UserBudgetScopeDecision[];
}>;

/**
 * The gateway governance stores behind /me. Owner: enterprise governance, as
 * `personalVirtualKeyList`;
 * `checkBudget` is a gateway service `GatewayApi` does not expose.
 */
export interface UserGatewayGovernance {
  /** The routing policy a personal workspace inherits by default, if any. */
  findDefaultRoutingPolicy(input: {
    organizationId: string;
    personalTeamId: string;
  }): Promise<Readonly<{ id: string; name: string }> | null>;
  /** The caller's own gateway keys in this organization; only the id is read. */
  listPersonalVirtualKeys(input: {
    userId: string;
    organizationId: string;
  }): Promise<readonly Readonly<{ id: string }>[]>;
  checkBudget(input: UserBudgetCheckInput): Promise<UserBudgetDecision>;
}

/**
 * The mail a budget-increase request goes out on. The words are
 * `@langwatch/mail`'s and render through react-email, which a process package
 * may not value-import, so the rendered message arrives from the process.
 */
export interface UserBudgetRequestMailer {
  sendBudgetIncreaseRequest(
    input: Readonly<{
      to: string;
      requesterEmail: string;
      requesterName?: string;
      organizationName: string;
      scope: string;
      scopeId: string;
      limitUsd: string;
      spentUsd: string;
      period?: string;
      message?: string;
    }>,
  ): Promise<void>;
}

/**
 * The organization's hidden governance project, where ingestion-source ledger
 * rows land. Owner: enterprise governance, which mints it and declares no
 * lookup. Absent where the organization never minted an ingestion source.
 */
export interface UserGovernanceProjects {
  findGovernanceProject(input: {
    organizationId: string;
  }): Promise<Readonly<{ id: string }> | null>;
}

/**
 * One person's own AI usage, rolled up over a window. Owner: enterprise
 * governance, which declares `personalUsageSummary`, `personalUsageDailyBuckets`
 * and `personalUsageBreakdownByModel` — three calls where this reads one.
 */
export interface UserPersonalUsageReader {
  personalUsage(input: {
    personalProjectId: string;
    userId?: string;
    ingestionTenantId?: string;
    window?: { startMs: number; endMs: number };
  }): Promise<MeUsage>;
}

/** What the process supplies this module, once, at boot. */
export interface UserInfrastructure {
  avatarStorage: UserAvatarStorage;
  passwords: UserPasswordHasher;
  rateLimit: UserRateLimiter;
  analytics: UserAnalytics;
  federatedPasswords: UserFederatedPasswords;
  cliCredentials: UserCliCredentials;
  organizations: UserOrganizationDirectory;
  governanceProjects: UserGovernanceProjects;
  gateway: UserGatewayGovernance;
  budgetRequests: UserBudgetRequestMailer;
  personalUsage: UserPersonalUsageReader;
  avatarObjects: UserAvatarObjects;
  now?: () => Instant;
}
