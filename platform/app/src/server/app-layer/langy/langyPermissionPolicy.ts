import {
  AUTHZ_ACTIONS,
  type AuthzPermission,
  permissionGrantTiers,
} from "@langwatch/authz";
import { CUSTOM_ROLE_RESOURCES } from "../authz/custom-role-permissions";

/**
 * Langy delegates tenant work within the caller's current permission ceiling.
 * Auth administration, credentials, public sharing and recursive Langy calls
 * stay excluded. Coverage requires every resource and action to be classified.
 */

/**
 * Verdict for a single permission. Non-granted verdicts always carry their
 * reason. `excluded` means the POLICY refuses it; `unreachable` means the
 * policy would grant it but the grain cannot exist on a project-scoped
 * binding (`bindingScopeCanGrant` refuses org-exclusive permissions below
 * the org tier), so the minted key never carries it. The distinction matters
 * to the customer-facing denial: "widen your own role" is useless advice for
 * either, and the reason string says which wall was hit.
 */
export type LangyPermissionVerdict =
  | { readonly disposition: "granted" }
  | { readonly disposition: "excluded"; readonly reason: string }
  | { readonly disposition: "unreachable"; readonly reason: string };

/** Destructive data operations remain bounded by the caller’s current access. */
const DELEGABLE_ACTIONS = new Set([
  "view",
  "create",
  "update",
  "delete",
  "manage",
  "attach",
  "detach",
]);

/** Unclassified actions fail closed; these actions are always excluded. */
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
  viewOtherPersonal:
    "reads other members' personal keys, an admin audit power over the auth scope",
};

/** Exclude credential disclosure, recursive invocation and staff operations. */
const FULLY_EXCLUDED_FAMILIES: Record<string, string> = {
  secrets: "reading a stored credential is obtaining it; there is no safe read",
  agentCache:
    "an agent stores the session it logged in with here, so a read returns a " +
    "credential; and every route in the family asks for `agentCache:manage`",
  langy:
    "`langy:create` starts Langy turns, so holding it lets Langy invoke " +
    "itself recursively; and its conversations are Langy's own record",
  ops: "platform operations for LangWatch staff, not a tenant-facing capability",
};

/** Authorization, credentials and audit records may be read but never changed. */
const AUTH_SCOPE_FAMILIES: Record<string, string> = {
  sso: "an SSO connection decides how everyone in the org signs in",
  // Its own entry rather than a clause in `sso`'s: they are two families in
  // the resource catalogue, and a family with no entry of its own is exactly what the
  // classification tripwire exists to catch. Writing it provisions and
  // deprovisions membership, which changes who can do what.
  scim: "directory sync writes who exists in the organization",
  organization: "org membership and role administration IS the auth scope",
  team: "team membership administration decides who holds what",
  project:
    "`project:update` stores model-provider credentials and `project:manage` " +
    "regenerates the project's own API key",
  gatewayProviders: "stores provider credentials",
  webhookEndpoints:
    "endpoints carry signing secrets and stream org-wide event families out " +
    "of the platform",
  // Not credentials, but the same shape of argument: an assistant that can
  // edit the record of what it did is an assistant whose record proves
  // nothing. Read it, explain it, never write it.
  auditLog: "the record of who did what, including Langy's own actions",
  // Bulk egress of an org's data — the same disclosure axis as `share` above,
  // at a family granularity instead of an action one.
  complianceExport: "bulk export of an org's data is egress, not access",
};

/** Explicit classification keeps new resource families denied until reviewed. */
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
 * Single grains withheld even though their family and action are both
 * otherwise delegable. Smallest hammer in the file — use it only when the
 * permission HIERARCHY makes a coarser grain imply an excluded one.
 *
 * `virtualKeys:manage` is here because `:manage` implies `:rotate`
 * so granting it would make the `rotate` exclusion above a
 * statement about this file's text rather than about the credential. See the
 * `virtualKeys` note on `AUTH_SCOPE_FAMILIES` for the accepted cost.
 */
const GRAIN_EXCLUSIONS: Record<string, string> = {
  "virtualKeys:manage":
    "`:manage` implies `:rotate` through the permission hierarchy, and " +
    "rotation breaks every integration holding the credential",
};

/**
 * Every family in the system, in exactly one bucket. Exported so the coverage
 * test can assert the partition is total against the resource catalogue — the check that
 * makes a newly-invented family fail CI instead of sitting silently refused.
 */
/**
 * The auth-scope family inventory, exported so tests assert against the
 * policy's own list instead of hand-copying it (four copies of that list
 * existed before this export; a family added above would have missed all of
 * them silently).
 */
export const LANGY_AUTH_SCOPE_FAMILY_NAMES: readonly string[] = Object.freeze(
  Object.keys(AUTH_SCOPE_FAMILIES),
);

export const LANGY_CLASSIFIED_FAMILIES: ReadonlySet<string> = new Set([
  ...Object.keys(FULLY_EXCLUDED_FAMILIES),
  ...Object.keys(AUTH_SCOPE_FAMILIES),
  ...FULL_ACCESS_FAMILIES,
]);

/**
 * The sum of the three family buckets BEFORE de-duplication. Equal to
 * `LANGY_CLASSIFIED_FAMILIES.size` iff the buckets are disjoint — the
 * coverage test asserts exactly that, because a family in two buckets is
 * decided by `classifyForLangy`'s branch order, not by anyone's intent.
 */
export const LANGY_FAMILY_BUCKET_TOTAL =
  Object.keys(FULLY_EXCLUDED_FAMILIES).length +
  Object.keys(AUTH_SCOPE_FAMILIES).length +
  FULL_ACCESS_FAMILIES.size;

/** Every family the resource catalogue declares. The universe the partition must cover. */
export const ALL_PERMISSION_FAMILIES: readonly string[] = Object.freeze([
  ...CUSTOM_ROLE_RESOURCES,
]);

/**
 * Every action classified one way or the other, for the coverage test's
 * totality check against the action catalogue.
 */
export const LANGY_CLASSIFIED_ACTIONS: ReadonlySet<string> = new Set([
  ...DELEGABLE_ACTIONS,
  ...Object.keys(ACTION_EXCLUSIONS),
]);

/** Pre-dedup sum of the two action buckets; see LANGY_FAMILY_BUCKET_TOTAL. */
export const LANGY_ACTION_BUCKET_TOTAL =
  DELEGABLE_ACTIONS.size + Object.keys(ACTION_EXCLUSIONS).length;

/** Every action the action catalogue declares. The universe the partition must cover. */
export const ALL_PERMISSION_ACTIONS: readonly string[] = Object.freeze([
  ...AUTHZ_ACTIONS,
]);

/** The read grain. Anything else is a write as far as this policy is concerned. */
const READ_ACTION: string = "view";

/** Derive a stable candidate list, limited to what a project-scoped key can grant. */
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

/** Narrow actions such as attach/detach only apply to their owning resource. */
function grainExclusionReason(
  family: string,
  action: string,
): string | undefined {
  const grainExcluded = GRAIN_EXCLUSIONS[`${family}:${action}`];
  if (grainExcluded) return grainExcluded;
  if (
    (action === "attach" || action === "detach") &&
    family !== "gatewayGuardrails"
  ) {
    return `\`${action}\` polices gateway guardrails and means nothing on \`${family}\``;
  }
  return undefined;
}

/** Refuse unknown resources and actions before considering project-scope reach. */
export function classifyForLangy(
  permission: AuthzPermission | string,
): LangyPermissionVerdict {
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
  // project-scoped binding and organization-exclusive permissions
  // refuses org-exclusive permissions below the org tier. Listing it as a
  // candidate would put dead rows in front of `batchProjectPermissions` on
  // every turn and invite a reader to conclude Langy has access it has
  // never had.
  if (
    permissionGrantTiers(permission as AuthzPermission).every(
      (tier) => tier === "organization",
    )
  ) {
    return {
      disposition: "unreachable",
      reason:
        `\`${family}\` is an organization-tier resource and the Langy ` +
        `session key is project-scoped; no project permission can grant it`,
    };
  }

  return { disposition: "granted" };
}
