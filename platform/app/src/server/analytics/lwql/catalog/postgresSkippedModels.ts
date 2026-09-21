/**
 * The Prisma models the Postgres derived-view catalog deliberately leaves off.
 *
 * The catalog is opt-*out*: {@link ./derivePostgresCatalog#derivePostgresCatalog}
 * turns every tenant-scoped model into a view unless it is named here with a
 * reason. A new tenant-scoped table therefore cannot silently stay off the
 * catalog — {@link ./__tests__/tenantModelCoverage.unit.test.ts} fails until it
 * is either catalogued or given a reason to be skipped.
 *
 * A skip is warranted only when the model (a) carries no owning tenant column
 * at all, (b) is written under an internal/system tenant no customer project
 * can hold rows under, (c) already reaches a caller through another view, or
 * (d) is access-control plumbing that adds nothing beyond what the row policy
 * already does. Those four are the only accepted reason categories, and a
 * reason must start with one of {@link POSTGRES_SKIP_REASON_PREFIXES} so the
 * validator can check it. "Low value" is not a reason — a low-value table with
 * a real tenant column is derived, not skipped.
 *
 * `User`, `Team` and `Organization` are never derived: they are the identity
 * scope itself, not a project's data.
 *
 * @see ./derivePostgresCatalog.ts — what opt-out turns into a view
 * @see ./skippedTables.ts — the ClickHouse half this mirrors
 */

/** The skip map: model name → the reason it carries no customer analytics. */
export type PostgresSkipMap = Record<string, string>;

/**
 * The four literal reason-category prefixes. A skip reason must start with one,
 * so a reason like "low value" is refused rather than silently accepted.
 */
export const POSTGRES_SKIP_REASON_PREFIXES = [
  "no tenant column:",
  "internal-only tenant:",
  "already exposed:",
  "access-control plumbing:",
] as const;

/**
 * Every skipped model, with the reason it is off the catalog.
 *
 * Grouped by category for review; the categories are only the reason prefixes,
 * not a structure the code reads.
 */
export const LWQL_POSTGRES_SKIPPED_MODELS: PostgresSkipMap = {
  // Identity and login — the person and their credentials, keyed to a user,
  // never to a project.
  Account: "no tenant column: identity — an OAuth/login account for a user",
  AccountCredential:
    "no tenant column: identity — stored login credentials for a user",
  Session: "no tenant column: identity — a user's login session",
  User: "no tenant column: identity — the person, never a project's data",
  VerificationToken:
    "no tenant column: identity — email/login verification tokens",
  Identifier:
    "no tenant column: identity — external login identifiers for a user",
  IdentifierReservation:
    "no tenant column: identity — reserved login identifiers",
  IdentityProjectionCursor:
    "no tenant column: identity — per-user identity-projection bookkeeping",
  TwoFactor: "no tenant column: identity — a user's two-factor secret",
  Passkey: "no tenant column: identity — a user's WebAuthn passkey",
  MfaEnrollment: "no tenant column: identity — a user's MFA enrollment state",
  ScimExternalId: "no tenant column: identity — a SCIM external id for a user",
  SignInAttemptLock:
    "no tenant column: identity — consecutive failed sign-ins and the lock they earn, keyed on the typed address",
  SsoAuthenticationActivity:
    "no tenant column: identity — a member's successful SSO callback, keyed to a user",
  ScimUserResource:
    "no tenant column: identity — a directory's profile for a user, never a project's data",
  ScimDirectoryUser:
    "no tenant column: identity — which SSO connection manages a user",

  // Access-control plumbing — membership, roles, grants and keys the row policy
  // already reads; exposing them would leak the isolation mechanism.
  Team: "access-control plumbing: identity scope, never derived (spec)",
  Organization: "access-control plumbing: identity scope, never derived (spec)",
  OrganizationUser:
    "access-control plumbing: organization membership and its role",
  TeamUser: "access-control plumbing: team membership and its role",
  Group: "access-control plumbing: an access group",
  GroupMembership: "access-control plumbing: group membership",
  Role: "access-control plumbing: a role definition",
  CustomRole: "access-control plumbing: a custom role definition",
  RoleBinding: "access-control plumbing: binds a principal to a role",
  Grant: "access-control plumbing: a permission grant",
  GrantUsage: "access-control plumbing: usage bookkeeping for a grant",
  ApiKey: "access-control plumbing: an API-key hash the row policy reads",
  OrganizationInvite: "access-control plumbing: a pending membership invite",
  JoinRequest: "access-control plumbing: a pending join request",
  ScimToken: "access-control plumbing: a SCIM provisioning token",
  ScimSyncState: "access-control plumbing: SCIM sync bookkeeping",
  SsoConnection: "access-control plumbing: an SSO connection config",
  SsoConnectionRegistrationSlot:
    "access-control plumbing: SSO connection registration lock",
  SsoConnectionReproofCursor:
    "access-control plumbing: SSO domain re-proof sweep position",
  SsoCredential:
    "access-control plumbing: SSO credential ciphertext, never customer analytics",
  SsoVerifiedDomain:
    "access-control plumbing: an SSO provider's verified domain",
  SsoVerifiedDomainHolder:
    "access-control plumbing: which SSO connection may use a verified domain",
  SsoProvider:
    "access-control plumbing: better-auth's SSO provider row (OIDC/SAML config)",
  SsoBreakGlassBinding:
    "access-control plumbing: the named person who may sign in without the identity provider",
  SsoActivationRecoveryReservation:
    "access-control plumbing: reservation of a recovery path during SSO activation",
  ScimRequestLog:
    "access-control plumbing: SCIM request evidence log (ADR-126)",
  ProjectSecret:
    "access-control plumbing: project secrets, never customer analytics",
  AnnotationQueueMembers:
    "access-control plumbing: annotation-queue membership",
  PlatformToolPolicy:
    "access-control plumbing: per-tool access policy the gateway enforces",

  // Internal-only tenant — bookkeeping keyed by an internal migration tenant,
  // never a customer project.
  SystemMigrationTenantState:
    "internal-only tenant: system-migration state keyed by an internal tenantId, not a customer project",
  SystemMigrationEnrollment:
    "internal-only tenant: system-migration enrollment bookkeeping, not customer data",

  // No tenant column — global config and inbound queues owned by no project.
  FeatureFlag: "no tenant column: global feature flags, engine/config state",
  BugReport:
    "no tenant column: global bug-report inbox; linkedProjectId is an optional reference, not an owning tenant",
  IdempotencyReceipt:
    "no tenant column: idempotency receipts, request-dedup framework state",
};

/**
 * The reason a model is off the derived catalog, or `undefined` if it should be
 * catalogued.
 */
export function postgresSkipReason(
  model: string,
  skip: PostgresSkipMap = LWQL_POSTGRES_SKIPPED_MODELS,
): string | undefined {
  return skip[model];
}

/**
 * Refuses a skip map whose reasons are not true, category-prefixed decisions.
 *
 * Throws on an empty reason, a reason that starts with none of
 * {@link POSTGRES_SKIP_REASON_PREFIXES}, or a reason still carrying a `TODO`
 * placeholder — the three ways a skip stops being a recorded decision.
 */
export function assertPostgresSkipReasons(
  skip: PostgresSkipMap = LWQL_POSTGRES_SKIPPED_MODELS,
): void {
  for (const [model, reason] of Object.entries(skip)) {
    if (reason.trim().length === 0) {
      throw new Error(
        `lwql postgres catalog: skip entry "${model}" has no reason`,
      );
    }
    if (reason.includes("TODO")) {
      throw new Error(
        `lwql postgres catalog: skip entry "${model}" still carries a TODO reason: ${reason}`,
      );
    }
    const prefixed = POSTGRES_SKIP_REASON_PREFIXES.some((prefix) =>
      reason.startsWith(prefix),
    );
    if (!prefixed) {
      throw new Error(
        `lwql postgres catalog: skip entry "${model}" reason must start with one of ` +
          `${POSTGRES_SKIP_REASON_PREFIXES.join(", ")} — got: ${reason}`,
      );
    }
  }
}
