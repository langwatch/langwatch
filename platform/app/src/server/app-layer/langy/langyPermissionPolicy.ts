import {
  Actions,
  isOrgExclusivePermission,
  type Permission,
  Resources,
} from "~/server/api/rbac";

/**
 * WHY THIS FILE EXISTS
 *
 * `LANGY_CANDIDATE_PERMISSIONS` is an enumeration, and an enumeration cannot
 * tell you why something is absent. `experiments:view` was missing because
 * nobody thought of it; `cost:view` was missing because someone decided
 * against it. In the list those two look identical — a line that isn't there.
 *
 * That ambiguity is not a documentation problem, it is the defect itself, and
 * it produced the same production 403 three times: `project:view`
 * (`langwatch agent list` refused), `scenarios:create` against a route asking
 * `scenarios:manage`, and `experiments:view` (`langwatch experiment list`
 * refused). Each was found by a user, diagnosed by hand, and fixed by adding a
 * line and a comment explaining the oversight.
 *
 * So this file states the RULE the enumeration was always an expression of.
 * `classifyForLangy` decides, for any permission in the system, whether Langy
 * should be able to hold it — and `langy-permission-coverage` reconciles that
 * verdict against two independent facts: what the route registry actually
 * demands, and what the candidate list actually grants.
 *
 * THE DEFAULT INVERTED (owner decision, 2026-08-21)
 *
 * This file used to be an ALLOWLIST of eleven families, and it argued the
 * inversion was unsafe: with a blocklist, "a resource family invented next
 * quarter is delegable the moment it exists, before anyone has assessed it."
 * That argument was right about new families and wrong about existing ones —
 * it was being used to justify keeping Langy refused on twenty-four families
 * somebody HAD assessed, which is how an assistant ends up unable to do the
 * job it was built for.
 *
 * The owner's rule is now: Langy may do everything except manage the auth
 * scope. Reading the auth scope is fine; secrets are not readable at all.
 *
 * The safety argument the old allowlist was carrying is carried better, and
 * has been all along, by `mintLangySessionApiKey`: the session key is the
 * INTERSECTION of this policy with the permissions the requesting human
 * actually holds. Langy cannot exceed the person who asked, whatever this file
 * says. Widening the policy widens the CEILING, not anyone's actual access —
 * a user who cannot delete a dataset by hand still cannot ask Langy to.
 *
 * What the old file was genuinely protecting — that a family invented later is
 * not silently swept in — is kept, and kept without keeping the refusals: every
 * family in `Resources` is classified into exactly one of the three buckets
 * below, and `langy-permission-coverage` FAILS when one is missing. A new
 * family is therefore refused until a human classifies it (fail-closed, as
 * before) but it cannot sit quietly refused for a quarter, because CI goes red
 * the moment it is added. The decision is forced either way; only the default
 * for the thirty-five families that exist today has changed.
 */

/** Verdict for a single permission. `excluded` always carries its reason. */
export type LangyPermissionVerdict =
  | { readonly disposition: "granted" }
  | { readonly disposition: "excluded"; readonly reason: string };

/**
 * Actions Langy may never hold, on any family, whatever that family's bucket.
 *
 * These are the axes the user-permission ceiling does NOT contain, which is the
 * only reason anything is listed here at all. `delete` and `manage` are
 * deliberately absent: they are destructive, but they destroy only what the
 * requesting human could already destroy by hand, so the ceiling bounds them.
 * The three below are different in kind:
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
 * Why each non-delegable action stays out of reach. Keyed by action so a new
 * one added to `Actions` in rbac.ts surfaces here as an explicit decision.
 *
 * An action absent from BOTH this map and `DELEGABLE_ACTIONS` is refused (the
 * generic branch in `classifyForLangy`) and fails the coverage test's totality
 * check — the same fail-closed-but-noisy treatment new families get. The
 * allowlist is what makes that fail-closed; do not reduce this to "everything
 * not excluded is allowed", or an action invented next quarter is delegated
 * the moment it exists.
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
  viewOtherPersonal:
    "reads other members' personal keys, an admin audit power over the auth scope",
};

/**
 * Families where not even a read is delegable.
 *
 * Exactly one, and it is the owner's stated carve-out: reading a stored
 * credential IS obtaining it. There is no weaker grain here — `secrets:view`
 * is the whole compromise, so the read/manage split the rest of this file
 * turns on has nothing to bite on.
 */
const FULLY_EXCLUDED_FAMILIES: Record<string, string> = {
  secrets: "reading a stored credential is obtaining it; there is no safe read",
};

/**
 * The AUTH SCOPE: readable, never writable.
 *
 * "Auth scope" is not a family name in `Resources`, so it is enumerated here.
 * A family belongs on this list when writing it changes WHO CAN DO WHAT, or
 * changes a credential — as opposed to changing the tenant's data, which is
 * what everything else in the system does. Langy explaining your org's roles
 * is useful and safe; Langy editing them is the one thing the owner asked to
 * keep out of its hands.
 *
 * Note this is stricter than `:manage` alone: the whole write surface is
 * withheld, not just the manage grain. `:manage` implies `:delete` AND
 * `:rotate` through the hierarchy (`rbac.ts:545-555`), so a family whose
 * writes are credential operations cannot be half-granted — handing over
 * `:update` on `gatewayProviders` to withhold `:manage` would be a distinction
 * the route layer is under no obligation to respect.
 *
 * `virtualKeys` is deliberately NOT here (owner decision, 2026-08-21): virtual
 * keys are gateway credentials, but issuing them is the day job of anyone
 * driving the gateway, and the ceiling bounds it — Langy can only mint keys
 * for a caller who could mint them by hand. `:rotate` stays excluded via
 * `ACTION_EXCLUSIONS` (though note `:manage` implies `:rotate` through the
 * hierarchy, so a manage-holding caller's Langy can reach rotation).
 */
const AUTH_SCOPE_FAMILIES: Record<string, string> = {
  organization: "org membership and role administration IS the auth scope",
  team: "team membership administration decides who holds what",
  project:
    "`project:update` stores model-provider credentials and `project:manage` " +
    "regenerates the project's own API key",
  gatewayProviders: "stores provider credentials",
  webhookEndpoints:
    "endpoints carry signing secrets and stream org-wide event families out " +
    "of the platform (rbac.ts:112-117)",
  // Not credentials, but the same shape of argument: an assistant that can
  // edit the record of what it did is an assistant whose record proves
  // nothing. Read it, explain it, never write it.
  auditLog: "the record of who did what, including Langy's own actions",
  // Bulk egress of an org's data — the same disclosure axis as `share` above,
  // at a family granularity instead of an action one.
  complianceExport: "bulk export of an org's data is egress, not access",
};

/**
 * Everything else: full CRUD, including `delete` and `manage`.
 *
 * Enumerated rather than derived by subtraction, so that a family added to
 * `Resources` lands in NO bucket and `langy-permission-coverage` fails. That
 * failure is the entire remaining safety property of this file — see the
 * header. Do not replace this with `Object.values(Resources).filter(...)`;
 * doing so is precisely the fail-open the old allowlist was built to prevent.
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
  "ingestionSources",
  "langy",
  "ops",
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
 * Every family in the system, in exactly one bucket. Exported so the coverage
 * test can assert the partition is total against `Resources` — the check that
 * makes a newly-invented family fail CI instead of sitting silently refused.
 */
export const LANGY_CLASSIFIED_FAMILIES: ReadonlySet<string> = new Set([
  ...Object.keys(FULLY_EXCLUDED_FAMILIES),
  ...Object.keys(AUTH_SCOPE_FAMILIES),
  ...FULL_ACCESS_FAMILIES,
]);

/** Every family `Resources` declares. The universe the partition must cover. */
export const ALL_PERMISSION_FAMILIES: readonly string[] = Object.freeze(
  Object.values(Resources),
);

/**
 * Every action classified one way or the other, for the coverage test's
 * totality check against `Actions`.
 */
export const LANGY_CLASSIFIED_ACTIONS: ReadonlySet<string> = new Set([
  ...DELEGABLE_ACTIONS,
  ...Object.keys(ACTION_EXCLUSIONS),
]);

/** Every action `Actions` declares. The universe the partition must cover. */
export const ALL_PERMISSION_ACTIONS: readonly string[] = Object.freeze(
  Object.values(Actions),
);

/** The read grain. Anything else is a write as far as this policy is concerned. */
const READ_ACTION = "view";

/**
 * The candidate list, DERIVED from the rule rather than hand-maintained
 * alongside it.
 *
 * This file used to insist the rule "deliberately does NOT generate the list",
 * on the grounds that generating it would grant a brand-new family the moment
 * it appeared. That hazard is now closed at the other end: the family and
 * action partitions are total and CI-enforced, so a new family or action
 * reaches this function only after a human has classified it. With the hazard
 * gone, the cost of hand-maintenance is all that is left — and that cost was
 * three production 403s, each one a line nobody remembered to add. Deriving
 * removes that entire class of defect rather than continuing to catch it.
 *
 * PROJECT SCOPE IS THE SECOND FILTER, and it is not cosmetic. The session key
 * is minted with a single PROJECT-scoped binding (`mintLangySessionApiKey`),
 * and `bindingScopeCanGrant` (rbac.ts:190-196) refuses org-exclusive
 * permissions on any binding below the org tier. Listing `governance:manage`
 * here would therefore not widen Langy by one capability — it would just put
 * nine families of dead entries in front of `batchProjectPermissions` on every
 * turn and invite the next reader to conclude Langy has access it has never
 * had. The classification above still records the honest verdict for those
 * families; this list records what a project-scoped key can actually carry.
 *
 * Deterministic order (families as `Resources` declares them, actions as
 * `Actions` does) so the minted key's permission array is stable across turns.
 */
export function langyCandidatePermissions(): Permission[] {
  const candidates: Permission[] = [];
  for (const family of ALL_PERMISSION_FAMILIES) {
    for (const action of ALL_PERMISSION_ACTIONS) {
      const permission = `${family}:${action}` as Permission;
      if (isCandidateGrain(family, action, permission)) {
        candidates.push(permission);
      }
    }
  }
  return candidates;
}

/** The per-grain filter `langyCandidatePermissions` runs over the cross-product. */
function isCandidateGrain(
  family: string,
  action: string,
  permission: Permission,
): boolean {
  if (classifyForLangy(permission).disposition !== "granted") return false;
  // `Permission` is a template literal type, so the cross-product
  // TYPECHECKS whether or not the grain means anything — `analytics:attach`
  // is a well-typed string describing nothing. Such an entry is inert (no
  // role grants it, so the intersection drops it) but it is still 46 dead
  // rows for `batchProjectPermissions` to carry and one more way for a
  // reader to over-read what Langy holds. `attach`/`detach` are the only
  // actions narrow enough to pin precisely: they police guardrails
  // (rbac.ts:34-40) and mean nothing anywhere else.
  if (
    (action === Actions.ATTACH || action === Actions.DETACH) &&
    family !== Resources.GATEWAY_GUARDRAILS
  ) {
    return false;
  }
  // Inert at project scope — see above.
  return !isOrgExclusivePermission(permission);
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
 * Should Langy be able to hold this permission on the caller's behalf?
 *
 * Fail-closed on anything unrecognised, and "anything" is meant literally: an
 * excluded action, an unclassified family, and a string that is not
 * `resource:action` at all each come back `excluded` with a reason. The rule
 * can therefore only ever be too strict, and being too strict shows up as a
 * reviewer having to classify a family — never as a silently over-broad
 * credential.
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
        `\`${action}\` has not been classified for Langy. Add it to ` +
          `DELEGABLE_ACTIONS or record why it is withheld in ACTION_EXCLUSIONS`,
    };
  }

  const fullyExcluded = FULLY_EXCLUDED_FAMILIES[family];
  if (fullyExcluded) return { disposition: "excluded", reason: fullyExcluded };

  const authScope = AUTH_SCOPE_FAMILIES[family];
  if (authScope) {
    if (action === READ_ACTION) return { disposition: "granted" };
    return {
      disposition: "excluded",
      reason: `${authScope} — Langy may read the auth scope, never write it`,
    };
  }

  if (!FULL_ACCESS_FAMILIES.has(family)) {
    return {
      disposition: "excluded",
      reason:
        `\`${family}\` has not been classified for Langy. Add it to ` +
        `FULL_ACCESS_FAMILIES if Langy may use it, AUTH_SCOPE_FAMILIES if it ` +
        `decides who can do what or holds a credential, or ` +
        `FULLY_EXCLUDED_FAMILIES if not even a read is safe`,
    };
  }

  return { disposition: "granted" };
}
