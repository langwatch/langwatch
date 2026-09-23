import { CLI_LOGIN_KEY_NAME_PREFIX, HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";

import type { GuardMiddleware, GuardParams } from "./guard-middleware.ts";

/**
 * Organization-tenancy guard: enforces single-organization scoping with organizationId predicates.
 * See ADR-021: blocks queries spanning multiple organizations.
 */

type OrgScopedModelConfig = {
  /**
   * Actions admitted with no single-organization predicate. Use only for read-only platform
   * bookkeeping, not customer data.
   */
  platformScopeActions?: readonly string[];
  /**
   * Extra single-org-bounding predicates beyond organizationId (parent FKs,
   * globally-unique secrets). Grants access based on action (read vs write).
   */
  extraBound?: (args: { clause: unknown; action: string }) => boolean;
};

/**
 * Prisma's read actions — scoping a hatch to these keeps a future write
 * from riding through it, since a read-only hatch safely resolves one org.
 */
const READ_ACTIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

/**
 * Read one top-level key off a WHERE clause of unknown shape. The clause comes
 * off `Prisma.MiddlewareParams["args"]`, so it is genuinely untyped input and
 * every bound below has to narrow before it reads.
 */
const clauseField = (clause: unknown, key: string): unknown =>
  clause && typeof clause === "object" ? (clause as Record<string, unknown>)[key] : undefined;

/**
 * A reserved, system-managed key name. `ApiKeyService.create` refuses any
 * customer key into one, so an exact match here reaches platform rows only —
 * never `contains`/`startsWith`, which would widen the reach.
 */
const isSystemManagedKeyName = (value: unknown): boolean =>
  typeof value === "string" && HIDDEN_SYSTEM_KEY_NAMES.includes(value);

/**
 * Matches exactly `expiresAt: { not: null, lte: <Date> }` — an expiry that
 * has passed. A looser check (merely having the key, or an unbounded
 * matcher) would readmit still-live keys this clause exists to exclude.
 */
const isElapsedExpiryBound = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bound = value as Record<string, unknown>;
  return Object.keys(bound).length === 2 && bound.not === null && bound.lte instanceof Date;
};

/**
 * Maintenance sweep for system-managed keys: matches reserved name, revokedAt: null,
 * and elapsed-expiry bound. Literal matching prevents scope creep.
 */
const isSystemManagedKeySweep = (clause: unknown): boolean => {
  if (!clause || typeof clause !== "object") return false;
  const where = clause as Record<string, unknown>;
  return (
    isSystemManagedKeyName(where.name) &&
    where.revokedAt === null &&
    isElapsedExpiryBound(where.expiresAt)
  );
};

/**
 * Hourly reap sweep for CLI login keys: matches the reserved prefix via
 * `startsWith` — safe because `ApiKeyService.create` refuses a customer
 * key that would collide — revokedAt: null, and the elapsed-expiry bound.
 */
const isCliLoginKeyExpirySweep = (clause: unknown): boolean => {
  if (!clause || typeof clause !== "object") return false;
  const where = clause as Record<string, unknown>;
  const name = where.name;
  if (!name || typeof name !== "object" || Array.isArray(name)) return false;
  const nameBound = name as Record<string, unknown>;
  return (
    Object.keys(where).length === 3 &&
    Object.keys(nameBound).length === 1 &&
    nameBound.startsWith === CLI_LOGIN_KEY_NAME_PREFIX &&
    where.revokedAt === null &&
    isElapsedExpiryBound(where.expiresAt)
  );
};

/**
 * Branch-recheck sweep shape: branches with no PR, backoff elapsed, and recent requests.
 * Literal matching prevents accessing stale branches.
 */
const isBranchRecheckSweep = (clause: unknown): boolean => {
  if (!clause || typeof clause !== "object") return false;
  const where = clause as Record<string, unknown>;
  return (
    Object.keys(where).length === 3 &&
    isNotNullBound(where.notFoundAt) &&
    isDateComparison(where.recheckAfter, "lte") &&
    isDateComparison(where.lastRequestedAt, "gt")
  );
};

/** Matches exactly `{ not: null }`, nothing looser. */
const isNotNullBound = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bound = value as Record<string, unknown>;
  return Object.keys(bound).length === 1 && bound.not === null;
};

/** Matches exactly `{ <operator>: <Date> }`, nothing looser. */
const isDateComparison = (value: unknown, operator: "lte" | "gt"): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bound = value as Record<string, unknown>;
  return Object.keys(bound).length === 1 && bound[operator] instanceof Date;
};

const isNonEmptyStringList = (value: unknown): boolean => {
  const list = clauseField(value, "in");
  if (!Array.isArray(list)) return false;
  if (list.length === 0) return false;
  return list.every((item) => typeof item === "string");
};

// A single organizationId literal is the canonical single-org predicate. We
// deliberately do NOT accept `organizationId: { in: [...] }` here: a list of
// org ids would target several organizations, which the single-organization
// invariant forbids, and no call-site needs it.
const hasOrganizationId = (clause: any): boolean => typeof clause?.organizationId === "string";

const hasRowId = (clause: any): boolean =>
  typeof clause?.id === "string" ||
  (clause?.id && Array.isArray(clause.id.in) && clause.id.in.length > 0);

// Prisma names a compound unique key by joining its field names with "_"
// (e.g. `userId_organizationId`, `organizationId_name`). A WHERE that targets
// such a key embeds organizationId and therefore bounds to one org + one row.
const hasCompositeOrgKey = (clause: any): boolean => {
  if (!clause || typeof clause !== "object") return false;
  return Object.keys(clause).some((key) => {
    const value = clauseField(clause, key);
    return value && typeof value === "object" && key.split("_").includes("organizationId");
  });
};

// An inline (scopeType, scopeId) target. scopeId is a globally-unique entity
// id (a team or project id), so it resolves to exactly one organization.
const hasInlineScope = (clause: any): boolean =>
  typeof clause?.scopeType === "string" &&
  (typeof clause?.scopeId === "string" || isNonEmptyStringList(clause?.scopeId));

const boundsToSingleOrg = (clause: any): boolean =>
  hasOrganizationId(clause) || hasRowId(clause) || hasCompositeOrgKey(clause);

/**
 * The org-tenancy regime: models whose every query must carry a
 * single-organization predicate — the org-level analogue of
 * guardProjectId's default. Grows as models are audited. See ADR-021.
 */
const ORG_SCOPED_MODELS: Record<string, OrgScopedModelConfig> = {
  // Original three guarded models, preserved (organizationId / row id /
  // composite-org key cover their existing access patterns).
  OrganizationUser: {},
  Team: {},
  OrganizationInvite: {
    // inviteCode is a globally-unique acceptance token; the invite row it
    // names belongs to exactly one organization.
    extraBound: ({ clause }) => typeof clauseField(clause, "inviteCode") === "string",
  },
  // Org-scoped RBAC + config models, audited to already carry a bounded
  // predicate (organizationId, a row id, a compound org key, a parent FK, or
  // an inline scope) on every call site.
  CustomRole: {},
  Group: {},
  // A request to join one organization (D12). It carries `organizationId`, and
  // every read is either an admin listing that organization's queue or a
  // lookup of one request by its own id — so the ordinary guard fits, and a
  // bare `findMany()` over everybody's pending requests is exactly what it
  // should refuse.
  JoinRequest: {},
  // One row per SSO connection's sync state (D08), carrying the connection's
  // `organizationId`. Reachable by that or by the connection itself, which
  // belongs to exactly one organization.
  ScimSyncState: {
    extraBound: ({ clause }) => typeof clauseField(clause, "connectionId") === "string",
  },
  RoleBinding: {
    // Reachable by its parent api key / group (each owned by one org) or by
    // its inline (scopeType, scopeId) target (a team / project id unique
    // across the platform), all of which bound to a single organization.
    extraBound: ({ clause }) =>
      typeof clauseField(clause, "apiKeyId") === "string" ||
      typeof clauseField(clause, "groupId") === "string" ||
      hasInlineScope(clause),
  },
  ApiKey: {
    // lookupId is globally-unique public token half. System-managed key sweep exemption is bounded
    // by predicate and action (updateMany only) to prevent reads or deletes of all tenant keys.
    extraBound: ({ clause, action }) =>
      typeof clauseField(clause, "lookupId") === "string" ||
      (action === "updateMany" && isSystemManagedKeySweep(clause)) ||
      (action === "findMany" && isCliLoginKeyExpirySweep(clause)),
  },
  RoutingPolicy: {},
  // Governance identity (ADR-128 §11). Every read and write names its
  // organization: these are admin-curated rows about people a provider put on a
  // cost row, and there is no query shape that wants more than one tenant's.
  DiscoveredPerson: {},
  DiscoveredAgent: {},
  IdentityMatch: {},
  // Candidate matches the suggestion job computed (ADR-128 §12). The job
  // rewrites one organization's rows per pass and the review surface reads one
  // organization's queue, so organizationId covers every access — there is no
  // cross-tenant shape here, unlike the two snapshot loaders below.
  IdentityMatchSuggestion: {},
  // Dated department links (ADR-128 §13). Assignment writes, the
  // department-on-day read, and the directory-sync open-links read all name
  // their organization; the one update that closes an open link addresses it
  // by row id. No shape wants more than one tenant's history, so a bare
  // findMany over everyone's links is exactly what the guard should refuse.
  DepartmentMembershipHistory: {},
  // Governance tenants an org has written rows under. tenantId resolves to exactly one
  // organization; same snapshot read pattern as other audit tables below.
  GovernanceTenantHistory: {
    platformScopeActions: ["findMany"],
    extraBound: ({ clause }) => typeof clauseField(clause, "tenantId") === "string",
  },
  // Digests of erased identifiers (ADR-128 §9). Same snapshot read, same
  // reasoning, and this table is the one place in the codebase that holds no
  // customer data BY CONSTRUCTION: it stores hashes precisely so it is not a
  // copy of the identifiers it exists to keep out. Every other access names its
  // organization.
  ErasedIdentifierSuppression: {
    platformScopeActions: ["findMany"],
  },
  // The grants ledger's projection tables (ADR-092 §13). Written only by
  // the authz_grants fold (plus revocation enforcement); read by the engine
  // per organization. Row id / organizationId cover every access pattern.
  Grant: {
    // Share token — globally unique (ADR-057), resolving to exactly one org.
    // READ actions only: a write keyed on a bare token would still cross
    // tenants, as the ApiKey hatch above scopes the same way.
    extraBound: ({ clause, action }) =>
      READ_ACTIONS.has(action) && typeof clauseField(clause, "token") === "string",
  },
  // ShareService's view accounting for resource grants (delivery-plan
  // decision 22). Keyed by grantId - a ledger-derived id, globally unique
  // and resolving to exactly one organization - which is also the only
  // predicate the per-view increment can name, since the viewer arrives
  // with a share token and nothing else.
  GrantUsage: {
    // A single grant id resolves to exactly one organization; a LIST of them
    // is only as tenant-scoped as its weakest entry, so the list shape is
    // admitted only alongside the organization it claims to be about.
    extraBound: ({ clause }) =>
      typeof clauseField(clause, "grantId") === "string" ||
      (isNonEmptyStringList(clauseField(clause, "grantId")) &&
        typeof clauseField(clause, "organizationId") === "string"),
  },
  Role: {},
  // Platform-scope migration runner reads (admission, pass, gauge). Writes stay bounded by
  // organizationId or compound (organizationId, migrationName) key.
  SystemMigrationEnrollment: {
    platformScopeActions: ["findMany", "groupBy"],
  },
  AiToolEntry: {},
  GatewayBudget: {},
  GatewayConnectUpstream: {},
  // Per-bucket period boundaries for attributed-user templates. Bound by
  // organizationId, or by the parent budget (org-owned) through budgetId /
  // the compound unique key.
  GatewayBudgetBucketBoundary: {
    extraBound: ({ clause }) => {
      const budgetId = clauseField(clause, "budgetId");
      return (
        typeof budgetId === "string" ||
        (budgetId != null && Array.isArray((budgetId as { in?: unknown }).in)) ||
        clauseField(clause, "budgetId_bucketScopeId") !== undefined
      );
    },
  },
  // The organization's GitHub connection. Bound by organizationId (admin reads)
  // or the globally-unique installationId (webhook + mint paths). Spec:
  // specs/integrations/github-connection.feature.
  GithubInstallation: {
    extraBound: ({ clause }) => typeof clauseField(clause, "installationId") === "string",
  },
  // Pull requests discovered through that connection, and the per-branch
  // bookkeeping behind the lookup. Both are reached by organizationId, or by
  // the compound unique key that starts with it: a query that names a
  // repository without naming the organization would span every tenant that
  // has a repository by that name.
  GithubPullRequest: {},
  GithubBranchPullRequestCheck: {
    // Branch-recheck sweep: cross-tenant timer-driven read bounded by predicate and
    // action (findMany). Action-gating prevents replayed writes on bookkeeping.
    extraBound: ({ clause, action }) => action === "findMany" && isBranchRecheckSweep(clause),
  },
};

/**
 * Org-bearing models not guarded here; each deliberately exempt for a concrete reason.
 * The partition test verifies no newly-added org-scoped model slips past tenancy enforcement.
 */
export const ORG_TENANCY_EXEMPT: readonly string[] = [
  // Governed by guardProjectId's SCOPED_MODELS instead: these are accessed by
  // (scopeType, scopeId) / hashedSecret / projectId predicates the org guard
  // would reject. They carry an organizationId anchor (the single-org backstop
  // and a valid bound for direct admin queries), but their primary access path
  // is the scope predicate, so tenancy is enforced one layer up.
  "VirtualKey",
  "CustomLLMModelCost",
  "RetentionPolicy",
  "DataPrivacyPolicy",
  "ModelProvider",
  "ModelDefaultConfig",
  // Enforced by guardProjectId's SCOPED_MODELS instead (org id, row id, or
  // project FK on every query); sweep/prune use the raw-SQL opt-out. The
  // delivery log is shared with the project-scoped automations channel,
  // which carries no organizationId, so a mandatory guard here cannot apply.
  "WebhookEndpoint",
  "WebhookEndpointDelivery",
  // organizationId is NULLABLE here (NULL = platform-published default), so a
  // mandatory-organizationId guard cannot apply.
  "IngestionTemplate",
  // Dual-scoped (organization OR project) with a nullable organizationId; the
  // service layer picks the regime per call.
  "LlmPromptConfig",
  "Notification",
  // Append-only audit / event logs read back by many shapes; org enforcement
  // is deferred to a dedicated audit rather than turned on opportunistically.
  "AuditLog",
  "GatewayChangeEvent",
  // Evaluated by cross-tenant background jobs: the spend-spike anomaly
  // evaluator scans every org's rules by ruleType (no organizationId filter)
  // and counts open alerts by ruleId, so a mandatory-organizationId guard
  // cannot apply. Service-layer queries that ARE org-scoped still pass their
  // organizationId; the evaluator's sweep is the constraint.
  "AnomalyRule",
  "AnomalyAlert",
  // Same shape: two cross-tenant sweeps read this one. The realtime session
  // poller reconciles every org's unreported voice calls, and the expiry
  // pass releases cap slots the vendor never closed. Every service-layer
  // query still names its own tenant, and the webhook lookup scopes to the
  // organization that owns the credential the delivery was signed for.
  "GatewayRealtimeSession",
  // Org-scoped but not yet audited for every query shape. Listed explicitly so
  // the partition test stays green while the per-model call-site audit that
  // precedes enforcement (ADR-021) is completed.
  "BillingMeterCheckpoint",
  // SSO, SCIM and connected self-hosted rows (#7633, #8232): every one carries
  // the organization, but the per-model call-site audit has not run yet.
  "ActivationCode",
  "ConnectedBillingAccount",
  "IssuedLicense",
  "ScimDirectoryUser",
  "ScimRequestLog",
  "ScimUserResource",
  "SelfHostedInstance",
  "SsoActivationRecoveryReservation",
  "SsoAuthenticationActivity",
  "SsoBreakGlassBinding",
  "SsoConnectionRegistrationSlot",
  "SsoCredential",
  "SsoProvider",
  "SsoVerifiedDomain",
  "SsoVerifiedDomainHolder",
  "Department",
  "GatewayCacheRule",
  "IngestionSource",
  // Per-(org, tool) CLI path policy. Read/written only through
  // PlatformToolPolicyService, which always passes organizationId
  // explicitly; not behind the middleware guard.
  "PlatformToolPolicy",
  "PromptTag",
  "ScimToken",
  // D04 SSO connection projection (ADR-117 §5): deliberately not
  // org-constrained. Addressed by connection id; two reads are legitimately
  // cross-organization — "who already verified this domain" (first verifier
  // owns globally on SaaS) and the self-hosted sole-connection list. Holds
  // no customer content: only ids, domains, enums and credential references.
  "SsoConnection",
  "Subscription",
];

export const ORG_SCOPED_MODEL_NAMES: readonly string[] = Object.keys(ORG_SCOPED_MODELS);

/**
 * Every model with an organizationId column: guarded regime plus deferred
 * exemptions. This is the source of truth guardProjectId derives its
 * org-scoped exemptions from — never hand-list an org-scoped model there.
 */
export const ORG_BEARING_MODEL_NAMES: readonly string[] = [
  ...ORG_SCOPED_MODEL_NAMES,
  ...ORG_TENANCY_EXEMPT,
];

const collectOrganizationIds = (where: any, acc: Set<string>): void => {
  if (!where || typeof where !== "object") return;
  if (typeof where.organizationId === "string") acc.add(where.organizationId);
  for (const key of ["AND", "OR", "NOT"] as const) {
    const branch = clauseField(where, key);
    if (Array.isArray(branch)) {
      for (const clause of branch) collectOrganizationIds(clause, acc);
    } else if (branch && typeof branch === "object") {
      collectOrganizationIds(branch, acc);
    }
  }
};

const validateRecursive = (where: any, passes: (clause: any) => boolean): boolean => {
  if (!where || typeof where !== "object") return false;
  if (passes(where)) return true;
  if (Array.isArray(where.AND)) {
    for (const clause of where.AND) {
      if (validateRecursive(clause, passes)) return true;
    }
  }
  // OR semantics: every alternative branch must independently carry a
  // single-org predicate, otherwise the unbounded branch leaks rows.
  const orClauses = clauseField(where, "OR");
  if (Array.isArray(orClauses)) {
    if (orClauses.length === 0) return false;
    return orClauses.every((clause) => validateRecursive(clause, passes));
  }
  return false;
};

function assertCreateOrganizationId(params: GuardParams, model: string): void {
  const data = params.args?.data;
  const records = Array.isArray(data) ? data : [data];
  const everyRecordHasOrg = records.every(
    (record) => record && typeof record.organizationId === "string",
  );
  if (!everyRecordHasOrg) {
    throw new Error(
      `The ${params.action} action on the ${model} model requires an 'organizationId' in the data field`,
    );
  }
}

function assertWhereObject(params: GuardParams, model: string): Record<string, unknown> {
  const where = params.args?.where;
  if (where && typeof where === "object") return where;

  throw new Error(
    `The ${params.action} action on the ${model} model requires an 'organizationId' or row id in the where clause`,
  );
}

function assertSingleOrganization(params: GuardParams, model: string, where: unknown): void {
  const organizationIds = new Set<string>();
  collectOrganizationIds(where, organizationIds);
  if (organizationIds.size > 1) {
    throw new Error(
      `The ${params.action} action on the ${model} model must not span multiple organizations (found ${organizationIds.size})`,
    );
  }
}

function assertOrganizationPredicate({
  params,
  model,
  config,
  where,
}: {
  params: GuardParams;
  model: string;
  config: OrgScopedModelConfig;
  where: unknown;
}): void {
  const passes = (clause: any) =>
    boundsToSingleOrg(clause) ||
    (config.extraBound ? config.extraBound({ clause, action: params.action }) : false);

  if (!validateRecursive(where, passes)) {
    throw new Error(
      `The ${params.action} action on the ${model} model requires an 'organizationId', row id, or model-specific tenancy key in the where clause`,
    );
  }
}

function assertUpsertCreateOrganizationId(params: GuardParams, model: string): void {
  if (params.action !== "upsert") return;

  const createData = params.args?.create;
  if (!createData || typeof createData.organizationId !== "string") {
    throw new Error(
      `The upsert action on the ${model} model requires an 'organizationId' in the create payload`,
    );
  }
}

const _guardOrganizationId = ({ params }: { params: GuardParams }) => {
  const model = params.model;
  if (!model || !ORG_SCOPED_MODELS[model]) return;

  const action = params.action;
  const config = ORG_SCOPED_MODELS[model];

  if (action === "create" || action === "createMany") {
    assertCreateOrganizationId(params, model);
    return;
  }

  // The platform-scope exemption, granted per action and read before any
  // predicate is looked at — which is the whole point of it, since the reads it
  // covers carry no predicate to look at. Placed after the create branch so it
  // can never admit a write that declares no owner.
  if (config.platformScopeActions?.includes(action)) return;

  const where = assertWhereObject(params, model);

  // Single-organization invariant: a query may not target two orgs at once.
  assertSingleOrganization(params, model, where);
  assertOrganizationPredicate({ params, model, config, where });

  // upsert also writes a create payload when the row is absent, so hold it to
  // the same "every create declares its owning organization" invariant.
  assertUpsertCreateOrganizationId(params, model);
};

export const guardOrganizationId: GuardMiddleware = async (params, next) => {
  _guardOrganizationId({ params });
  return next(params);
};
