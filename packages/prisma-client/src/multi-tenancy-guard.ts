import { z } from "zod";

import type { GuardMiddleware, GuardParams } from "./guard-middleware.ts";
import { ORG_BEARING_MODEL_NAMES } from "./organization-guard.ts";

// Looks for `projectId`, `organizationId`, or `tenantId` anywhere in
// the SQL string. The legacy outbox drainer carries an explicit
// identifier; the advisory-lock helper opts out via the `-- @tenancy:`
// marker below. Only a genuinely scope-less query would miss both.
const RAW_TENANCY_PREDICATE_RE = /"?(projectId|organizationId|tenantId)"?/i;

// Opt-out marker for the rare query that intentionally scans across
// tenants (e.g. a global recovery sweep, a deploy-time migration helper).
// `-- @tenancy: <reason>` is grep-able and surfaces in code review.
const RAW_TENANCY_OPTOUT_RE = /--\s*@tenancy\s*:/i;

function extractRawSql(args: unknown): string | null {
  if (!args || typeof args !== "object") return null;
  const a = args as Record<string, unknown>;
  // Prisma's $queryRaw / $executeRaw middleware exposes the SQL on
  // either `query` (string) or `strings` (the TemplateStringsArray
  // joined with the parameter placeholders). Both shapes appear
  // depending on Prisma version and call site.
  if (typeof a.query === "string") return a.query;
  if (Array.isArray(a.strings)) return a.strings.join(" ? ");
  // The query-extension era adds one more shape: `$queryRawUnsafe` /
  // `$executeRawUnsafe` deliver `[sql, ...values]`.
  if (Array.isArray(args) && typeof args[0] === "string") return args[0];
  return null;
}

/**
 * Global / cross-cutting models with no tenancy column: NextAuth tables,
 * top-level tenancy entities (by id/slug), and cluster config. The partition
 * test forbids any org-bearing model here — those derive from EXEMPT_MODELS.
 */
const GLOBAL_MODELS = [
  // NextAuth identity tables.
  "Account",
  "Session",
  "User",
  "VerificationToken",
  // Identity pipeline projection tables (ADR-101, D01): per-user, not
  // per-project/org, and the D03 router's lookup is by identifier VALUE
  // before any user is known - inherently cross-user, the same posture as
  // `User` by email above.
  "Identifier",
  "IdentityProjectionCursor",
  // The credential half of the old `Account` row (ADR-116) - the same posture
  // as `Account` above, which it replaces: per-user, keyed by the pinned
  // account id, and read on the sign-in path before any tenant is known.
  "AccountCredential",
  // The address lock (ADR-116 §6): keyed by a normalized identifier value
  // and claimed BEFORE any user is known to hold it, which is the whole
  // point - it is what decides who gets to.
  "IdentifierReservation",
  // Credential tables (passkey, TOTP) are per-user, not per-project.
  // Exempting them from tenancy checks is what makes passkeys work.
  "Passkey",
  "TwoFactor",
  // The MFA aggregate's projection is keyed `tenantId = userId` (D06), so it
  // is per-user by construction like the identity projections above.
  "MfaEnrollment",
  // The directory's `(connectionId, externalId) -> userId` map (D08). Not
  // project-scoped and carries no organizationId; a SCIM push resolves a
  // person through it before anything org-shaped is in hand. Cross-org safety
  // comes from the token's connection scope, which is checked at the endpoint
  // rather than here.
  "ScimExternalId",
  // Top-level tenancy entities, addressed by their own id / slug.
  "Organization",
  "Project",
  // Cluster-wide operator rows; one row per flag key and no tenant column.
  "FeatureFlag",
  // Issue reports sent by customers' coding agents (`langwatch report`). A
  // global support inbox read from the admin backoffice; `linkedProjectId` is
  // informational only, so there is no tenancy column to constrain on.
  "BugReport",
  // The sign-in attempt lock is keyed by a normalized identifier hash and
  // consulted before any user or tenant is known, like IdentifierReservation.
  "SignInAttemptLock",
  // One row per installation: which instance this is, with no tenant at all.
  "InstanceIdentity",
] as const;

/**
 * Relational join / membership tables bounded by a parent FK or composite
 * key rather than a projectId/organizationId column — reached only through
 * their parent, never a bare top-level query, so projectId doesn't apply.
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
  // Keyed by the SSO connection it re-proves; read only through it.
  "SsoConnectionReproofCursor",
  // Connected-billing ledger rows, owned by their ConnectedBillingAccount.
  "ConnectedCreditGrant",
  "ConnectedInvoice",
  "ConnectedSeatChange",
  "ConnectedStatement",
  // A self-hosted instance's reports, reached through the instance row.
  "SelfHostedInstanceReport",
] as const;

/**
 * Project-scoped models (they DO carry projectId) also read by org-level
 * license-counting queries walking project.team.organizationId with no
 * projectId in the WHERE. Exempted only for that read; writes still enforce.
 */
const LICENSE_COUNTED_PROJECT_MODELS = [
  "Workflow",
  "Evaluator",
  "Scenario",
  "BatchEvaluation",
  "Agent",
] as const;

/**
 * Models without projectId but requiring tenancy predicates (row id, scope, or parent FK).
 * Without this map, queries could silently walk all tenants.
 */
type ScopedModelConfig = {
  /**
   * Where-clause validator: null if OK, an error message otherwise. `action`
   * lets bulk writes (`updateMany`/`deleteMany`) hold a stricter predicate
   * than reads — a bounded *view* of many tenants is still an unbounded *edit*.
   */
  validateWhere: (where: any, action?: string) => string | null;
  /** Data validator for create / createMany. */
  validateCreateData: (data: any) => string | null;
};

/**
 * A scopeId value is acceptable as a string (single id) or a Prisma list
 * filter `{ in: [...] }` with a non-empty array — both constrain the query
 * to a finite, caller-known scope; `{}` or `{ in: [] }` would not, so both are rejected.
 */
const isScopeIdValue = (value: any): boolean => {
  if (typeof value === "string") return true;
  if (!value) return false;
  if (typeof value !== "object") return false;
  if (!Array.isArray(value.in)) return false;
  if (value.in.length === 0) return false;
  return value.in.every((v: any) => typeof v === "string");
};

const hasScopedOrBranch = (some: any): boolean => {
  if (!Array.isArray(some.OR)) return false;
  if (some.OR.length === 0) return false;
  return some.OR.every(
    (o: any) => o && typeof o.scopeType === "string" && isScopeIdValue(o.scopeId),
  );
};

const hasScopePredicate = (where: any): boolean => {
  if (!where || typeof where !== "object") return false;
  // Top-level (scopeType, scopeId) - typical for join tables filtering by one scope.
  if (typeof where.scopeType === "string" && isScopeIdValue(where.scopeId)) {
    return true;
  }
  // Nested through a `scopes` relation (`{ scopes: { some: ... } }`), single
  // or OR-list — every OR-branch must be valid so a query can't sneak in
  // `{ OR: [{}] }` and walk every row. scopeId accepts `string` or
  // `{ in: [...] }`; the cascade walker's lists for TEAM/PROJECT tiers ARE
  // the tenancy constraint.
  const some = where.scopes?.some;
  if (some && typeof some === "object") {
    if (typeof some.scopeType === "string" && isScopeIdValue(some.scopeId)) {
      return true;
    }
    if (hasScopedOrBranch(some)) {
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

const validateRecursive = (where: any, passes: (clause: any) => boolean): boolean => {
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
    const allBranchesBounded = where.OR.every((clause: any) => validateRecursive(clause, passes));
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
    return validateParentEntryCreateRecords(records);
  },
});

const validateParentEntryCreateRecords = (records: any[]): string | null => {
  for (const d of records) {
    if (!d) return "create requires a data payload";
    if (typeof d.entryId !== "string") {
      return "create requires an entryId in the data payload";
    }
  }
  return null;
};

const featureFlagExperimentSubjectSchema = z.object({
  subjectType: z.enum(["USER", "ORGANIZATION", "PROJECT"]),
  subjectId: z.string().min(1),
});

const featureFlagExperimentFlagSelectorSchema = z.union([
  z.string().min(1),
  z.object({ in: z.array(z.string().min(1)).min(1) }).strict(),
]);

const featureFlagExperimentCompoundKeySchema = z
  .object({
    flagKey: z.string().min(1),
    subjectType: z.enum(["USER", "ORGANIZATION", "PROJECT"]),
    subjectId: z.string().min(1),
  })
  .strict();

const featureFlagExperimentWhereSchema = z.union([
  z
    .object({
      flagKey_subjectType_subjectId: featureFlagExperimentCompoundKeySchema,
    })
    .strict(),
  z
    .object({
      flagKey: featureFlagExperimentFlagSelectorSchema,
      subjectType: z.enum(["USER", "ORGANIZATION", "PROJECT"]),
      subjectId: z.string().min(1),
    })
    .strict(),
  z
    .object({
      flagKey: featureFlagExperimentFlagSelectorSchema,
      OR: z.array(featureFlagExperimentSubjectSchema).min(1),
    })
    .strict(),
]);

const featureFlagExperimentCreateRecordSchema = z
  .object({
    ...featureFlagExperimentSubjectSchema.shape,
    flagKey: z.string().min(1),
  })
  .passthrough();

const featureFlagExperimentCreateDataSchema = z.union([
  featureFlagExperimentCreateRecordSchema,
  z.array(featureFlagExperimentCreateRecordSchema).min(1),
]);

const SCOPED_MODELS: Record<string, ScopedModelConfig> = {
  AiToolEntryTeam: parentEntryScoped(),
  AiToolEntryDepartment: parentEntryScoped(),
  StoredObject: {
    validateWhere: (where) => {
      const reason = "requires a tenantId in the where clause";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (clause) =>
          typeof clause.tenantId === "string" || typeof clause.tenantId_id?.tenantId === "string",
      );
      return ok ? null : reason;
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      return records.every((record) => typeof record?.tenantId === "string")
        ? null
        : "create requires tenantId in the data payload";
    },
  },
  // Experiment settings are keyed by a flag and one exact subject. A subject
  // can be a user, organization, or project, so these rows cannot use the
  // ordinary projectId rule or a global exemption. The feature service reads
  // an explicitly authorized subject set and writes the compound key; admit
  // only those complete shapes.
  FeatureFlagExperimentSetting: {
    validateWhere: (where) => {
      const reason =
        "requires a flagKey and exact subject, or the flagKey_subjectType_subjectId compound key";
      return featureFlagExperimentWhereSchema.validate(where) ? null : reason;
    },
    validateCreateData: (data) => {
      return featureFlagExperimentCreateDataSchema.validate(data)
        ? null
        : "create requires flagKey, subjectType, and subjectId in the data payload";
    },
  },
  // Idempotency receipts carry their tenancy on `scopeId` alone: the project
  // on the gateway platform's creates, the organization on the webhook
  // platform's. Every query names either the row id just claimed or the
  // (scopeId, key) pair being looked up, so the stricter check is what stops a
  // bare findMany from walking every tenant's keys.
  IdempotencyReceipt: {
    validateWhere: (where) => {
      const reason = "requires a row id or scopeId in the where clause";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.scopeId === "string" ||
          // The compound unique, as `findUnique` spells it.
          typeof c.scopeId_key?.scopeId === "string",
      );
      return ok ? null : reason;
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (typeof d.scopeId !== "string") {
          return "create requires a scopeId in the data payload";
        }
      }
      return null;
    },
  },
  ModelProvider: {
    validateWhere: (where) => {
      if (!where) {
        return "requires a row id, organizationId, or scope predicate in the where clause";
      }
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) || typeof c.organizationId === "string" || hasScopePredicate(c),
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
      return ok ? null : "requires a row id, modelProviderId, or scope predicate";
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
      return ok ? null : "requires a row id, routingPolicyId, or scope predicate";
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
          typeof c.licenseTokenHash === "string" ||
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
      return ok ? null : "requires a row id, virtualKeyId, or scope predicate";
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
          hasIdOrInPredicate(c) || typeof c.organizationId === "string" || hasScopePredicate(c),
      );
      return ok ? null : "requires a row id, organizationId, or scope predicate";
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
      return ok ? null : "requires a row id, configId, or scope predicate";
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
      const reason = "requires a row id, organizationId, or scope predicate in the where clause";
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
      const reason = "requires a row id, organizationId, or scope predicate in the where clause";
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
  // Org-anchored webhook platform (no projectId column): every query must be
  // bounded by the organization or a row id; the cross-org delivery sweep and
  // the retention prune use the raw-SQL tenancy opt-out instead.
  WebhookEndpoint: {
    validateWhere: (where) => {
      const reason = "requires a row id or organizationId in the where clause";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          (c.organizationId && Array.isArray(c.organizationId.in)),
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
  // One table, two channels, two tenancy anchors: a platform row belongs to an
  // organization and an endpoint, an automations row to a project and a
  // trigger. A query is scoped if it names either pair's anchor; a create must
  // carry one complete pair, so a row can never land without a tenant.
  WebhookEndpointDelivery: {
    validateWhere: (where) => {
      const reason =
        "requires a row id, organizationId, endpointId, or projectId in the where clause";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (c) =>
          hasIdOrInPredicate(c) ||
          typeof c.organizationId === "string" ||
          (c.organizationId && Array.isArray(c.organizationId.in)) ||
          typeof c.endpointId === "string" ||
          typeof c.projectId === "string" ||
          (c.projectId && Array.isArray(c.projectId.in)),
      );
      return ok ? null : reason;
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        const platformScoped =
          typeof d.organizationId === "string" && typeof d.endpointId === "string";
        const automationsScoped =
          typeof d.projectId === "string" && typeof d.triggerId === "string";
        if (!platformScoped && !automationsScoped) {
          return "create requires organizationId and endpointId, or projectId and triggerId, in the data payload";
        }
      }
      return null;
    },
  },
  // In-place system migration state (@langwatch/system-migrations). Its
  // tenancy column `tenantId` isn't an FK — the runner is generic over
  // whatever a migration calls a tenant (ADR-092 stage B). Two shapes are
  // legitimate: one tenant's row, or one migration across all tenants (the
  // ops rollup); naming neither would walk every migration's every tenant.
  SystemMigrationTenantState: {
    validateWhere: (where, action) => {
      // A migration-wide predicate is legitimate for READ (the ops rollup
      // lists one migration across tenants), never for WRITE:
      // `deleteMany({ where: { migrationName } })` would drop every tenant's
      // `finalized` latch at once, silently reverting every org to its
      // legacy path. Bulk writes must name a tenant.
      const bulkWrite = action === "updateMany" || action === "deleteMany";
      const reason = bulkWrite
        ? "requires a tenantId in the where clause (a migration-wide bulk write would rewrite every tenant's migration state)"
        : "requires a migrationName or tenantId in the where clause (compound key included)";
      if (!where) return reason;
      const ok = validateRecursive(
        where,
        (c) =>
          typeof c.tenantId === "string" ||
          typeof c.migrationName_tenantId?.tenantId === "string" ||
          // A finite list of migrations is as bounded as one: the periodic
          // re-drive asks about every registered migration in a single read.
          (!bulkWrite && isScopeIdValue(c.migrationName)),
      );
      return ok ? null : reason;
    },
    validateCreateData: (data) => {
      const records = Array.isArray(data) ? data : [data];
      for (const d of records) {
        if (!d) return "create requires a data payload";
        if (typeof d.migrationName !== "string" || typeof d.tenantId !== "string") {
          return "create requires a migrationName and tenantId in the data payload";
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
 * Org-scoped models are exempt from projectId checks. Derived from org guard registry
 * to keep classification in one place.
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

const isRawAction = (action: string): boolean => action === "queryRaw" || action === "executeRaw";

function assertRawTenancy(params: GuardParams): void {
  const sql = extractRawSql(params.args);
  if (!sql) return;
  if (RAW_TENANCY_OPTOUT_RE.test(sql)) return;
  if (RAW_TENANCY_PREDICATE_RE.test(sql)) return;

  throw new Error(
    "The raw query is missing a tenancy predicate. Include `projectId`, " +
      "`organizationId`, or `tenantId` in the SQL — or opt out with a " +
      "`-- @tenancy: <reason>` comment if the query intentionally scans " +
      "across tenants.",
  );
}

function assertScopedModel({ action, args }: GuardParams, model: string): boolean {
  const config = SCOPED_MODELS[model];
  if (!config) return false;

  if (action === "create" || action === "createMany") {
    const err = config.validateCreateData(args?.data);
    if (err) {
      throw new Error(`The ${action} action on the ${model} model ${err}.`);
    }
    return true;
  }

  const err = config.validateWhere(args?.where, action);
  if (err) {
    throw new Error(`The ${action} action on the ${model} model ${err}.`);
  }
  return true;
}

function isShareLinkCapabilityLookup({ action, args }: GuardParams, model: string): boolean {
  if (action !== "findFirst" && action !== "findUnique") return false;
  if (model !== "ShareLink") return false;
  return Boolean(args?.where?.token || args?.where?.id);
}

// Gateway auth resolver: hashedSecret is cryptographically unique across the
// platform, so the VK row teaches the projectId rather than requiring it in the
// where clause.
function isVirtualKeySecretLookup({ action, args }: GuardParams, model: string): boolean {
  if (action !== "findFirst") return false;
  if (model !== "VirtualKey") return false;

  const orClauses = args?.where?.OR;
  if (!Array.isArray(orClauses)) return false;
  return orClauses.every((o: any) => o?.hashedSecret || o?.previousHashedSecret);
}

// Gateway warm-cache resolver: /api/internal/gateway/config/:vk_id hits
// findUnique({ where: { id: vkId }}) after the gateway already authenticated
// the VK via resolve-key. HMAC-signed transport + JWT validation upstream IS
// the tenancy check; adding projectId here would need a redundant JWT lookup.
function isVirtualKeyWarmCacheLookup({ action, args }: GuardParams, model: string): boolean {
  if (action !== "findUnique") return false;
  if (model !== "VirtualKey") return false;
  if (typeof args?.where?.id !== "string") return false;
  return Object.keys(args.where).length === 1;
}

function isProjectLookupExempt(params: GuardParams, model: string): boolean {
  if (isShareLinkCapabilityLookup(params, model)) return true;
  if (isVirtualKeySecretLookup(params, model)) return true;
  return isVirtualKeyWarmCacheLookup(params, model);
}

function assertCreateProjectId({ action, args }: GuardParams, model: string): void {
  const data = args?.data;
  const hasProjectId = Array.isArray(data) ? data.every((d) => d.projectId) : data?.projectId;

  if (!hasProjectId) {
    throw new Error(
      `The ${action} action on the ${model} model requires a 'projectId' in the data field`,
    );
  }
}

function whereHasProjectScope(where: any): boolean {
  if (where?.projectId) return true;
  if (where?.projectId_slug) return true;
  if (where?.projectId_date) return true;
  if (where?.projectId_modelProviderId_slot) return true;
  if (where?.projectId_traceId) return true;
  if (where?.projectId?.in) return true;
  return Boolean(where?.OR?.every((o: any) => o.projectId || o.organizationId));
}

function assertWhereProjectId({ action, args }: GuardParams, model: string): void {
  const where = args?.where;
  if (whereHasProjectScope(where)) return;

  throw new Error(
    where?.OR
      ? `The ${action} action on the ${model} model requires that all the OR clauses check for either the projectId or organizationId`
      : `The ${action} action on the ${model} model requires a 'projectId' or 'projectId.in' in the where clause`,
  );
}

const _guardProjectId = ({ params }: { params: GuardParams }) => {
  const action = params.action;

  // Raw queries (`$queryRaw`/`$executeRaw`) carry tenancy scope inside the
  // SQL string, invisible to the structural guard. Two cheap defences apply:
  // require a tenancy column mention, or a grep-able `-- @tenancy: <reason>`
  // opt-out. Must run BEFORE the no-model exemption below — raw ops have no
  // `params.model`, so an earlier `!params.model` return would skip this.
  if (isRawAction(action)) {
    assertRawTenancy(params);
    return;
  }

  // Other model-less operations (e.g. $transaction bookkeeping) are not
  // project-scoped and cannot be auto-guarded. Mirrors the sibling
  // guardOrganizationId, which already exempts no-model ops.
  if (!params.model) return;
  if (EXEMPT_MODELS.has(params.model)) return;

  const model = params.model;

  // Scoped models opt in to a stricter check than EXEMPT_MODELS: SOMETHING
  // tenancy-shaped (row id, scope predicate, parent FK, or legacy projectId)
  // MUST be present on every query. A bare `findMany()` or a
  // where-without-scope-predicate throws here instead of quietly leaking
  // across tenants. See SCOPED_MODELS for the rationale.
  if (assertScopedModel(params, model)) return;

  // ShareLink resolution: an anonymous viewer presents only a share token
  // (or id) — the projectId is what the row teaches them, so it cannot be
  // required in the where. `token` is the capability path; `id` covers the
  // pre-revocation ownership check. No other lookup shape is exempt (ADR-057).
  if (isProjectLookupExempt(params, model)) return;

  if (action === "create" || action === "createMany") {
    assertCreateProjectId(params, model);
    return;
  }

  assertWhereProjectId(params, model);
};

export const guardProjectId: GuardMiddleware = async (params, next) => {
  _guardProjectId({ params });
  return next(params);
};
