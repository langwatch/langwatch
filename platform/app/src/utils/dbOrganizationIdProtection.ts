import { HIDDEN_SYSTEM_KEY_NAMES } from "~/server/api-key/reserved-names";
import type { GuardMiddleware, GuardParams } from "./dbGuardMiddleware";

/**
 * Organization-tenancy guard: the org-level mirror of guardProjectId.
 *
 * Every model in ORG_SCOPED_MODELS carries an explicit `organizationId` column
 * and is tenancy-sensitive. Each query MUST constrain to a single organization
 * via an `organizationId` predicate, a row id (or a composite unique key that
 * embeds organizationId), or a model-specific bounded key (a globally-unique
 * secret column, or a parent foreign key that itself belongs to exactly one
 * org). A bare `findMany()` throws instead of returning every tenant's rows.
 *
 * Single-organization invariant (ADR-021): scoping is always within ONE org.
 * No query may target two organizations at once, so if more than one distinct
 * `organizationId` literal appears anywhere in the WHERE tree (typically across
 * OR branches) the query is rejected. The middleware has no auth context and
 * cannot verify the org belongs to the caller (that is the tRPC layer's job),
 * but it can and does reject a WHERE that spans two organizations, which closes
 * the documented `{ OR: [{ projectId }, { organizationId: "other" }] }` gap.
 */

type OrgScopedModelConfig = {
  /**
   * Actions admitted with NO single-organization predicate at all — the narrow
   * case of a table whose rows are platform bookkeeping rather than tenant
   * data, and whose reads are across-organizations by design.
   *
   * This is deliberately separate from `extraBound`, which can only ever
   * narrow a WHERE clause that exists: the guard rejects a missing or
   * non-object `where` before any bound is consulted, so a bare `findMany()`
   * is unreachable from there no matter what the bound says. A model that
   * genuinely has no predicate to offer has to say so here, by action, where
   * it reads as the exemption it is.
   *
   * Grant this to READ actions only, and only to a model carrying no customer
   * data. It is the widest thing in this file.
   */
  platformScopeActions?: readonly string[];
  /**
   * Extra single-org-bounding predicates beyond organizationId / row id /
   * composite-org key. Used for parent foreign keys and globally-unique
   * secret columns that each resolve to exactly one organization.
   *
   * Receives the ACTION as well as the clause, because a bound that exists to
   * admit one specific platform query should be granted to that query's action
   * only. A predicate that is sound to write with is not automatically sound to
   * read every matching row with, and the default set of actions an ApiKey
   * bound would otherwise unlock is `findMany` / `updateMany` / `deleteMany`
   * alike. Bounds that genuinely resolve a single row for any action (a parent
   * FK, a globally-unique secret) simply ignore the argument.
   */
  extraBound?: (args: { clause: unknown; action: string }) => boolean;
};

/**
 * Prisma's read actions. A token/id hatch that resolves one organization is
 * safe for a READ, but a write keyed on the same token would still be a
 * cross-tenant write; scoping a hatch to these keeps a future
 * `updateMany`/`deleteMany` on that shape from riding through it.
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
  clause && typeof clause === "object"
    ? (clause as Record<string, unknown>)[key]
    : undefined;

/**
 * A reserved, system-managed API-key name. Only the platform can create or
 * rename a key into one (`ApiKeyService.create` refuses otherwise), so a query
 * bounded by such a name reaches platform-owned rows only — never a customer's.
 * Matched exactly: no `contains`/`startsWith`, which would widen the reach.
 */
const isSystemManagedKeyName = (value: unknown): boolean =>
  typeof value === "string" && HIDDEN_SYSTEM_KEY_NAMES.includes(value);

/**
 * The elapsed-expiry half of the sweep's predicate:
 * `expiresAt: { not: null, lte: <Date> }` — "has an expiry, and it has already
 * passed". Matched as exactly that pair, for the same reason `revokedAt` is
 * matched as a literal below: any looser check (merely having an `expiresAt`
 * key, or an unbounded matcher) readmits the live, un-expired keys this clause
 * exists to exclude.
 */
const isElapsedExpiryBound = (value: unknown): boolean => {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const bound = value as Record<string, unknown>;
  return (
    Object.keys(bound).length === 2 &&
    bound.not === null &&
    bound.lte instanceof Date
  );
};

/**
 * The shape of the platform's own maintenance sweep over system-managed keys:
 * a reserved NAME, `revokedAt: null`, **and** an elapsed-expiry bound. Those
 * are the three clauses `reapExpiredLangySessionApiKeys` writes and the only
 * ones this admits; the ApiKey entry below additionally grants it for the one
 * action that sweep performs, `updateMany`.
 *
 * The name alone would already be sound for tenancy — no customer row can carry
 * one — but sound is not narrow, and this predicate is the only bound the
 * ApiKey model requires. Each remaining clause is load-bearing:
 *
 *   - `revokedAt: null` is "revoke what has not been revoked". Without it the
 *     hatch reaches every such key that ever existed, which no sweep needs and
 *     an exfiltration would want.
 *   - `expiresAt: { not: null, lte: <now> }` is "…whose lifetime has elapsed".
 *     Without it the hatch reaches every LIVE session key in every
 *     organization — the exact set the sweep never touches, and the one worth
 *     stealing.
 *
 * The literal matching is deliberate: the sweep writes literals, and accepting
 * `{ not: ... }`-style matchers or extra operators would give back the width
 * just removed. A sweep that legitimately changes shape must change this
 * predicate with it, and `dbOrganizationIdProtection.unit.test.ts` drives the
 * real reaper through the real middleware so that drift fails there rather than
 * silently widening the hatch. The reserved-name list is a tenancy boundary
 * either way — see the note on `HIDDEN_SYSTEM_KEY_NAMES` before adding to it.
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
 * The shape of the branch-recheck sweep: a branch that resolved to no pull
 * request (`notFoundAt: { not: null }`), whose backoff has elapsed
 * (`recheckAfter: { lte: <now> }`), and that a reader has asked about recently
 * (`lastRequestedAt: { gt: <cutoff> }`). Exactly those three clauses and
 * nothing else.
 *
 * Each one is load-bearing, and the literal matching is deliberate for the same
 * reason it is on the ApiKey sweep:
 *
 *   - `notFoundAt: { not: null }` is "branches with no pull request". Without
 *     it the hatch reaches every mapped branch in every organization, which is
 *     the set that carries the pull-request names worth reading.
 *   - `recheckAfter: { lte: <now> }` is "…whose backoff has elapsed". Without
 *     it the hatch reaches branches the sweep is deliberately not asking about.
 *   - `lastRequestedAt: { gt: <cutoff> }` is "…that anyone still cares about".
 *     Without it the sweep walks branches abandoned months ago, which is both
 *     the wrong behavior and a much wider read.
 *
 * A sweep that legitimately changes shape must change this predicate with it.
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

const isNonEmptyStringList = (value: any): boolean =>
  value &&
  typeof value === "object" &&
  Array.isArray(value.in) &&
  value.in.length > 0 &&
  value.in.every((v: any) => typeof v === "string");

// A single organizationId literal is the canonical single-org predicate. We
// deliberately do NOT accept `organizationId: { in: [...] }` here: a list of
// org ids would target several organizations, which the single-organization
// invariant forbids, and no call-site needs it.
const hasOrganizationId = (clause: any): boolean =>
  typeof clause?.organizationId === "string";

const hasRowId = (clause: any): boolean =>
  typeof clause?.id === "string" ||
  (clause?.id && Array.isArray(clause.id.in) && clause.id.in.length > 0);

// Prisma names a compound unique key by joining its field names with "_"
// (e.g. `userId_organizationId`, `organizationId_name`). A WHERE that targets
// such a key embeds organizationId and therefore bounds to one org + one row.
const hasCompositeOrgKey = (clause: any): boolean => {
  if (!clause || typeof clause !== "object") return false;
  return Object.keys(clause).some((key) => {
    const value = (clause as any)[key];
    return (
      value &&
      typeof value === "object" &&
      key.split("_").includes("organizationId")
    );
  });
};

// An inline (scopeType, scopeId) target. scopeId is a globally-unique entity
// id (a team or project id), so it resolves to exactly one organization.
const hasInlineScope = (clause: any): boolean =>
  typeof clause?.scopeType === "string" &&
  (typeof clause?.scopeId === "string" ||
    isNonEmptyStringList(clause?.scopeId));

const boundsToSingleOrg = (clause: any): boolean =>
  hasOrganizationId(clause) || hasRowId(clause) || hasCompositeOrgKey(clause);

/**
 * The org-tenancy regime: models whose every query is required to carry a
 * single-organization predicate. This set is the organization-level analogue
 * of guardProjectId's project-scoped default, and grows as org-scoped models
 * are audited (each call site verified to already carry a bounded predicate)
 * and moved out of the no-enforcement bucket. See ADR-021.
 */
const ORG_SCOPED_MODELS: Record<string, OrgScopedModelConfig> = {
  // Original three guarded models, preserved (organizationId / row id /
  // composite-org key cover their existing access patterns).
  OrganizationUser: {},
  Team: {},
  OrganizationInvite: {
    // inviteCode is a globally-unique acceptance token; the invite row it
    // names belongs to exactly one organization.
    extraBound: ({ clause }) =>
      typeof clauseField(clause, "inviteCode") === "string",
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
    extraBound: ({ clause }) =>
      typeof clauseField(clause, "connectionId") === "string",
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
    // lookupId is the globally-unique public half of an API token; the auth
    // path resolves a bearer token to its single owning org through it.
    //
    // The platform's own sweep over system-managed keys is the other bounded
    // predicate. Those names are reserved: `ApiKeyService.create` refuses them
    // unless the caller is system-managed, and renaming a key into one is
    // blocked, so no customer can own a row a name-bounded query would reach.
    // That makes such a query platform-owned by construction — which is what
    // the expired-Langy-session sweep is. Without it the sweep, whose whole job
    // is to be cross-tenant, was rejected by this guard on every run and had
    // never revoked a key.
    //
    // It is granted on the sweep's TERMS, not the sweep's name: the full
    // predicate (see isSystemManagedKeySweep) and `updateMany`, the single
    // action `reapExpiredLangySessionApiKeys` performs. Action-gating is what
    // stops the same shape being replayed as a cross-tenant `findMany` that
    // reads every organization's keys, or a `deleteMany` that removes them —
    // neither of which is a sweep, and both of which this bound would otherwise
    // have authorised. A new platform maintenance query does not inherit the
    // hatch; it is a deliberate widening here, with its own shape and action.
    extraBound: ({ clause, action }) =>
      typeof clauseField(clause, "lookupId") === "string" ||
      (action === "updateMany" && isSystemManagedKeySweep(clause)),
  },
  RoutingPolicy: {},
  // The grants ledger's projection tables (ADR-092 §13). Written only by
  // the authz_grants fold (plus revocation enforcement); read by the engine
  // per organization. Row id / organizationId cover every access pattern.
  Grant: {
    // The resource tier's possession path presents only the share token —
    // globally unique, resolving to exactly one organization (ADR-057's
    // ShareLink lookup, inherited when share links become RESOURCE grants).
    // READ actions only: the possession path is a read, and a write keyed on
    // a bare token would still cross tenants (the ApiKey hatch above scopes
    // its own widening the same way).
    extraBound: ({ clause, action }) =>
      READ_ACTIONS.has(action) &&
      typeof clauseField(clause, "token") === "string",
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
  // Which organizations the in-place migration runner processes on cloud
  // (specs/migration/authz-grants-rollout.feature, the enrollment scenarios).
  // The runner's per-pass read and the ops listing are platform-scope by
  // design - the same posture as the ops rollup over
  // SystemMigrationTenantState - so READS are admitted unbounded.
  //
  // They used to be admitted only alongside a `stage` string, back when
  // enrollment was one row per (organization, stage) and every read named the
  // stage it was about. Enrollment is now per MIGRATION, and all three reads
  // span migrations as well as organizations: the ops listing shows every
  // enrollment, the pass reads the whole table once to probe per (tenant,
  // migration) in memory, and the rollout gauge groups by migration name.
  // There is no narrowing predicate left to require, and going on requiring
  // the departed column meant the guard refused every one of them.
  //
  // Reads only, and the action gate is what keeps that honest. Writes stay
  // bounded to one organization: enroll carries organizationId in its data,
  // withdraw names the compound (organizationId, migrationName) key, the
  // organization purge deletes by organizationId, and a migration-wide bulk
  // write - which would withdraw every organization at once - has no admitted
  // shape. The rows themselves are operator bookkeeping: an organization id, a
  // migration name, and who enrolled it.
  SystemMigrationEnrollment: {
    platformScopeActions: ["findMany", "groupBy"],
  },
  AiToolEntry: {},
  GatewayBudget: {},
  // Per-bucket period boundaries for attributed-user templates. Bound by
  // organizationId, or by the parent budget (org-owned) through budgetId /
  // the compound unique key.
  GatewayBudgetBucketBoundary: {
    extraBound: ({ clause }) => {
      const budgetId = clauseField(clause, "budgetId");
      return (
        typeof budgetId === "string" ||
        (budgetId != null &&
          Array.isArray((budgetId as { in?: unknown }).in)) ||
        clauseField(clause, "budgetId_bucketScopeId") !== undefined
      );
    },
  },
  // The organization's GitHub connection. Bound by organizationId (admin reads)
  // or the globally-unique installationId (webhook + mint paths). Spec:
  // specs/integrations/github-connection.feature.
  GithubInstallation: {
    extraBound: ({ clause }) =>
      typeof clauseField(clause, "installationId") === "string",
  },
  // Pull requests discovered through that connection, and the per-branch
  // bookkeeping behind the lookup. Both are reached by organizationId, or by
  // the compound unique key that starts with it: a query that names a
  // repository without naming the organization would span every tenant that
  // has a repository by that name.
  GithubPullRequest: {},
  GithubBranchPullRequestCheck: {
    // The branch-recheck sweep is the one read in this feature that cannot
    // name an organization, for the same structural reason the expired-key
    // sweep above cannot: it runs on a timer with no request context, and its
    // whole job is to find the due branches wherever they are.
    //
    // Granted on the sweep's TERMS, not its name: the full predicate (see
    // isBranchRecheckSweep) and `findMany`, the single action
    // `findRecheckDue` performs. Action-gating is what stops the same shape
    // being replayed as an `updateMany` that rewrites every organization's
    // bookkeeping, or a `deleteMany` that erases it. The rows it reaches are
    // bookkeeping only: a repository name, a branch name and timestamps.
    extraBound: ({ clause, action }) =>
      action === "findMany" && isBranchRecheckSweep(clause),
  },
};

/**
 * Models that carry an organizationId column but are deliberately NOT guarded
 * here, each for a concrete reason. The partition test
 * (dbOrganizationIdProtection.unit.test.ts) asserts every org-bearing model is
 * either guarded above or listed here, so a newly-added org-scoped model
 * cannot silently slip past tenancy enforcement.
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
  "SlackIntegration",
  // Webhook platform: enforced by guardProjectId's SCOPED_MODELS (org id,
  // row id, endpoint FK, or project FK required on every query; creates must
  // carry one channel's complete tenancy pair); the delivery sweep and
  // retention prune use the raw-SQL opt-out. The delivery log is shared with
  // the automations channel, whose rows are project-scoped and carry no
  // organizationId at all, so a mandatory-organizationId guard cannot apply.
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
  "Department",
  "GatewayCacheRule",
  "IngestionSource",
  // Per-(org, tool) CLI path policy. Read/written only through
  // PlatformToolPolicyService, which always passes organizationId
  // explicitly; not behind the middleware guard.
  "PlatformToolPolicy",
  "PromptTag",
  "ScimToken",
  // The D04 SSO connection projection (ADR-117 §5). Org-bearing, and
  // deliberately not org-CONSTRAINED: it is addressed by connection id (the
  // fold's load and store), and two of its reads are cross-organization on
  // purpose — "who already verified this domain", which is what makes first
  // verifier own globally on SaaS, and the self-hosted sole-connection list.
  // A guard demanding organizationId would refuse exactly the queries the
  // ownership rule is made of. It holds no customer content: ids, domains,
  // enums and credential references.
  "SsoConnection",
  "Subscription",
];

export const ORG_SCOPED_MODEL_NAMES: readonly string[] =
  Object.keys(ORG_SCOPED_MODELS);

/**
 * Every model that carries an organizationId column: the union of the guarded
 * regime and the deliberately-deferred exemptions. The partition test below
 * proves this equals exactly the org-bearing set from the Prisma datamodel, so
 * it is the single source of truth guardProjectId derives its org-scoped
 * exemptions from - an org-scoped model is, by definition, not project-scoped,
 * so it must never be hand-listed in the projectId guard's exempt buckets.
 */
export const ORG_BEARING_MODEL_NAMES: readonly string[] = [
  ...ORG_SCOPED_MODEL_NAMES,
  ...ORG_TENANCY_EXEMPT,
];

const collectOrganizationIds = (where: any, acc: Set<string>): void => {
  if (!where || typeof where !== "object") return;
  if (typeof where.organizationId === "string") acc.add(where.organizationId);
  for (const key of ["AND", "OR", "NOT"] as const) {
    const branch = (where as any)[key];
    if (Array.isArray(branch)) {
      for (const clause of branch) collectOrganizationIds(clause, acc);
    } else if (branch && typeof branch === "object") {
      collectOrganizationIds(branch, acc);
    }
  }
};

const validateRecursive = (
  where: any,
  passes: (clause: any) => boolean,
): boolean => {
  if (!where || typeof where !== "object") return false;
  if (passes(where)) return true;
  if (Array.isArray(where.AND)) {
    for (const clause of where.AND) {
      if (validateRecursive(clause, passes)) return true;
    }
  }
  // OR semantics: every alternative branch must independently carry a
  // single-org predicate, otherwise the unbounded branch leaks rows.
  if (Array.isArray(where.OR) && where.OR.length > 0) {
    if (where.OR.every((clause: any) => validateRecursive(clause, passes))) {
      return true;
    }
  }
  return false;
};

const _guardOrganizationId = ({ params }: { params: GuardParams }) => {
  const model = params.model;
  if (!model || !ORG_SCOPED_MODELS[model]) return;

  const action = params.action;
  const config = ORG_SCOPED_MODELS[model];

  if (action === "create" || action === "createMany") {
    const data = params.args?.data;
    const records = Array.isArray(data) ? data : [data];
    const everyRecordHasOrg = records.every(
      (record) => record && typeof record.organizationId === "string",
    );
    if (!everyRecordHasOrg) {
      throw new Error(
        `The ${action} action on the ${model} model requires an 'organizationId' in the data field`,
      );
    }
    return;
  }

  // The platform-scope exemption, granted per action and read before any
  // predicate is looked at — which is the whole point of it, since the reads it
  // covers carry no predicate to look at. Placed after the create branch so it
  // can never admit a write that declares no owner.
  if (config.platformScopeActions?.includes(action)) return;

  const where = params.args?.where;
  if (!where || typeof where !== "object") {
    throw new Error(
      `The ${action} action on the ${model} model requires an 'organizationId' or row id in the where clause`,
    );
  }

  // Single-organization invariant: a query may not target two orgs at once.
  const organizationIds = new Set<string>();
  collectOrganizationIds(where, organizationIds);
  if (organizationIds.size > 1) {
    throw new Error(
      `The ${action} action on the ${model} model must not span multiple organizations (found ${organizationIds.size})`,
    );
  }

  const passes = (clause: any) =>
    boundsToSingleOrg(clause) ||
    (config.extraBound ? config.extraBound({ clause, action }) : false);

  if (!validateRecursive(where, passes)) {
    throw new Error(
      `The ${action} action on the ${model} model requires an 'organizationId', row id, or model-specific tenancy key in the where clause`,
    );
  }

  // upsert also writes a create payload when the row is absent, so hold it to
  // the same "every create declares its owning organization" invariant.
  if (action === "upsert") {
    const createData = params.args?.create;
    if (!createData || typeof createData.organizationId !== "string") {
      throw new Error(
        `The upsert action on the ${model} model requires an 'organizationId' in the create payload`,
      );
    }
  }
};

export const guardOrganizationId: GuardMiddleware = async (params, next) => {
  _guardOrganizationId({ params });
  return next(params);
};
