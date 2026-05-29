import type { Prisma } from "@prisma/client";

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
   * Extra single-org-bounding predicates beyond organizationId / row id /
   * composite-org key. Used for parent foreign keys and globally-unique
   * secret columns that each resolve to exactly one organization.
   */
  extraBound?: (clause: any) => boolean;
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
  (typeof clause?.scopeId === "string" || isNonEmptyStringList(clause?.scopeId));

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
    extraBound: (c) => typeof c?.inviteCode === "string",
  },
  // Org-scoped RBAC + config models, audited to already carry a bounded
  // predicate (organizationId, a row id, a compound org key, a parent FK, or
  // an inline scope) on every call site.
  CustomRole: {},
  Group: {},
  RoleBinding: {
    // Reachable by its parent api key / group (each owned by one org) or by
    // its inline (scopeType, scopeId) target (a team / project id unique
    // across the platform), all of which bound to a single organization.
    extraBound: (c) =>
      typeof c?.apiKeyId === "string" ||
      typeof c?.groupId === "string" ||
      hasInlineScope(c),
  },
  ApiKey: {
    // lookupId is the globally-unique public half of an API token; the auth
    // path resolves a bearer token to its single owning org through it.
    extraBound: (c) => typeof c?.lookupId === "string",
  },
  RoutingPolicy: {},
  AnomalyRule: {},
  AnomalyAlert: {},
  AiToolEntry: {},
  GatewayBudget: {},
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
  "ModelProvider",
  "ModelDefaultConfig",
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
  // Org-scoped but not yet audited for every query shape. Listed explicitly so
  // the partition test stays green while the per-model call-site audit that
  // precedes enforcement (ADR-021) is completed.
  "BillingMeterCheckpoint",
  "CostCenter",
  "GatewayCacheRule",
  "IngestionSource",
  "PromptTag",
  "ScimToken",
  "Subscription",
  "UserIngestionBinding",
];

export const ORG_SCOPED_MODEL_NAMES: readonly string[] =
  Object.keys(ORG_SCOPED_MODELS);

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

const _guardOrganizationId = ({
  params,
}: {
  params: Prisma.MiddlewareParams;
}) => {
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
    (config.extraBound ? config.extraBound(clause) : false);

  if (!validateRecursive(where, passes)) {
    throw new Error(
      `The ${action} action on the ${model} model requires an 'organizationId', row id, or model-specific tenancy key in the where clause`,
    );
  }
};

export const guardOrganizationId: Prisma.Middleware = async (params, next) => {
  _guardOrganizationId({ params });
  return next(params);
};
