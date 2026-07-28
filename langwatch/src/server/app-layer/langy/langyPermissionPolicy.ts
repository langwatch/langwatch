import type { Permission } from "~/server/api/rbac";

/**
 * WHY THIS FILE EXISTS
 *
 * `LANGY_CANDIDATE_PERMISSIONS` is an enumeration, and an enumeration cannot
 * tell you why something is absent. `experiments:view` was missing because
 * nobody thought of it; `cost:view` is missing because someone decided against
 * it. In the list those two look identical — a line that isn't there.
 *
 * That ambiguity is not a documentation problem, it is the defect itself, and
 * it has now produced the same production 403 three times: `project:view`
 * (`langwatch agent list` refused), `scenarios:create` against a route asking
 * `scenarios:manage`, and `experiments:view` (`langwatch experiment list`
 * refused). Each was found by a user, diagnosed by hand, and fixed by adding a
 * line and a comment explaining the oversight.
 *
 * So this file states the RULE the enumeration was always an expression of.
 * `classifyForLangy` decides, for any permission in the system, whether Langy
 * should be able to hold it — and `langy-permission-coverage` reconciles that
 * verdict against two independent facts: what the route registry actually
 * demands, and what the candidate list actually grants. A permission that the
 * rule says Langy needs but the list omits now fails CI with the route that
 * demands it, instead of reaching a user as a 403.
 *
 * The rule deliberately does NOT generate the list. Generating it would mean a
 * brand-new resource family is granted the moment it appears, which is the
 * wrong default for a credential; a human still writes the line. The rule's job
 * is to make sure nobody can forget to.
 */

/** Verdict for a single permission. `excluded` always carries its reason. */
export type LangyPermissionVerdict =
  | { readonly disposition: "granted" }
  | { readonly disposition: "excluded"; readonly reason: string };

/**
 * Actions Langy may ever hold, on any family. Everything else is refused by
 * `classifyForLangy` before the family is even considered, which is what keeps
 * the rule fail-closed as new actions are added to `Actions` in rbac.ts:
 * an action nobody has classified is refused, never granted by default.
 */
const DELEGABLE_ACTIONS = new Set(["view", "create", "update"]);

/**
 * Why each non-delegable action stays out of Langy's reach. Keyed by action so
 * a new one added to `Actions` surfaces here as an explicit decision rather
 * than being silently swept up by a catch-all.
 */
const ACTION_EXCLUSIONS: Record<string, string> = {
  manage: "implies delete via the rbac hierarchy",
  delete: "destroys a user's data",
  share: "creates PUBLIC links to a user's traces",
  rotate: "rotates a live credential",
  attach: "changes which guardrails police a key",
  detach: "changes which guardrails police a key",
  viewOtherPersonal: "reads other members' personal keys, an admin audit power",
};

/**
 * Families Langy has no business touching at ANY grain, with the reason each
 * is off-limits. Absence from this map is not permission — a family must also
 * survive the action rule above.
 */
const OFF_LIMITS_FAMILIES: Record<string, string> = {
  secrets: "reads the project's stored credentials",
  organization: "org administration, far outside an assistant's remit",
  team: "team membership administration",
  auditLog: "the record of who did what, including Langy's own actions",
  cost: "spend data reaches Langy through gateway telemetry, not through the key",
  ops: "platform operations, not a tenant-facing capability",
  playground: "an interactive UI surface with no agent equivalent",
  langy: "Langy's own conversations are managed by the app, not by its tools",
  aiTools: "the org's tool catalog is an admin surface",
  virtualKeys: "issues and reads live gateway credentials",
  gatewayBudgets: "controls spend limits",
  gatewayProviders: "stores provider credentials",
  routingPolicies: "controls where a tenant's traffic is sent",
  gatewayGuardrails: "controls the safety policing of traffic",
  gatewayLogs: "deprecated gateway audit surface",
  gatewayUsage: "gateway spend reporting",
  gatewayCacheRules: "gateway cache configuration",
  governance: "org-tier AI governance administration",
  ingestionSources: "org-tier ingestion administration",
  anomalyRules: "org-tier detection rules",
  complianceExport: "bulk export of an org's data",
  activityMonitor: "cross-principal activity surveillance",
};

/**
 * Families Langy may READ but never write, with the reason the write is
 * withheld. These are the deliberate asymmetries — the ones most likely to be
 * mistaken for oversights, which is exactly why they are written down.
 */
const READ_ONLY_FAMILIES: Record<string, string> = {
  project:
    "project writes are the credential surface — `project:update` stores " +
    "model-provider keys and `project:manage` regenerates the project's API key",
  triggers:
    "a trigger is a standing instruction that keeps acting on its own schedule, " +
    "and outlives the session key that authored it",
  experiments:
    "the family's only write is `:manage`, which is the delete; RUNNING an " +
    "experiment is gated by the evaluations family instead",
};

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
 * Should Langy be able to hold this permission on the caller's behalf?
 *
 * Fail-closed at every step: an unrecognised action and an unrecognised family
 * shape both come back `excluded`, so the rule can only ever be too strict —
 * and being too strict shows up as a CI failure naming the route, never as a
 * silently over-broad credential.
 */
export function classifyForLangy(
  permission: Permission | string,
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
        `\`${action}\` is not an action Langy may ever be delegated`,
    };
  }

  const offLimits = OFF_LIMITS_FAMILIES[family];
  if (offLimits) return { disposition: "excluded", reason: offLimits };

  const readOnly = READ_ONLY_FAMILIES[family];
  if (readOnly && action !== "view") {
    return { disposition: "excluded", reason: readOnly };
  }

  return { disposition: "granted" };
}
