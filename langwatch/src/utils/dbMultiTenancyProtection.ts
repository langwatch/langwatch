import type { Prisma } from "@prisma/client";

const EXEMPT_MODELS = [
  "Account",
  "Session",
  "User",
  "VerificationToken",
  "TeamUser",
  "OrganizationUser",
  "Team",
  "Organization",
  "OrganizationInvite",
  "Project",
  "Subscription",
  "AuditLog",
  /**
   * Because prompts can be accessed at either the project or org level
   */
  "LlmPromptConfig",
  /**
   * Custom roles are organization-level, not project-level
   */
  "CustomRole",
  /**
   * Notifications can be at organization or project level
   */
  "Notification",
  /**
   * License enforcement needs to count resources across all projects in an organization.
   * These models are queried by organizationId (through project.team.organizationId)
   * for license limit enforcement.
   */
  "Workflow",
  "Evaluator",
  "Scenario",
  "BatchEvaluation",
  "Agent",
  /**
   * Billing meter checkpoints are organization-level, keyed by organizationId + billingMonth
   */
  "BillingMeterCheckpoint",
  /**
   * SCIM tokens are organization-level, used for IdP provisioning
   */
  "ScimToken",
  /**
   * Custom prompt tag definitions are organization-level, not project-level.
   * They are scoped by organizationId.
   */
  "PromptTag",
  /**
   * Scoped RBAC models are organization-level.
   * Groups and RoleBindings are scoped by organizationId, not projectId.
   * GroupMembership is scoped indirectly via groupId.
   */
  "Group",
  "GroupMembership",
  "RoleBinding",
  /**
   * API keys are organization-level, scoped by organizationId + userId.
   */
  "ApiKey",
  /**
   * Cost centers are organization-level accounting dimensions, scoped by
   * organizationId (never projectId). The service layer enforces org
   * scoping on every query. See cost-centers.feature.
   */
  "CostCenter",
  /**
   * AI Gateway models. Post-iter-110 (collapse-VK-binding refactor):
   * - GatewayBudget: org-level (scopeType + scopeId identifies which
   *   target); no projectId column by design.
   * - GatewayBudgetLedger: descends from VirtualKey via virtualKeyId
   *   rather than a direct projectId column.
   * - GatewayChangeEvent / GatewayAuditLog: allow null projectId for
   *   org-level mutations; org tenancy is checked at the service
   *   layer before any write.
   * - VirtualKeyProviderCredential + GatewayProviderCredential: tables
   *   dropped in iter 110 (folded into ModelProvider).
   * - VirtualKey itself moved to SCOPED_MODELS below — post-iter-110
   *   it's org-scoped (organizationId mandatory) and access narrows
   *   via VirtualKeyScope rows, so the legacy projectId guard no
   *   longer applies. SCOPED_MODELS enforces a row-id / scope /
   *   organizationId predicate on every read + write.
   */
  "GatewayBudget",
  "GatewayBudgetLedger",
  "GatewayChangeEvent",
  "GatewayAuditLog",
  /**
   * GatewayCacheRule is organization-level (authored once, applies
   * across every VK owned by the org based on matcher shape). Same
   * rationale as GatewayBudget — no projectId column, scoped by
   * organizationId + matcher fields.
   */
  "GatewayCacheRule",
  /**
   * FeatureFlag is cluster-wide, not project-scoped. One row per flag
   * key; operators flip them from /ops/feature-flags, applying to the
   * whole install. No projectId column by design; this is the table
   * that keeps system-scoped kill switches off PostHog.
   */
  "FeatureFlag",
  /**
   * RoutingPolicy (iter governance-platform) is org-scoped:
   * (organizationId, scope, scopeId, name) is the natural key. Scope
   * may be 'organization' | 'team' | 'project', but the row itself
   * doesn't carry a projectId column. Resolution paths
   * (`resolveDefaultForUser`) query by organizationId + scope +
   * scopeId — projectId enforcement would block the lookup.
   *
   * Same rationale as ModelProvider above (also (scopeType, scopeId)-
   * keyed). Service layer authorises ownership via organizationId
   * before any mutation; the middleware exemption only relaxes the
   * SQL guard.
   */
  "RoutingPolicy",
  /**
   * IngestionSource (iter governance-platform / D2 foundation) is
   * org-scoped: the natural key is (organizationId, name). Optional
   * teamId narrows scope but no projectId — the entire point is a
   * cross-platform feed at the org level. Service layer authorises
   * by organizationId / teamId membership before any mutation.
   */
  "IngestionSource",
  /**
   * AnomalyRule (iter governance-platform / D2 anomaly authoring) is
   * org-scoped: the natural key is (organizationId, name). The rule's
   * `scope` field (organization|team|project|source_type|source) is
   * an EVALUATION-time narrowing, not a tenancy boundary — service
   * layer authorises by organizationId membership before any mutation.
   */
  "AnomalyRule",
  /**
   * AnomalyAlert (iter governance-platform / D2 anomaly detection) is
   * org-scoped persisted detections. Same rationale as AnomalyRule —
   * org-scoped, no projectId, service layer authorises by
   * organizationId before any mutation.
   */
  "AnomalyAlert",
  /**
   * AiToolEntry (iter governance-platform / Phase 7) is the org-scoped
   * AI Tools Portal catalog. Entries can be scoped to organization or
   * team via (scope, scopeId) but never carry a projectId — the portal
   * surfaces tools at the org tier (cross-project / cross-team
   * organization-default surface). Service layer authorises by
   * organizationId membership before any mutation; team-scoped entries
   * are authorised via TeamUser membership at read time.
   */
  "AiToolEntry",
  /**
   * AiToolEntryTeam (iter governance-platform / Phase 7 multi-team
   * scope refactor) is the join table binding AiToolEntry rows to
   * teams. Same rationale as AiToolEntry — org-scoped via the
   * referenced entry, no projectId; service layer authorises by the
   * parent entry's organizationId before any mutation.
   */
  "AiToolEntryTeam",
  /**
   * IngestionTemplate is org-scoped: organizationId nullable
   * (NULL = platform-published default, NOT NULL = org-authored).
   * No projectId column — admin queries walk by organizationId or
   * by the platform-default scope. Service layer authorises by
   * organizationId membership (or platform-team scope) before any
   * mutation.
   */
  "IngestionTemplate",
  /**
   * UserIngestionBinding carries personalProjectId, but admin-side
   * queries walk by organizationId (admin viewing all bindings in
   * their org). User-side queries are scoped by userId. Service layer
   * authorises by userId === caller for user-side ops, and by
   * organizationId membership for admin-side ops; the cross-bind
   * structural-impossibility guard (input shape MUST NOT accept
   * personalProjectId) keeps user-side ops from binding into another
   * user's project.
   */
  "UserIngestionBinding",
];

/**
 * Models that don't have a projectId column to constrain on, but ARE
 * tenancy-sensitive — every query MUST carry an equivalent tenancy
 * predicate (a row id, a scope predicate, or a parent foreign key
 * that itself transitively carries scope). The default guard above
 * would fail any of these queries because the where clause has no
 * `projectId`, so without this map they end up in EXEMPT_MODELS —
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
 * tenancy clause too (one-release compat — old call sites keep
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
  // Top-level (scopeType, scopeId) — typical for join tables filtering by one scope.
  if (typeof where.scopeType === "string" && isScopeIdValue(where.scopeId)) {
    return true;
  }
  // Nested through a `scopes` relation (`{ scopes: { some: ... } }`),
  // either a single predicate or an OR-list. Every OR-branch must be
  // a valid scope predicate so a query can't sneak in `{ OR: [{}] }`
  // and walk every row. scopeId accepts both `string` and `{ in: [...] }`
  // shapes — the cascade walker passes lists for TEAM / PROJECT tiers
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

const SCOPED_MODELS: Record<string, ScopedModelConfig> = {
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
};

const _guardProjectId = ({ params }: { params: Prisma.MiddlewareParams }) => {
  if (params.model && EXEMPT_MODELS.includes(params.model)) return;

  const action = params.action;
  const model = params.model;

  // Raw queries (`$queryRaw`, `$executeRaw`) carry their tenancy scope
  // inside the SQL string itself — `WHERE "projectId" = ${projectId}` lives
  // in the template literal, where the structural guard cannot see it. The
  // guard's promise (refuse a query that doesn't carry a tenancy predicate)
  // is therefore unmeetable at this layer; the call sites are responsible
  // for embedding the scope in the SQL, and PG enforces it. Lifting them
  // through the guard would force a refactor away from raw SQL for
  // primitives that need `FOR UPDATE SKIP LOCKED` (outbox legacy drainer)
  // or `pg_advisory_xact_lock` (model-default scope lock) — both of which
  // the typed Prisma API cannot express.
  if (action === "queryRaw" || action === "executeRaw") return;

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
  // known to the caller — the VK row IS what teaches them. The OR
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
  // the where clause — everything else still under the normal guard.
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
