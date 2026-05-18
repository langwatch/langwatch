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
  "OrganizationFeature",
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
   * AI Gateway models. Budgets are organization-level (scopeType +
   * scopeId identifies which target); ledger rows descend from VirtualKey
   * via virtualKeyId rather than a direct projectId column; change-events
   * and audit logs both allow null projectId for org-level mutations;
   * VirtualKeyProviderCredential is a join table whose composite PK is
   * (virtualKeyId, providerCredentialId) — projectId is reachable via
   * the parent VK but not a direct column. VirtualKey and
   * GatewayProviderCredential are project-scoped and stay under the
   * middleware's normal guard.
   */
  "GatewayBudget",
  "GatewayBudgetLedger",
  "GatewayChangeEvent",
  "GatewayAuditLog",
  "VirtualKeyProviderCredential",
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
  return false;
};

const SCOPED_MODELS: Record<string, ScopedModelConfig> = {
  ModelProvider: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a 'projectId', row id, or scope predicate in the where clause";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          typeof c.projectId === "string" ||
          (c.projectId && Array.isArray(c.projectId.in)) ||
          hasIdOrInPredicate(c) ||
          hasScopePredicate(c),
      );
      return ok
        ? null
        : "requires a 'projectId', row id, or scope predicate in the where clause";
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        const hasProjectId = typeof d.projectId === "string";
        const hasScopes = !!d.scopes;
        if (!hasProjectId && !hasScopes) {
          return "create requires either a 'projectId' or a 'scopes' relation in the data payload";
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
  ModelDefaultConfig: {
    validateWhere: (where) => {
      if (!where) return "requires a row id or scope predicate";
      const ok = validateRecursive(
        where,
        (c) => hasIdOrInPredicate(c) || hasScopePredicate(c),
      );
      return ok ? null : "requires a row id or scope predicate";
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
};

const _guardProjectId = ({ params }: { params: Prisma.MiddlewareParams }) => {
  if (params.model && EXEMPT_MODELS.includes(params.model)) return;

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
  // that converts an opaque `lw_vk_live_*` bearer token into a
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
