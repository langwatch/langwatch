/** The Prisma models the Postgres derived-view catalog deliberately leaves off. */

/** The skip map: model name → the reason it carries no customer analytics. */
export type PostgresSkipMap = Record<string, string>;

/**
 * The five literal reason-category prefixes. A skip reason must start with one,
 * so a reason like "low value" is refused rather than silently accepted.
 */
export const POSTGRES_SKIP_REASON_PREFIXES = [
  "no tenant column:",
  "internal-only tenant:",
  "already exposed:",
  "access-control plumbing:",
  "permission-gated:",
] as const;

/** Every skipped model, with the reason it is off the catalog. */
export const LWQL_POSTGRES_SKIPPED_MODELS: PostgresSkipMap = {
  // Identity and login — the person and their credentials, keyed to a user,
  // never to a project.
  Account: "no tenant column: identity — an OAuth/login account for a user",
  AccountCredential: "no tenant column: identity — stored login credentials for a user",
  Session: "no tenant column: identity — a user's login session",
  User: "no tenant column: identity — the person, never a project's data",
  VerificationToken: "no tenant column: identity — email/login verification tokens",
  Identifier: "no tenant column: identity — external login identifiers for a user",
  IdentifierReservation: "no tenant column: identity — reserved login identifiers",
  IdentityProjectionCursor: "no tenant column: identity — per-user identity-projection bookkeeping",
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
  ScimDirectoryUser: "no tenant column: identity — which SSO connection manages a user",

  // Access-control plumbing — membership, roles, grants and keys the row policy
  // already reads; exposing them would leak the isolation mechanism.
  Team: "access-control plumbing: identity scope, never derived (spec)",
  Organization: "access-control plumbing: identity scope, never derived (spec)",
  OrganizationUser: "access-control plumbing: organization membership and its role",
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
  SsoConnectionRegistrationSlot: "access-control plumbing: SSO connection registration lock",
  SsoConnectionReproofCursor: "access-control plumbing: SSO domain re-proof sweep position",
  SsoCredential: "access-control plumbing: SSO credential ciphertext, never customer analytics",
  SsoVerifiedDomain: "access-control plumbing: an SSO provider's verified domain",
  SsoVerifiedDomainHolder:
    "access-control plumbing: which SSO connection may use a verified domain",
  SsoProvider: "access-control plumbing: better-auth's SSO provider row (OIDC/SAML config)",
  SsoBreakGlassBinding:
    "access-control plumbing: the named person who may sign in without the identity provider",
  SsoActivationRecoveryReservation:
    "access-control plumbing: reservation of a recovery path during SSO activation",
  ScimRequestLog: "access-control plumbing: SCIM request evidence log (ADR-126)",
  ProjectSecret: "access-control plumbing: project secrets, never customer analytics",
  AnnotationQueueMembers: "access-control plumbing: annotation-queue membership",
  PlatformToolPolicy: "access-control plumbing: per-tool access policy the gateway enforces",
  GatewayConnectUpstream:
    "access-control plumbing: the Connect upstream and credential an install's gateway dials",

  // Internal-only tenant — bookkeeping keyed by an internal migration tenant,
  // never a customer project.
  SystemMigrationTenantState:
    "internal-only tenant: system-migration state keyed by an internal tenantId, not a customer project",
  SystemMigrationEnrollment:
    "internal-only tenant: system-migration enrollment bookkeeping, not customer data",

  // Permission-gated — organization/admin-tier data the app reads only behind a
  // distinct permission a project's `analytics:view` key does not hold. Deriving
  // them would let any project API key read organization billing, audit and
  // webhook-management data the application itself gates far more tightly.
  BillingMeterCheckpoint:
    "permission-gated: organization Stripe meter totals, admin/billing-tier only, no user-facing path reads it, never analytics:view",
  AuditLog:
    "permission-gated: organization audit trail, read behind auditLog:view (organization.ts), never analytics:view",
  WebhookEndpoint:
    "permission-gated: organization webhook config, read behind webhookEndpoints:view/manage, never analytics:view",
  Subscription:
    "permission-gated: organization billing plan and limits, admin/billing-tier only, never analytics:view",
  Invoice:
    "permission-gated: organization billing invoices, admin/billing-tier only, never analytics:view",
  InvoiceItem:
    "permission-gated: organization invoice line items, admin/billing-tier only, never analytics:view",

  // Permission-gated — the licensing and connected-services record of what a
  // customer bought and what their self-hosted install reports back. The
  // backoffice and the organization's billing pages are the only readers, all
  // behind organization management rights.
  IssuedLicense:
    "permission-gated: the license LangWatch issued to a customer, including its signed key hash, backoffice and organization-management only, never analytics:view",
  ActivationCode:
    "permission-gated: single-use activation codes for a fresh self-hosted install, a credential, backoffice and organization-management only, never analytics:view",
  ConnectedBillingAccount:
    "permission-gated: the connected-services billing account of an organization, admin/billing-tier only, never analytics:view",
  SelfHostedInstance:
    "permission-gated: the self-hosted installs reporting under a license, read on the organization's own pages behind organization management, never analytics:view",

  // No tenant column — connected-services billing rows and install reports,
  // each owned by its billing account, license or instance rather than by a
  // tenant of its own.
  ConnectedCreditGrant:
    "no tenant column: a credit grant on a connected billing account, reached through that account",
  ConnectedInvoice:
    "no tenant column: an invoice on a connected billing account, reached through that account",
  ConnectedSeatChange:
    "no tenant column: a mid-term seat change on an issued license, reached through that license",
  ConnectedStatement:
    "no tenant column: a billing statement on a connected billing account, reached through that account",
  InstanceIdentity:
    "no tenant column: the identity a self-hosted install presents, keyed to the install rather than to a tenant",
  SelfHostedInstanceReport:
    "no tenant column: a usage report an install sent, reached through the install that sent it",

  // No tenant column — global config and inbound queues owned by no project.
  FeatureFlag: "no tenant column: global feature flags, engine/config state",
  FeatureFlagExperimentSetting:
    "no tenant column: per-subject feature-flag overrides, engine/config state keyed to a flag and a subject",
  StoredObject:
    "no tenant column: the object store's own record, keyed by an internal tenantId and reached through the trace or dataset that references the object",
  ProjectActiveDay:
    "permission-gated: billing's per-project active-day claims, read only by the organization's usage metering, never analytics:view",
  BugReport:
    "no tenant column: global bug-report inbox; linkedProjectId is an optional reference, not an owning tenant",
  IdempotencyReceipt: "no tenant column: idempotency receipts, request-dedup framework state",
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

/** Refuses a skip map whose reasons are not true, category-prefixed decisions. */
export function assertPostgresSkipReasons(
  skip: PostgresSkipMap = LWQL_POSTGRES_SKIPPED_MODELS,
): void {
  for (const [model, reason] of Object.entries(skip)) {
    if (reason.trim().length === 0) {
      throw new Error(`lwql postgres catalog: skip entry "${model}" has no reason`);
    }
    if (reason.includes("TODO")) {
      throw new Error(
        `lwql postgres catalog: skip entry "${model}" still carries a TODO reason: ${reason}`,
      );
    }
    const prefixed = POSTGRES_SKIP_REASON_PREFIXES.some((prefix) => reason.startsWith(prefix));
    if (!prefixed) {
      throw new Error(
        `lwql postgres catalog: skip entry "${model}" reason must start with one of ` +
          `${POSTGRES_SKIP_REASON_PREFIXES.join(", ")} — got: ${reason}`,
      );
    }
  }
}
