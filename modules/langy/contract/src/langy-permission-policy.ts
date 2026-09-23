import {
  AUTHZ_RESOURCES,
  bindingScopeCanGrantPermission,
  type AuthzPermission,
} from "@langwatch/authz-contract";

/**
 * Partition of authz permissions: full access (ceiling), auth-scope
 * read-only, and fully excluded. `classifyForLangy` decides per permission;
 * `langy-permission-coverage` enforces totality. ADR-092, ADR-021.
 */

/**
 * Verdict for permission: granted, excluded (policy refuses), or unreachable
 * (scope fence refuses org-exclusive at project tier). Reason string says
 * which wall was hit (ADR-021).
 */
export type LangyPermissionVerdict =
  | { readonly disposition: "granted" }
  | { readonly disposition: "excluded"; readonly reason: string }
  | { readonly disposition: "unreachable"; readonly reason: string };

/**
 * Delegable actions: destructive (delete/manage) bounded by ceiling, and
 * guardrail actions (attach/detach) bounded by caller's own access.
 */
const DELEGABLE_ACTIONS = new Set([
  "view",
  "create",
  "update",
  "delete",
  "manage",
  "attach",
  "detach",
]);

/**
 * Excluded actions: not in user ceiling. Keyed by action so new ones surface
 * explicitly. Absence from both this and DELEGABLE_ACTIONS fails totality check
 * (fail-closed, not fail-open).
 */
const ACTION_EXCLUSIONS: Record<string, string> = {
  // Disclosure, not access. A share link is readable by people who hold no
  // permission in the project at all — including nobody, i.e. the public
  // internet — so "the user could have done it too" does not bound the blast
  // radius the way it does for a delete. Sharing stays a deliberate human act.
  share: "creates PUBLIC, unauthenticated links to a customer's traces",
  // Rotation invalidates a live credential in place. Every integration holding
  // the old value breaks at once, and unlike a delete there is no row left to
  // point at afterwards to explain what happened.
  rotate: "rotates a live credential, breaking every integration holding it",
  // An admin audit power over OTHER principals' credentials, which is the auth
  // scope in its purest form.
  viewOtherPersonal: "reads other members' personal keys, an admin audit power over the auth scope",
  // The only action on `featureFlags`, and it decides which tenants a platform
  // rollout enrols — an operator control over LangWatch's own release process
  // rather than anything the tenant's data does. The ceiling does not bound it
  // the way it bounds a delete: enrolling a project changes what the PRODUCT
  // does for everyone in it, not what one caller can reach.
  manageExperiments:
    "sets feature-flag experiment enrolment for a whole project or organization, a platform rollout control rather than tenant data",
};

/**
 * Fully excluded families: secrets (reading = obtaining), agentCache (stores
 * sessions), langy (recursive authority), ops (platform surgery), featureFlags
 * (release machinery, not tenant data).
 */
const FULLY_EXCLUDED_FAMILIES: Record<string, string> = {
  secrets: "reading a stored credential is obtaining it; there is no safe read",
  agentCache:
    "an agent stores the session it logged in with here, so a read returns a " +
    "credential; and every route in the family asks for `agentCache:manage`",
  langy:
    "`langy:create` starts Langy turns, so holding it lets Langy invoke " +
    "itself recursively; and its conversations are Langy's own record",
  ops: "platform operations for LangWatch staff, not a tenant-facing capability",
  featureFlags:
    "enrols a project or organization in a LangWatch rollout experiment, " +
    "which is release machinery rather than a tenant capability",
};

/**
 * Auth-scope families: readable, never writable (changes who can do what).
 * Stricter than manage alone (hierarchy implies rotate). virtualKeys excluded
 * via GRAIN_EXCLUSIONS because manage implies rotate. See ADR-021 scope fence.
 */
const AUTH_SCOPE_FAMILIES: Record<string, string> = {
  organization: "org membership and role administration IS the auth scope",
  team: "team membership administration decides who holds what",
  project:
    "`project:update` stores model-provider credentials and `project:manage` " +
    "regenerates the project's own API key",
  gatewayProviders: "stores provider credentials",
  webhookEndpoints:
    "endpoints carry signing secrets and stream org-wide event families out " + "of the platform",
  // Not credentials, but the same shape of argument: an assistant that can
  // edit the record of what it did is an assistant whose record proves
  // nothing. Read it, explain it, never write it.
  auditLog: "the record of who did what, including Langy's own actions",
  // Bulk egress of an org's data — the same disclosure axis as `share` above,
  // at a family granularity instead of an action one.
  complianceExport: "bulk export of an org's data is egress, not access",
};

/**
 * Full access families: CRUD + delete/manage; enumerated so an unclassified
 * family fails CI (fail-closed). Seven are inert at project scope: governance,
 * anomalyRules, aiTools, activityMonitor, gatewaySpend, governanceCost, ingestionSources.
 */
const FULL_ACCESS_FAMILIES = new Set([
  "analytics",
  "annotations",
  "anomalyRules",
  "aiTools",
  "activityMonitor",
  "cost",
  "datasets",
  "evaluations",
  "experiments",
  "gatewayBudgets",
  "gatewayCacheRules",
  "gatewayGuardrails",
  "gatewayLogs",
  "gatewaySpend",
  "gatewayUsage",
  "governance",
  "governanceCost",
  "ingestionSources",
  "playground",
  "prompts",
  "routingPolicies",
  "scenarios",
  "traces",
  "triggers",
  "virtualKeys",
  "workflows",
]);

/**
 * Grain-level exclusions: withheld when permission hierarchy makes coarser
 * grain imply an excluded one. E.g., virtualKeys:manage (manage implies rotate).
 */
const GRAIN_EXCLUSIONS: Record<string, string> = {
  "virtualKeys:manage":
    "`:manage` implies `:rotate` through the permission hierarchy, and " +
    "rotation breaks every integration holding the credential",
};

/**
 * The auth-scope family inventory, exported so tests assert against the
 * policy's own list instead of hand-copying it — four copies existed
 * before this export, and a family added above would miss all of them.
 */
export const LANGY_AUTH_SCOPE_FAMILY_NAMES: readonly string[] = Object.freeze(
  Object.keys(AUTH_SCOPE_FAMILIES),
);

/**
 * Every family in the system, in exactly one bucket. Exported so the coverage
 * test can assert the partition is total against the registry — the check that
 * makes a newly-invented family fail CI instead of sitting silently refused.
 */
export const LANGY_CLASSIFIED_FAMILIES: ReadonlySet<string> = new Set([
  ...Object.keys(FULLY_EXCLUDED_FAMILIES),
  ...Object.keys(AUTH_SCOPE_FAMILIES),
  ...FULL_ACCESS_FAMILIES,
]);

/**
 * Sum of the three family buckets BEFORE de-duplication. Equal to
 * `LANGY_CLASSIFIED_FAMILIES.size` iff the buckets are disjoint — the
 * coverage test asserts exactly that.
 */
export const LANGY_FAMILY_BUCKET_TOTAL =
  Object.keys(FULLY_EXCLUDED_FAMILIES).length +
  Object.keys(AUTH_SCOPE_FAMILIES).length +
  FULL_ACCESS_FAMILIES.size;

/** Every family the registry declares. The universe the partition must cover. */
export const ALL_PERMISSION_FAMILIES: readonly string[] = Object.freeze(
  Object.keys(AUTHZ_RESOURCES),
);

/**
 * Every action classified one way or the other, for the coverage test's
 * totality check against the registry.
 */
export const LANGY_CLASSIFIED_ACTIONS: ReadonlySet<string> = new Set([
  ...DELEGABLE_ACTIONS,
  ...Object.keys(ACTION_EXCLUSIONS),
]);

/** Pre-dedup sum of the two action buckets; see LANGY_FAMILY_BUCKET_TOTAL. */
export const LANGY_ACTION_BUCKET_TOTAL =
  DELEGABLE_ACTIONS.size + Object.keys(ACTION_EXCLUSIONS).length;

/** Every action the registry declares. The universe the partition must cover. */
export const ALL_PERMISSION_ACTIONS: readonly string[] = Object.freeze([
  ...new Set(Object.values(AUTHZ_RESOURCES).flatMap((resource) => resource.actions)),
]);

/** The read grain. Anything else is a write as far as this policy is concerned. */
const READ_ACTION = "view";

/** The action that only means anything on the gateway-guardrail family. */
const GUARDRAIL_ONLY_ACTIONS = new Set(["attach", "detach"]);
const GUARDRAIL_FAMILY = "gatewayGuardrails";

/**
 * True when the registry declares this permission's resource org-only, so
 * no PROJECT-scoped binding can carry it. The Langy session key mints only
 * project-scoped bindings, so this fence is final regardless of classification.
 */
function onlyAnOrgScopedBindingCanGrant(permission: string): boolean {
  return !bindingScopeCanGrantPermission({ scopeType: "PROJECT", permission });
}

/**
 * Candidate list: derived from rule (CI-enforced totality beats hand-maintenance
 * defects). Filtered by PROJECT scope: org-exclusive permissions refused at
 * project tier (ADR-021). Deterministic order for stable minted key.
 */
export function langyCandidatePermissions(): AuthzPermission[] {
  const candidates: AuthzPermission[] = [];
  for (const family of ALL_PERMISSION_FAMILIES) {
    for (const action of ALL_PERMISSION_ACTIONS) {
      const permission = `${family}:${action}` as AuthzPermission;
      if (classifyForLangy(permission).disposition === "granted") {
        candidates.push(permission);
      }
    }
  }
  return candidates;
}

/** Splits `resource:action`, tolerating anything that is not in that shape. */
export function splitPermission(permission: string): {
  family: string;
  action: string;
} {
  const index = permission.indexOf(":");
  if (index === -1) return { family: permission, action: "" };
  return {
    family: permission.slice(0, index),
    action: permission.slice(index + 1),
  };
}

/**
 * Grain exclusion reason: grain-level (GRAIN_EXCLUSIONS) or action-only
 * (attach/detach on gatewayGuardrails). Returns reason or undefined.
 */
function grainExclusionReason(family: string, action: string): string | undefined {
  const grainExcluded = GRAIN_EXCLUSIONS[`${family}:${action}`];
  if (grainExcluded) return grainExcluded;
  if (GUARDRAIL_ONLY_ACTIONS.has(action) && family !== GUARDRAIL_FAMILY) {
    return `\`${action}\` polices gateway guardrails and means nothing on \`${family}\``;
  }
  return undefined;
}

/**
 * Classify permission: granted, excluded (policy), or unreachable (scope).
 * Fail-closed: too strict shows as reviewer needing to classify, not silently
 * over-broad credential.
 */
export function classifyForLangy(permission: string): LangyPermissionVerdict {
  const { family, action } = splitPermission(permission);

  if (!action) {
    return {
      disposition: "excluded",
      reason: "not a `resource:action` permission",
    };
  }

  if (!DELEGABLE_ACTIONS.has(action)) {
    return {
      disposition: "excluded",
      reason:
        ACTION_EXCLUSIONS[action] ??
        `\`${action}\` has not been classified for Langy. Add it to ` +
          `DELEGABLE_ACTIONS or record why it is withheld in ACTION_EXCLUSIONS`,
    };
  }

  const fullyExcluded = FULLY_EXCLUDED_FAMILIES[family];
  if (fullyExcluded) return { disposition: "excluded", reason: fullyExcluded };

  const grainExcluded = grainExclusionReason(family, action);
  if (grainExcluded) return { disposition: "excluded", reason: grainExcluded };

  const authScope = AUTH_SCOPE_FAMILIES[family];
  if (authScope && action !== READ_ACTION) {
    return {
      disposition: "excluded",
      reason: `${authScope} — Langy may read the auth scope, never write it`,
    };
  }

  if (!authScope && !FULL_ACCESS_FAMILIES.has(family)) {
    return {
      disposition: "excluded",
      reason:
        `\`${family}\` has not been classified for Langy. Add it to ` +
        `FULL_ACCESS_FAMILIES if Langy may use it, AUTH_SCOPE_FAMILIES if it ` +
        `decides who can do what or holds a credential, or ` +
        `FULLY_EXCLUDED_FAMILIES if not even a read is safe`,
    };
  }

  // The policy would grant it, but the session key is minted with a single
  // PROJECT-scoped binding and the ADR-021 scope fence refuses org-exclusive
  // permissions below the org tier. Listing it as a candidate would put dead
  // rows in front of the permission batch on every turn and invite a reader
  // to conclude Langy has access it has never had.
  if (onlyAnOrgScopedBindingCanGrant(permission)) {
    return {
      disposition: "unreachable",
      reason:
        `\`${family}\` is an organization-tier resource and the Langy ` +
        `session key is project-scoped; no project permission can grant it`,
    };
  }

  return { disposition: "granted" };
}
