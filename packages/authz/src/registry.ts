/**
 * ADR-092 §1 — the permission registry: one authoritative declaration of
 * every resource, the actions it actually supports, and the scopes it can be
 * granted at. Everything else (Permission type, validators, bitset indices,
 * hierarchy rules) is derived from this object.
 *
 * Client-safe by design: no Prisma, no env, no server imports. The frontend
 * (useCan) and the passport/bitset layer both import from here.
 *
 * Stage-A parity note: this vocabulary mirrors the legacy one in
 * `server/api/rbac.ts` exactly — same resources, and per-resource actions
 * reconstructed from what the role bags grant plus what call sites request.
 * The registry deliberately does NOT admit the full Resource × Action cross
 * product the legacy `Permission` type allows: `traces:rotate` is a type
 * error here. Legacy custom-role rows validated against the cross product
 * keep working because the engine expands custom roles leniently (see
 * engine.ts); the strict validator below is for NEW write surfaces only
 * until the stage-E sweep.
 *
 * APPEND-ONLY RULE: bitset indices (stage F passports) are derived from
 * declaration order. Never remove or reorder resources or actions — append
 * new actions at the end of a resource's list, new resources at the end of
 * the object. registry.unit.test.ts pins sentinel indices to enforce this.
 */

import type { ScopeTier } from "./vocabulary";

const READ_ONLY = ["view"] as const;

export const AUTHZ_RESOURCES = {
  organization: {
    actions: ["view", "manage", "delete"],
    scopes: ["organization"],
  },
  project: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  team: {
    actions: ["view", "manage"],
    scopes: ["project", "team", "organization"],
  },
  analytics: {
    // `analytics:create` is requested by the dashboards router even though no
    // bag grants it directly (manage implies it via the hierarchy).
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  cost: {
    actions: READ_ONLY,
    scopes: ["project", "team", "organization"],
  },
  traces: {
    // No `traces:manage` exists anywhere in the legacy vocabulary — traces
    // deliberately have no blanket-manage, so no hierarchy family here.
    actions: ["view", "create", "update", "share"],
    scopes: ["project", "team", "organization"],
  },
  scenarios: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  annotations: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  evaluations: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  datasets: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  triggers: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  workflows: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  experiments: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  prompts: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  secrets: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  playground: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  ops: {
    // Platform-tier only: grantable by exactly one source (ADMIN_EMAILS →
    // platform-ops principal), never by org/team/project bindings.
    actions: ["view", "manage"],
    scopes: ["platform"],
  },
  auditLog: {
    actions: READ_ONLY,
    scopes: ["project", "team", "organization"],
  },
  virtualKeys: {
    actions: [
      "view",
      "create",
      "update",
      "delete",
      "rotate",
      "manage",
      "viewOtherPersonal",
    ],
    scopes: ["project", "team", "organization"],
  },
  gatewayBudgets: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  gatewayProviders: {
    actions: ["view", "update", "manage"],
    scopes: ["project", "team", "organization"],
  },
  routingPolicies: {
    actions: ["view", "manage"],
    scopes: ["project", "team", "organization"],
  },
  gatewayGuardrails: {
    actions: ["view", "attach", "detach", "manage"],
    scopes: ["project", "team", "organization"],
  },
  gatewayLogs: {
    // Deprecated in the legacy vocabulary but still granted by every bag;
    // kept for parity until the stage-E breaking-change pass drops it.
    actions: READ_ONLY,
    scopes: ["project", "team", "organization"],
  },
  gatewayUsage: {
    actions: READ_ONLY,
    scopes: ["project", "team", "organization"],
  },
  gatewayCacheRules: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  governance: {
    actions: ["view", "manage"],
    scopes: ["organization"],
  },
  ingestionSources: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["organization"],
  },
  anomalyRules: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["organization"],
  },
  complianceExport: {
    actions: READ_ONLY,
    scopes: ["organization"],
  },
  activityMonitor: {
    actions: READ_ONLY,
    scopes: ["organization"],
  },
  aiTools: {
    actions: ["view", "manage"],
    scopes: ["organization"],
  },
  webhookEndpoints: {
    // Org-tier only: endpoints carry signing secrets and stream event
    // families out of the platform (see the legacy vocabulary's rationale).
    actions: ["view", "manage"],
    scopes: ["organization"],
  },
  gatewaySpend: {
    actions: ["view", "manage"],
    scopes: ["organization"],
  },
  langy: {
    actions: ["view", "create", "update", "delete", "manage"],
    scopes: ["project", "team", "organization"],
  },
  agentCache: {
    // The per-project cache an agent writes its own run state into. `view`
    // reads an entry, `manage` writes and deletes one.
    actions: ["view", "manage"],
    scopes: ["project", "team", "organization"],
  },
} as const satisfies Record<
  string,
  {
    actions: readonly string[];
    scopes: readonly ("project" | "team" | "organization" | "platform")[];
  }
>;

export type AuthzResource = keyof typeof AUTHZ_RESOURCES;

/** The tiers a permission may be granted at. Every scope tier except
 *  `resource`, which is reached by a grant on the resource itself rather
 *  than by a permission declaration. */
export type AuthzScopeType = Exclude<ScopeTier, "resource">;

/** Only VALID resource:action pairs — `traces:rotate` is a type error. */
export type AuthzPermission = {
  [R in AuthzResource]: `${R}:${(typeof AUTHZ_RESOURCES)[R]["actions"][number]}`;
}[AuthzResource];

/**
 * Stable, append-only enumeration of every valid permission. Declaration
 * order IS the bitset index (stage F passports depend on indices never
 * moving), enforced by sentinel tests.
 */
export const ALL_PERMISSIONS: readonly AuthzPermission[] = Object.entries(
  AUTHZ_RESOURCES,
).flatMap(([resource, def]) =>
  def.actions.map((action) => `${resource}:${action}` as AuthzPermission),
);

const PERMISSION_INDEX: ReadonlyMap<string, number> = new Map(
  ALL_PERMISSIONS.map((permission, index) => [permission, index]),
);

export function isRegistryPermission(value: string): value is AuthzPermission {
  return PERMISSION_INDEX.has(value);
}

/** Bitset index for a permission, or undefined for unknown strings. */
export function permissionIndex(permission: string): number | undefined {
  return PERMISSION_INDEX.get(permission);
}

export function permissionResource(permission: string): string {
  return permission.split(":")[0] ?? "";
}

/**
 * Legacy hierarchy rule, verbatim semantics: `<resource>:manage` satisfies
 * view/create/update/delete/rotate/attach/detach on the same resource.
 * Parity-tested against `hasPermissionWithHierarchy` in rbac.ts.
 */
const MANAGE_IMPLIED_ACTIONS: ReadonlySet<string> = new Set([
  "view",
  "create",
  "update",
  "delete",
  "rotate",
  "attach",
  "detach",
]);

/**
 * True when `requested` is satisfied by the `granted` set, applying the
 * manage-implication rule. `granted` may contain non-registry strings
 * (legacy custom-role rows) — membership is string-based on purpose.
 */
export function permissionSatisfiedBy({
  granted,
  requested,
}: {
  granted: ReadonlySet<string>;
  requested: string;
}): boolean {
  if (granted.has(requested)) return true;
  const separator = requested.lastIndexOf(":");
  if (separator === -1) return false;
  const action = requested.slice(separator + 1);
  if (!MANAGE_IMPLIED_ACTIONS.has(action)) return false;
  return granted.has(`${requested.slice(0, separator)}:manage`);
}

/**
 * ADR-092 §8 — the resource tier: the individually shareable resource kinds.
 *
 * `children` is documentation, not behaviour. Nothing reads it: a child read
 * authorizes at its parent resource's node because the CALLER supplies that
 * ancestry as `scope.parents`, and the walk consults only that. The lists are
 * here so the resource knowledge has one home while stage C5 turns ShareLink
 * into full resource-grant storage.
 */
export const SHAREABLE_RESOURCE_KINDS = {
  trace: {
    children: ["span", "log", "metric", "evaluation", "annotation"],
  },
  thread: {
    children: ["trace"],
  },
} as const satisfies Record<string, { children: readonly string[] }>;

export type ShareableResourceKind = keyof typeof SHAREABLE_RESOURCE_KINDS;

/**
 * ADR-092 §8 — what one share link may confer. A closed allowlist, not the
 * registry's cross product: a link is a bearer capability handed to whoever
 * receives the URL, so the set of things it can ever say has to be small
 * enough to read in one sitting and enumerated in one place.
 *
 * The value is the FULL set of permissions the link grants, because a link
 * that lets someone annotate what they cannot see grants nothing usable —
 * the annotate option therefore carries `traces:view` alongside the
 * annotation verb rather than relying on an implication somewhere else.
 *
 * Representation: ONE stored row carrying ONE permission string (the link's
 * identity IS its token, and two rows would be two tokens, so two grant rows
 * cannot represent one link). The expansion happens at COLLECT, which emits
 * one `ResourceGrant` per entry — and that needs nothing new from the engine,
 * because `matchResourceGrant` already scans a LIST and tests each entry with
 * `permissionSatisfiedBy`. The alternative — one grant whose single
 * permission implies the other — is not expressible: `permissionSatisfiedBy`
 * only knows `<resource>:manage` → sibling actions of the SAME resource, and
 * `annotations:create` and `traces:view` are different resources.
 */
export const SHARE_LINK_PERMISSIONS = {
  /** Read-only: what every link minted before this allowlist existed says. */
  "traces:view": ["traces:view"],
  /** Read plus leave comments on the shared trace. */
  "annotations:create": ["traces:view", "annotations:create"],
} as const satisfies Record<string, readonly string[]>;

/** What a link says when its minter said nothing, and what every row stored
 *  before the column existed means. */
export const DEFAULT_SHARE_LINK_PERMISSION = "traces:view" as const;

export type ShareLinkPermission = keyof typeof SHARE_LINK_PERMISSIONS;

/** Whether a caller-supplied string is one the mint may store. */
export function isShareLinkPermission(
  value: string,
): value is ShareLinkPermission {
  return Object.hasOwn(SHARE_LINK_PERMISSIONS, value);
}

/**
 * Every permission a stored link confers, expanded from the one string on
 * its row. `null` (a row written before the column existed) reads as the
 * default, exactly as it did when the value was a constant.
 *
 * A stored string OUTSIDE the allowlist grants NOTHING. The allowlist is a
 * closed bearer capability, and it has to mean the same thing at both ends:
 * `share.service.ts` refuses to MINT a link for `datasets:manage`, so a row
 * carrying `datasets:manage` — left by an older writer, a hand-run statement
 * or a corrupted write — must not confer it either. Conferring the raw value
 * let a row nobody validated grant a permission the mint would have rejected
 * outright, which is the one direction a bearer token must never fail in.
 */
export function shareLinkPermissionsGranted(
  permission: string | null | undefined,
): readonly string[] {
  const stored = permission ?? DEFAULT_SHARE_LINK_PERMISSION;
  return isShareLinkPermission(stored) ? SHARE_LINK_PERMISSIONS[stored] : [];
}

/**
 * ADR-021 scope fence as registry data: a binding at `scopeType` may grant
 * `permission` only when the permission's resource is grantable at or below
 * that tier. Org-exclusive resources (scopes: ["organization"]) need an
 * ORGANIZATION-scoped binding; platform resources are never grantable by
 * org/team/project bindings at all.
 */
export function bindingScopeCanGrantPermission({
  scopeType,
  permission,
}: {
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
  permission: string;
}): boolean {
  const resource = permissionResource(permission);
  const def = AUTHZ_RESOURCES[resource as AuthzResource];
  // Unknown resources (legacy custom-role strings outside the registry) are
  // treated as non-exclusive, matching the legacy fence which only checks a
  // fixed org-exclusive set.
  if (!def) return true;
  const scopes: readonly AuthzScopeType[] = def.scopes;
  // LEGACY-QUIRK(C): the legacy fence only knows the org-exclusive set, so a
  // custom role CAN today grant `ops:*` from any binding. The platform tier
  // becomes a real fence in stage C when platform-ops turns into a principal.
  if (scopes.includes("platform")) return true;
  if (scopeType === "ORGANIZATION") return true;
  return scopes.includes("team") || scopes.includes("project");
}
