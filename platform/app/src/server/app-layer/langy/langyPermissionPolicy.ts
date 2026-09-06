import { isOrgExclusivePermission, type Permission } from "~/server/api/rbac";
// #7358 moved the vocabulary consts out of rbac.ts into their own module.
import { Actions, Resources } from "~/utils/rbacVocabulary";

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

/**
 * The actions Langy may hold, subject to the family buckets below.
 *
 * `delete` and `manage` are deliberately present: they are destructive, but
 * they destroy only what the requesting human could already destroy by hand,
 * so the ceiling bounds them. `attach`/`detach` are here because they only
 * mean anything on `gatewayGuardrails` (rbac.ts:34-40), and re-policing a
 * gateway key is the day job of anyone driving the gateway — the same
 * ceiling argument as `virtualKeys` below: Langy can only re-police keys for
 * a caller who could do it by hand.
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
 * Actions Langy may never hold, on any family, whatever that family's bucket.
 * These are the axes the user-permission ceiling does NOT contain, which is
 * the only reason anything is listed here at all. Keyed by action so a new
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
 * `secrets` is the owner's stated carve-out: reading a stored credential IS
 * obtaining it. There is no weaker grain — `secrets:view` is the whole
 * compromise, so the read/manage split the rest of this file turns on has
 * nothing to bite on.
 *
 * `agentCache` is the same carve-out one step removed. An agent under test
 * writes what it produced during a run there, and what it produces is normally
 * the session it logged in with. The entry is encrypted at rest and a read
 * hands back the plaintext, so a read of the cache is a read of whatever
 * credential the agent put in it. Every route in the family asks for
 * `agentCache:manage`, so there is no weaker grain to hold either.
 *
 * `langy` and `ops` are not part of the "everything" the owner widened,
 * because neither is tenant data:
 *
 * - `langy:create` is the ceiling gate on `POST /api/langy` itself
 *   (langy-api.ts). A session key that carries it can start Langy turns, and
 *   each turn mints another key that can do the same — the intersection
 *   ceiling bounds AUTHORITY, not AMPLIFICATION, so nothing else in the
 *   system stops that recursion. And `langy:delete` archives Langy's own
 *   conversations, which is the `auditLog` argument over again: an assistant
 *   that can edit the record of what it did is an assistant whose record
 *   proves nothing. Langy's conversations are managed by the app, not by its
 *   tools.
 * - `ops` gates LangWatch-staff platform surgery (feature flags, ClickHouse
 *   TTL, blob deletion — routers/ops.ts). It is unreachable through an API
 *   key today only because no REST route demands it; that is a transport
 *   coincidence, not a policy, so the policy says no.
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
 * for a caller who could mint them by hand. `:rotate` is excluded via
 * `ACTION_EXCLUSIONS`, and because `:manage` implies `:rotate` through the
 * hierarchy (`hasPermissionWithHierarchy`, rbac.ts:545-555), the ONLY way to
 * make that exclusion true of the credential rather than merely of this
 * file's text is to withhold `virtualKeys:manage` too — which
 * `GRAIN_EXCLUSIONS` below does. The cost is real and accepted: Langy cannot
 * create ORG- or TEAM-scoped virtual keys or widen a key's scopes (the two
 * REST surfaces demanding `virtualKeys:manage`); project-scoped mint, update,
 * and delete all remain.
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
 *
 * SIX OF THESE ARE INERT AT PROJECT SCOPE and their presence here is a
 * classification, not an access grant: `governance`, `anomalyRules`,
 * `aiTools`, `activityMonitor`, `gatewaySpend`, and `ingestionSources` are in
 * `ORG_EXCLUSIVE_RESOURCES` (rbac.ts), so `langyCandidatePermissions` drops
 * every grain of them and the minted key holds nothing. The org-exclusive
 * filter was built for ADR-021 scope escalation, not for Langy — several of
 * these families were previously excluded here with their own reasons
 * (`activityMonitor` was "cross-principal activity surveillance"). If the
 * session key ever gains an ORGANIZATION-scoped binding, these six widen
 * instantly from a change in a different file: RE-DECIDE each of them
 * explicitly before making that change. The coverage test pins the exact
 * inventory so the tripwire at least has a bell on it.
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
 * (rbac.ts:545-555): granting it would make the `rotate` exclusion above a
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
 * test can assert the partition is total against `Resources` — the check that
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

/** Pre-dedup sum of the two action buckets; see LANGY_FAMILY_BUCKET_TOTAL. */
export const LANGY_ACTION_BUCKET_TOTAL =
  DELEGABLE_ACTIONS.size + Object.keys(ACTION_EXCLUSIONS).length;

/** Every action `Actions` declares. The universe the partition must cover. */
export const ALL_PERMISSION_ACTIONS: readonly string[] = Object.freeze(
  Object.values(Actions),
);

/** The read grain. Anything else is a write as far as this policy is concerned. */
const READ_ACTION: string = Actions.VIEW;

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
 * The grain-level exclusions `classifyForLangy` consults after the action and
 * fully-excluded-family checks: single withheld grains (`GRAIN_EXCLUSIONS`)
 * and actions that only mean anything on one family. `Permission` is a
 * template literal type, so the cross-product TYPECHECKS whether or not the
 * grain means anything — `analytics:attach` is a well-typed string describing
 * nothing. `attach`/`detach` are the only actions narrow enough to pin
 * precisely: they police guardrails (rbac.ts:34-40) and mean nothing
 * anywhere else.
 */
function grainExclusionReason(
  family: string,
  action: string,
): string | undefined {
  const grainExcluded = GRAIN_EXCLUSIONS[`${family}:${action}`];
  if (grainExcluded) return grainExcluded;
  if (
    (action === Actions.ATTACH || action === Actions.DETACH) &&
    family !== (Resources.GATEWAY_GUARDRAILS as string)
  ) {
    return `\`${action}\` polices gateway guardrails and means nothing on \`${family}\``;
  }
  return undefined;
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
  // PROJECT-scoped binding and `bindingScopeCanGrant` (rbac.ts:190-196)
  // refuses org-exclusive permissions below the org tier. Listing it as a
  // candidate would put dead rows in front of `batchProjectPermissions` on
  // every turn and invite a reader to conclude Langy has access it has
  // never had.
  if (isOrgExclusivePermission(permission as Permission)) {
    return {
      disposition: "unreachable",
      reason:
        `\`${family}\` is an organization-tier resource and the Langy ` +
        `session key is project-scoped; no project permission can grant it`,
    };
  }

  return { disposition: "granted" };
}
