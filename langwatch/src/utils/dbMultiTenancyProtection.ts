import type { Prisma } from "@prisma/client";

import { ORG_BEARING_MODEL_NAMES } from "./dbOrganizationIdProtection";

/**
 * Genuinely global / cross-cutting models with no tenancy column at all: the
 * NextAuth identity tables, the top-level tenancy entities themselves (queried
 * by their own id / slug), and cluster-wide config. None can carry a projectId
 * and none is org-scoped, so each is listed here by hand. The partition test
 * forbids any org-bearing model from appearing here - those derive from the org
 * registry instead (see the EXEMPT_MODELS computation below).
 */
const GLOBAL_MODELS = [
  // NextAuth identity tables.
  "Account",
  "Session",
  "User",
  "VerificationToken",
  // Top-level tenancy entities, addressed by their own id / slug.
  "Organization",
  "Project",
  // Cluster-wide kill switches; one row per flag key, no tenant column. Keeps
  // system-scoped flags off PostHog (see /ops/feature-flags).
  "FeatureFlag",
] as const;

/**
 * Relational join / membership tables bounded by a parent foreign key or a
 * composite primary key rather than a projectId or organizationId column. They
 * are reached through their parent (or written via nested writes), never with a
 * bare top-level query, so the projectId requirement does not apply. Listed by
 * hand because there is no scope column to derive from.
 */
const RELATIONAL_PARENT_SCOPED = [
  // Membership join tables: @@id([userId, <parent>]).
  "TeamUser",
  "GroupMembership",
  // Billing ledger / invoice lines, owned by their parent VirtualKey /
  // Subscription / Invoice.
  "GatewayBudgetLedger",
  "Invoice",
  "InvoiceItem",
  // Annotation-queue join tables, written through the parent queue.
  "AnnotationQueueMembers",
  "AnnotationQueueScores",
] as const;

/**
 * Project-scoped models (they DO carry projectId) that are additionally read by
 * org-level license-counting queries walking project.team.organizationId with
 * no projectId in the WHERE. Exempt so those org rollups don't throw; their
 * normal project-scoped writes still carry projectId.
 */
const LICENSE_COUNTED_PROJECT_MODELS = [
  "Workflow",
  "Evaluator",
  "Scenario",
  "BatchEvaluation",
  "Agent",
] as const;

/**
 * Models that don't have a projectId column to constrain on, but ARE
 * tenancy-sensitive - every query MUST carry an equivalent tenancy
 * predicate (a row id, a scope predicate, or a parent foreign key
 * that itself transitively carries scope). The default guard above
 * would fail any of these queries because the where clause has no
 * `projectId`, so without this map they end up in EXEMPT_MODELS -
 * which silently lets a programmer write
 * `prisma.modelDefaultConfig.findMany({})` and walk every tenant's
 * defaults. That is the failure mode rchaves flagged on 2026-05-18;
 * SCOPED_MODELS is the structural fix.
 *
 * The rule for every entry here:
 *   - read/update/delete queries must filter by EITHER a row id, a
 *     scope predicate (scopeType + scopeId), or the parent foreign
 *     key (for joins). Bare `findMany()` without a tenancy clause
 *     throws.
 *   - create / createMany must include the same on every record.
 *
 * For ModelProvider, the legacy `projectId` column is still a valid
 * tenancy clause too (one-release compat - old call sites keep
 * working until the sweep PR drops the column).
 */
type ScopedModelConfig = {
  /** Where-clause validator. Returns `null` if OK, error message otherwise. */
  validateWhere: (where: any) => string | null;
  /** Data validator for create / createMany. */
  validateCreateData: (data: any) => string | null;
};

/**
 * A scopeId value is acceptable when it's either a string (single
 * id) or a Prisma list filter `{ in: [...] }` with a non-empty array.
 * Both shapes constrain the query to a finite, caller-known scope
 * set; `{}` or a bare `{ in: [] }` would not, so we keep them out.
 */
const isScopeIdValue = (value: any): boolean => {
  if (typeof value === "string") return true;
  if (
    value &&
    typeof value === "object" &&
    Array.isArray(value.in) &&
    value.in.length > 0 &&
    value.in.every((v: any) => typeof v === "string")
  ) {
    return true;
  }
  return false;
};

const hasScopePredicate = (where: any): boolean => {
  if (!where || typeof where !== "object") return false;
  // Top-level (scopeType, scopeId) - typical for join tables filtering by one scope.
  if (typeof where.scopeType === "string" && isScopeIdValue(where.scopeId)) {
    return true;
  }
  // Nested through a `scopes` relation (`{ scopes: { some: ... } }`),
  // either a single predicate or an OR-list. Every OR-branch must be
  // a valid scope predicate so a query can't sneak in `{ OR: [{}] }`
  // and walk every row. scopeId accepts both `string` and `{ in: [...] }`
  // shapes - the cascade walker passes lists for TEAM / PROJECT tiers
  // (every team in the org / every project in the org the caller can
  // see), and that list IS the tenancy constraint.
  const some = where.scopes?.some;
  if (some && typeof some === "object") {
    if (typeof some.scopeType === "string" && isScopeIdValue(some.scopeId)) {
      return true;
    }
    if (
      Array.isArray(some.OR) &&
      some.OR.length > 0 &&
      some.OR.every(
        (o: any) =>
          o &&
          typeof o.scopeType === "string" &&
          isScopeIdValue(o.scopeId),
      )
    ) {
      return true;
    }
  }
  return false;
};

const hasIdOrInPredicate = (where: any): boolean => {
  if (!where || typeof where !== "object") return false;
  if (typeof where.id === "string") return true;
  if (where.id && Array.isArray(where.id.in) && where.id.in.length > 0) {
    return true;
  }
  return false;
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
  // tenancy predicate, otherwise the unbounded branch leaks rows. The
  // canonical case is `findByHashedSecret`, which ORs together a current
  // hashedSecret + an in-grace previousHashedSecret; both branches name
  // a uniquely-keyed secret, so the guard recognises the query as bounded.
  if (Array.isArray(where.OR) && where.OR.length > 0) {
    const allBranchesBounded = where.OR.every((clause: any) =>
      validateRecursive(clause, passes),
    );
    if (allBranchesBounded) return true;
  }
  return false;
};

// Join tables scoped by their parent AiToolEntry: every query names the parent
// `entryId` (or a row id) and every created row carries it. A bare findMany /
// deleteMany without it would walk every org's tool-visibility bindings, so
// they take the stricter SCOPED_MODELS check rather than a blanket exemption.
const parentEntryScoped = (): ScopedModelConfig => ({
  validateWhere: (where) => {
    const reason = "requires a row id or entryId in the where clause";
    if (!where) return reason;
    const ok = validateRecursive(
      where,
      (c) =>
        hasIdOrInPredicate(c) ||
        typeof c.entryId === "string" ||
        (c.entryId && Array.isArray(c.entryId.in) && c.entryId.in.length > 0),
    );
    return ok ? null : reason;
  },
  validateCreateData: (data) => {
    const records = Array.isArray(data) ? data : [data];
    for (const d of records) {
      if (!d) return "create requires a data payload";
      if (typeof d.entryId !== "string") {
        return "create requires an entryId in the data payload";
      }
    }
    return null;
  },
});

const SCOPED_MODELS: Record<string, ScopedModelConfig> = {
  AiToolEntryTeam: parentEntryScoped(),
  AiToolEntryDepartment: parentEntryScoped(),
  ModelProvider: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, organizationId, or scope predicate in the where clause";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a row id, organizationId, or scope predicate in the where clause";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (!d.scopes) {
          return "create requires a 'scopes' relation in the data payload";
        }
      }
      return null;
    },
  },
  ModelProviderScope: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, modelProviderId, or scope predicate";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.modelProviderId === "string" ||
          (c.modelProviderId && Array.isArray(c.modelProviderId.in)) ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a row id, modelProviderId, or scope predicate";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (
          typeof d.modelProviderId !== "string" ||
          typeof d.scopeType !== "string" ||
          typeof d.scopeId !== "string"
        ) {
          return "create requires modelProviderId + scopeType + scopeId in the data payload";
        }
      }
      return null;
    },
  },
  RoutingPolicyScope: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, routingPolicyId, or scope predicate";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.routingPolicyId === "string" ||
          (c.routingPolicyId && Array.isArray(c.routingPolicyId.in)) ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a row id, routingPolicyId, or scope predicate";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (
          typeof d.routingPolicyId !== "string" ||
          typeof d.scopeType !== "string" ||
          typeof d.scopeId !== "string"
        ) {
          return "create requires routingPolicyId + scopeType + scopeId in the data payload";
        }
      }
      return null;
    },
  },
  VirtualKey: {
    validateWhere: (where) => {
      if (!where) {
        return "requires an 'organizationId', row id, hashedSecret, principalUserId, or scope predicate";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          typeof c.organizationId === "string" ||
          (c.organizationId && Array.isArray(c.organizationId.in)) ||
          hasIdOrInPredicate(c) ||
          typeof c.hashedSecret === "string" ||
          // Rotation grace-window lookup: previousHashedSecret is a
          // uniquely-keyed secret column too, so a where-clause that
          // names it is bounded.
          typeof c.previousHashedSecret === "string" ||
          // Principal-identity lookup: "every VK this user owns" is a
          // legitimate bounded query for user-deactivation / personal-VK
          // listing flows. Cross-org by design but bounded by user.
          typeof c.principalUserId === "string" ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires an 'organizationId', row id, hashedSecret, principalUserId, or scope predicate";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (typeof d.organizationId !== "string") {
          return "create requires an 'organizationId' in the data payload";
        }
      }
      return null;
    },
  },
  VirtualKeyScope: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, virtualKeyId, or scope predicate";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.virtualKeyId === "string" ||
          (c.virtualKeyId && Array.isArray(c.virtualKeyId.in)) ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a row id, virtualKeyId, or scope predicate";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (
          typeof d.virtualKeyId !== "string" ||
          typeof d.scopeType !== "string" ||
          typeof d.scopeId !== "string"
        ) {
          return "create requires virtualKeyId + scopeType + scopeId in the data payload";
        }
      }
      return null;
    },
  },
  ModelDefaultConfig: {
    validateWhere: (where) => {
      if (!where) return "requires a row id, organizationId, or scope predicate";
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a row id, organizationId, or scope predicate";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (!d.scopes) {
          return "create requires a 'scopes' relation in the data payload";
        }
      }
      return null;
    },
  },
  ModelDefaultConfigScope: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, configId, or scope predicate";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.configId === "string" ||
          (c.configId && Array.isArray(c.configId.in)) ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a row id, configId, or scope predicate";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (
          typeof d.configId !== "string" ||
          typeof d.scopeType !== "string" ||
          typeof d.scopeId !== "string"
        ) {
          return "create requires configId + scopeType + scopeId in the data payload";
        }
      }
      return null;
    },
  },
  // Inline single-scope-per-row (ADR-021). A query is bounded by a row id,
  // the organizationId anchor, a (scopeType, scopeId) predicate, or the
  // legacy projectId column (one-release read compat). Every new row must
  // declare its owning organizationId.
  CustomLLMModelCost: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, organizationId, scope predicate, or projectId in the where clause";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          (c.organizationId && Array.isArray(c.organizationId.in)) ||
          hasScopePredicate(c) ||
          typeof c.projectId === "string",
      );
      return ok
        ? null
        : "requires a row id, organizationId, scope predicate, or projectId in the where clause";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (typeof d.organizationId !== "string") {
          return "create requires an organizationId in the data payload";
        }
      }
      return null;
    },
  },
  // Inline single-scope-per-row (ADR-021), one row per (scope, category). A
  // query is bounded by a row id, the organizationId anchor, a
  // (scopeType, scopeId) predicate, or the (scopeType, scopeId, category)
  // compound unique used by per-scope upsert/delete. No legacy projectId
  // column - retention was scope-based from the first migration.
  RetentionPolicy: {
    validateWhere: (where) => {
      const reason =
        "requires a row id, organizationId, or scope predicate in the where clause";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          (c.organizationId && Array.isArray(c.organizationId.in)) ||
          hasScopePredicate(c) ||
          (c.scopeType_scopeId_category &&
            typeof c.scopeType_scopeId_category.scopeId === "string"),
      );
      return ok ? null : reason;
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (typeof d.organizationId !== "string") {
          return "create requires an organizationId in the data payload";
        }
      }
      return null;
    },
  },
  // Inline single-scope-per-row (ADR-021), one row per (scope, personalOnly).
  // Same regime as RetentionPolicy: a query is bounded by a row id, the
  // organizationId anchor, a (scopeType, scopeId) predicate, or the
  // (scopeType, scopeId, personalOnly) compound unique used by per-scope
  // upsert/delete. No projectId column - privacy rules are scope-based.
  DataPrivacyPolicy: {
    validateWhere: (where) => {
      const reason =
        "requires a row id, organizationId, or scope predicate in the where clause";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          (c.organizationId && Array.isArray(c.organizationId.in)) ||
          hasScopePredicate(c) ||
          (c.scopeType_scopeId_personalOnly &&
            typeof c.scopeType_scopeId_personalOnly.scopeId === "string"),
      );
      return ok ? null : reason;
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (typeof d.organizationId !== "string") {
          return "create requires an organizationId in the data payload";
        }
      }
      return null;
    },
  },
};

/**
 * Names of the projectId-less models guardProjectId validates itself (row id /
 * scope predicate / parent FK) instead of exempting outright. Exported for the
 * regime partition test.
 */
export const SCOPED_MODEL_NAMES: readonly string[] = Object.keys(SCOPED_MODELS);

/**
 * The buckets a projectId-less model can legitimately fall into, beyond the
 * org-bearing models derived from the org registry. Exported for the partition
 * test so it can prove every model is classified into exactly one regime.
 */
export const PROJECT_TENANCY_REGIMES = {
  GLOBAL_MODELS,
  RELATIONAL_PARENT_SCOPED,
  LICENSE_COUNTED_PROJECT_MODELS,
} as const;

/**
 * Org-scoped models are exempt from the projectId requirement (an org-scoped
 * model is, by definition, not project-scoped), EXCEPT the ones guardProjectId
 * validates itself through SCOPED_MODELS - those keep their stricter check.
 * Derived from the org guard's registry so the org/project classification lives
 * in exactly one place: a model becomes projectId-exempt automatically once it
 * is declared org-bearing there, and the partition test forbids hand-listing an
 * org-bearing model in GLOBAL_MODELS / RELATIONAL_PARENT_SCOPED here.
 */
const ORG_DERIVED_EXEMPT = ORG_BEARING_MODEL_NAMES.filter(
  (name) => !Object.hasOwn(SCOPED_MODELS, name),
);

const EXEMPT_MODELS = new Set<string>([
  ...GLOBAL_MODELS,
  ...RELATIONAL_PARENT_SCOPED,
  ...LICENSE_COUNTED_PROJECT_MODELS,
  ...ORG_DERIVED_EXEMPT,
]);

const _guardProjectId = ({ params }: { params: Prisma.MiddlewareParams }) => {
  // Raw operations ($queryRaw / $executeRaw) have no model — they are not
  // project-scoped and cannot be auto-guarded (the SQL author owns tenancy).
  // Mirrors the sibling guardOrganizationId, which already exempts no-model ops.
  if (!params.model) return;
  if (params.model && EXEMPT_MODELS.has(params.model)) return;

  const action = params.action;
  const model = params.model;

  // Scoped models opt in to a stricter check than EXEMPT_MODELS:
  // SOMETHING tenancy-shaped (row id, scope predicate, parent FK,
  // or legacy projectId) MUST be present on every query. A bare
  // `findMany()` or a where-without-scope-predicate throws here
  // instead of quietly leaking across tenants. See SCOPED_MODELS
  // comment for the rationale.
  if (model && SCOPED_MODELS[model]) {
    const config = SCOPED_MODELS[model];
    if (action === "create" || action === "createMany") {
      const data =
        action === "create"
          ? params.args?.data
          : params.args?.data;
      const err = config.validateCreateData(data);
      if (err) {
        throw new Error(`The ${action} action on the ${model} model ${err}.`);
      }
    } else {
      const err = config.validateWhere(params.args?.where);
      if (err) {
        throw new Error(`The ${action} action on the ${model} model ${err}.`);
      }
    }
    return;
  }

  if (
    (action === "findFirst" || action === "findUnique") &&
    model === "PublicShare" &&
    (params.args?.where?.id ||
      (params.args?.where?.resourceType && params.args?.where?.resourceId))
  ) {
    return;
  }

  // Gateway auth resolver: findByHashedSecret is the hot-path lookup
  // that converts an opaque `vk-lw-*` bearer token into a
  // VirtualKey row. The hashedSecret itself is a cryptographic
  // identifier unique across the platform (HMAC-SHA256 with a
  // per-deployment pepper), so projectId/organizationId cannot be
  // known to the caller - the VK row IS what teaches them. The OR
  // clause here is always shape
  //   { OR: [{ hashedSecret }, { previousHashedSecret, previousSecretValidUntil }] }
  // matching virtualKey.repository.ts:findByHashedSecret. Narrow
  // exemption matches the PublicShare pattern above.
  if (
    action === "findFirst" &&
    model === "VirtualKey" &&
    Array.isArray(params.args?.where?.OR) &&
    params.args.where.OR.every(
      (o: any) => o?.hashedSecret || o?.previousHashedSecret,
    )
  ) {
    return;
  }

  // Gateway warm-cache resolver: /api/internal/gateway/config/:vk_id
  // hits findUnique({ where: { id: vkId }}) because the gateway
  // already authenticated the VK via resolve-key and now needs the
  // full config payload (keyed by id it learned from the JWT). The
  // HMAC-signed transport + JWT validation upstream is the tenancy
  // check; adding projectId here would require a redundant JWT
  // lookup. Narrow: only findUnique on VirtualKey with a bare id in
  // the where clause - everything else still under the normal guard.
  if (
    action === "findUnique" &&
    model === "VirtualKey" &&
    typeof params.args?.where?.id === "string" &&
    Object.keys(params.args.where).length === 1
  ) {
    return;
  }

  if (action === "create" || action === "createMany") {
    const data =
      action === "create"
        ? params.args?.data
        : params.args?.data?.map((d: any) => d);
    const hasProjectId = Array.isArray(data)
      ? data.every((d) => d.projectId)
      : data?.projectId;

    if (!hasProjectId) {
      throw new Error(
        `The ${action} action on the ${model} model requires a 'projectId' in the data field`,
      );
    }
  } else if (
    !params.args?.where?.projectId &&
    !params.args?.where?.projectId_slug &&
    !params.args?.where?.projectId_date &&
    !params.args?.where?.projectId_modelProviderId_slot &&
    !params.args?.where?.projectId_traceId &&
    !params.args?.where?.projectId?.in &&
    !params.args?.where?.OR?.every((o: any) => o.projectId || o.organizationId)
  ) {
    throw new Error(
      params.args?.where?.OR
        ? `The ${action} action on the ${model} model requires that all the OR clauses check for either the projectId or organizationId`
        : `The ${action} action on the ${model} model requires a 'projectId' or 'projectId.in' in the where clause`,
    );
  }
};

export const guardProjectId: Prisma.Middleware = async (params, next) => {
  _guardProjectId({ params });
  return next(params);
};
