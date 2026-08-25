import {
  AUTHZ_RESOURCES,
  type AuthzPermission,
  type AuthzResource,
  bindingScopeCanGrantPermission,
  builtinRolePermissions,
  isRegistryPermission,
} from "@langwatch/authz";
import {
  getValidActionsForResource,
  orderedResources,
} from "~/utils/permissionsConfig";
import type { Action, Resource } from "~/utils/rbacVocabulary";

/**
 * What a permission means, in the words of somebody who has never read our
 * code.
 *
 * A permission is written `traces:view`, and that string is the vocabulary the
 * engine grants from, so the screens keep showing it. But an administrator
 * deciding whether to hand somebody `secrets:manage` is not asking what the
 * string is — they are asking what the person will be able to do on Monday.
 * Both answers belong on screen: the sentence teaches the token, and the token
 * is what they will see again in the audit log.
 *
 * The lists here are keyed off the registry's own resource table, so a
 * resource added to `@langwatch/authz` fails the typecheck here until somebody
 * writes the words for it. That is deliberate: a permission the picker offers
 * with no explanation is a permission granted by guess.
 */

/** The named parts of the product a permission can be about. */
export const PERMISSION_AREAS = [
  "Data and analysis",
  "Building",
  "AI gateway",
  "Governance",
  "Organization",
  "Platform operations",
] as const;

export type PermissionArea = (typeof PERMISSION_AREAS)[number];

interface ResourceCopy {
  /** What a customer calls it. */
  label: string;
  /** One sentence: what the thing is, never how it works. */
  blurb: string;
  area: PermissionArea;
}

const RESOURCE_COPY = {
  organization: {
    label: "Organization",
    blurb: "The organization itself, its plan and its settings.",
    area: "Organization",
  },
  project: {
    label: "Projects",
    blurb: "The projects a team owns.",
    area: "Organization",
  },
  team: {
    label: "Teams",
    blurb: "A team and who is on it.",
    area: "Organization",
  },
  analytics: {
    label: "Analytics",
    blurb: "Dashboards and the charts on them.",
    area: "Data and analysis",
  },
  cost: {
    label: "Cost",
    blurb: "What models and requests cost.",
    area: "Data and analysis",
  },
  traces: {
    label: "Traces",
    blurb: "The recorded runs of your application.",
    area: "Data and analysis",
  },
  scenarios: {
    label: "Simulations",
    blurb: "Scripted conversations that check how an agent behaves.",
    area: "Building",
  },
  annotations: {
    label: "Annotations",
    blurb: "The notes and scores people leave on a run.",
    area: "Data and analysis",
  },
  evaluations: {
    label: "Evaluations",
    blurb: "Evaluators and the results they produce.",
    area: "Building",
  },
  datasets: {
    label: "Datasets",
    blurb: "The example data used for evaluation and optimization.",
    area: "Building",
  },
  triggers: {
    label: "Triggers",
    blurb: "Rules that act when something matches.",
    area: "Building",
  },
  workflows: {
    label: "Workflows",
    blurb: "The optimization studio and what it builds.",
    area: "Building",
  },
  experiments: {
    label: "Experiments",
    blurb: "Runs that compare one version against another.",
    area: "Building",
  },
  prompts: {
    label: "Prompts",
    blurb: "The prompt library and its versions.",
    area: "Building",
  },
  secrets: {
    label: "Secrets",
    blurb: "The credentials a project stores.",
    area: "Organization",
  },
  playground: {
    label: "Playground",
    blurb: "The place to try a model by hand.",
    area: "Building",
  },
  ops: {
    label: "Platform operations",
    blurb: "The controls that run this installation.",
    area: "Platform operations",
  },
  auditLog: {
    label: "Audit log",
    blurb: "The record of what was done, and by whom.",
    area: "Governance",
  },
  virtualKeys: {
    label: "Virtual keys",
    blurb: "The keys that route requests through the gateway.",
    area: "AI gateway",
  },
  gatewayBudgets: {
    label: "Budgets",
    blurb: "Spending limits on the gateway.",
    area: "AI gateway",
  },
  gatewayProviders: {
    label: "Model providers",
    blurb: "The providers the gateway sends requests to.",
    area: "AI gateway",
  },
  routingPolicies: {
    label: "Routing policies",
    blurb: "Which provider handles a request, and what happens when one fails.",
    area: "AI gateway",
  },
  gatewayGuardrails: {
    label: "Guardrails",
    blurb: "The checks a request passes before it leaves.",
    area: "AI gateway",
  },
  gatewayLogs: {
    label: "Gateway logs",
    blurb: "The record of requests the gateway handled.",
    area: "AI gateway",
  },
  gatewayUsage: {
    label: "Gateway usage",
    blurb: "How much the gateway is being used.",
    area: "AI gateway",
  },
  gatewayCacheRules: {
    label: "Cache rules",
    blurb: "Which answers the gateway is allowed to reuse.",
    area: "AI gateway",
  },
  governance: {
    label: "Governance",
    blurb: "The policies your organization holds its use of models to.",
    area: "Governance",
  },
  ingestionSources: {
    label: "Ingestion sources",
    blurb: "Where governance data is collected from.",
    area: "Governance",
  },
  anomalyRules: {
    label: "Anomaly rules",
    blurb: "What counts as unusual, and what happens when it is found.",
    area: "Governance",
  },
  complianceExport: {
    label: "Compliance export",
    blurb: "The security event feed, in the format a security team reads.",
    area: "Governance",
  },
  activityMonitor: {
    label: "Activity monitor",
    blurb: "Who is using models, and how.",
    area: "Governance",
  },
  aiTools: {
    label: "Tool catalog",
    blurb: "The tools your organization offers its people.",
    area: "Organization",
  },
  webhookEndpoints: {
    label: "Webhooks",
    blurb: "Where events are sent outside the platform.",
    area: "Organization",
  },
  gatewaySpend: {
    label: "Spend reporting",
    blurb: "The metered record of what was spent, and by whom.",
    area: "AI gateway",
  },
  langy: {
    label: "Assistant",
    blurb: "The in-product assistant and its conversations.",
    area: "Building",
  },
  sso: {
    label: "Single sign-on and directory",
    blurb: "How people sign in, and the directory that provisions them.",
    area: "Organization",
  },
} as const satisfies Record<AuthzResource, ResourceCopy>;

const UNKNOWN_RESOURCE: ResourceCopy = {
  label: "Other",
  blurb: "A permission this version of the product no longer offers.",
  area: "Organization",
};

export function resourceCopy(resource: string): ResourceCopy {
  return RESOURCE_COPY[resource as AuthzResource] ?? UNKNOWN_RESOURCE;
}

interface ActionCopy {
  label: string;
  blurb: string;
}

const ACTION_COPY = {
  view: { label: "View", blurb: "Read them." },
  create: { label: "Create", blurb: "Add new ones." },
  update: { label: "Change", blurb: "Edit the ones that already exist." },
  delete: { label: "Delete", blurb: "Remove them for good." },
  manage: {
    label: "Full access",
    blurb: "View, create, change and delete.",
  },
  share: {
    label: "Share",
    blurb: "Create a link somebody outside the organization can open.",
  },
  rotate: {
    label: "Rotate",
    blurb: "Issue a replacement and retire the old one.",
  },
  attach: { label: "Attach", blurb: "Put one in place." },
  detach: { label: "Detach", blurb: "Take one out of place." },
  viewOtherPersonal: {
    label: "View everyone's personal keys",
    blurb: "See the personal keys other people own.",
  },
} as const satisfies Record<Action, ActionCopy>;

const UNKNOWN_ACTION: ActionCopy = { label: "Other", blurb: "" };

export function actionCopy(action: string): ActionCopy {
  return ACTION_COPY[action as Action] ?? UNKNOWN_ACTION;
}

/** `traces:view` split for display: the thing, then what you may do to it. */
export function splitPermission(permission: string): {
  resource: string;
  action: string;
} {
  const [resource = "", action = ""] = permission.split(":");
  return { resource, action };
}

/** "View traces", "Full access to datasets". The sentence form of a token. */
export function permissionSentence(permission: string): string {
  const { resource, action } = splitPermission(permission);
  const thing = resourceCopy(resource).label.toLowerCase();
  if (action === "manage") return `Full access to ${thing}`;
  if (action === "viewOtherPersonal") {
    return `See the personal keys other people own`;
  }
  return `${actionCopy(action).label} ${thing}`;
}

/**
 * The actions the roles surface offers on a resource, in reading order.
 *
 * The offered set is `permissionsConfig`'s, not the registry's whole action
 * list: the registry admits every action the engine can evaluate, and the
 * roles surface has always offered a narrower one. Widening it here would
 * quietly hand custom roles capabilities nobody chose to delegate.
 */
const ACTION_ORDER: readonly Action[] = [
  "view",
  "share",
  "create",
  "update",
  "delete",
  "rotate",
  "attach",
  "detach",
  "viewOtherPersonal",
  "manage",
];

export function offeredActions(resource: Resource): Action[] {
  const valid = getValidActionsForResource(resource).filter((action) =>
    isRegistryPermission(`${resource}:${action}`),
  );
  return ACTION_ORDER.filter((action) => valid.includes(action));
}

export function offeredPermissions(resource: Resource): AuthzPermission[] {
  return offeredActions(resource).map(
    (action) => `${resource}:${action}` as AuthzPermission,
  );
}

/** Every resource the roles surface offers, grouped into its named area. */
export function offeredAreas(): {
  area: PermissionArea;
  resources: Resource[];
}[] {
  return PERMISSION_AREAS.map((area) => ({
    area,
    resources: orderedResources.filter(
      (resource) => resourceCopy(resource).area === area,
    ),
  })).filter((group) => group.resources.length > 0);
}

/**
 * How much of a resource a role holds.
 *
 * Most roles are built one resource at a time — "read the traces, do anything
 * with the datasets, nothing else" — so the picker offers those three answers
 * and keeps the individual actions behind a disclosure for the role that
 * genuinely needs "create but never delete".
 */
export type AccessLevel = "none" | "read" | "full" | "custom";

export function fullLevelPermissions(resource: Resource): AuthzPermission[] {
  const actions = offeredActions(resource);
  const permissions = offeredPermissions(resource);
  return actions.includes("manage")
    ? [`${resource}:manage` as AuthzPermission]
    : permissions;
}

export function readLevelPermissions(resource: Resource): AuthzPermission[] {
  const view = `${resource}:view`;
  return isRegistryPermission(view) && offeredActions(resource).includes("view")
    ? [view]
    : [];
}

function sameSet(a: readonly string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const left = new Set(a);
  return b.every((value) => left.has(value));
}

export function levelOf({
  resource,
  selected,
}: {
  resource: Resource;
  selected: readonly string[];
}): AccessLevel {
  const held = offeredPermissions(resource).filter((permission) =>
    selected.includes(permission),
  );
  if (held.length === 0) return "none";
  if (sameSet(held, fullLevelPermissions(resource))) return "full";
  if (sameSet(held, readLevelPermissions(resource))) return "read";
  return "custom";
}

/** A resource whose only offered action is `view` is a switch, not a ladder. */
export function isReadOnlyResource(resource: Resource): boolean {
  const actions = offeredActions(resource);
  return actions.length === 1 && actions[0] === "view";
}

/**
 * Permission dependencies, unchanged from the picker they came from: full
 * access covers every other action on its resource, and changing something
 * you cannot see is not a coherent grant.
 */
export function withDependencies({
  resource,
  permission,
  selected,
}: {
  resource: Resource;
  permission: AuthzPermission;
  selected: readonly AuthzPermission[];
}): AuthzPermission[] {
  const { action } = splitPermission(permission);
  if (action === "manage") {
    return unique([...selected, ...offeredPermissions(resource)]);
  }
  if (action === "create" || action === "update" || action === "delete") {
    return unique([...selected, permission, ...readLevelPermissions(resource)]);
  }
  return unique([...selected, permission]);
}

export function withoutDependents({
  resource,
  permission,
  selected,
}: {
  resource: Resource;
  permission: AuthzPermission;
  selected: readonly AuthzPermission[];
}): AuthzPermission[] {
  const { action } = splitPermission(permission);
  const dropped =
    action === "manage"
      ? offeredPermissions(resource)
      : action === "view"
        ? offeredPermissions(resource).filter((candidate) => {
            const dependent = splitPermission(candidate).action;
            return (
              candidate === permission ||
              dependent === "create" ||
              dependent === "update" ||
              dependent === "delete"
            );
          })
        : [permission];
  const remove = new Set<string>(dropped);
  return selected.filter((candidate) => !remove.has(candidate));
}

export function setLevel({
  resource,
  level,
  selected,
}: {
  resource: Resource;
  level: AccessLevel;
  selected: readonly AuthzPermission[];
}): AuthzPermission[] {
  const offered = new Set<string>(offeredPermissions(resource));
  const rest = selected.filter((permission) => !offered.has(permission));
  if (level === "none") return rest;
  if (level === "read")
    return unique([...rest, ...readLevelPermissions(resource)]);
  return unique([...rest, ...fullLevelPermissions(resource)]);
}

function unique(permissions: readonly AuthzPermission[]): AuthzPermission[] {
  return [...new Set(permissions)];
}

/**
 * Permissions that do nothing from a team- or project-scoped assignment.
 *
 * A role listing `governance:manage` is not wrong, but if the only place it is
 * ever assigned is a project, that line grants nothing at all (ADR-021). The
 * reader deserves to be told before they hand it to somebody and believe the
 * job is done.
 */
export function permissionsNeedingOrganizationScope(
  permissions: readonly string[],
): string[] {
  return permissions.filter(
    (permission) =>
      !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission }),
  );
}

export function permissionTakesEffectAt({
  permission,
  scopeType,
}: {
  permission: string;
  scopeType: "ORGANIZATION" | "TEAM" | "PROJECT";
}): boolean {
  return bindingScopeCanGrantPermission({ scopeType, permission });
}

/** The scopes a permission may be granted at, straight from the registry. */
export function grantableScopes(permission: string): readonly string[] {
  const { resource } = splitPermission(permission);
  return AUTHZ_RESOURCES[resource as AuthzResource]?.scopes ?? [];
}

/**
 * The three roles every organization starts with, as a ladder.
 *
 * Viewer is the base, member adds to it and admin adds to that — which is
 * literally how `@langwatch/authz` declares them, so the cards say it rather
 * than repeating three overlapping lists at the reader. Each card's headline
 * permissions are the ones its tier ADDS, computed here, so they cannot drift
 * from what the role actually grants.
 */
export type BuiltinTier = "admin" | "member" | "viewer";

export const BUILTIN_TIERS: readonly BuiltinTier[] = [
  "admin",
  "member",
  "viewer",
];

/**
 * The words and the headline tokens for each tier.
 *
 * Both are written by hand, because a sentence generated from sixty
 * permissions reads like one; and both are pinned to the engine's own
 * permission sets by `rolePermissions.unit.test.ts`, which fails if a clause
 * here stops being true of the role it describes. So the copy is a claim the
 * test keeps honest rather than a description kept in step by memory.
 */
export const BUILTIN_TIER_COPY = {
  admin: {
    name: "Admin",
    summary:
      "Everything Member can do, and the team as well: who is on it, the projects it owns, and how the gateway routes and spends.",
    headline: ["team:manage", "project:delete", "gatewayProviders:manage"],
    inheritsFrom: "member" as const,
  },
  member: {
    name: "Member",
    summary:
      "Create and change the work itself: traces, datasets, prompts, evaluations, experiments and the keys that call models.",
    headline: ["datasets:manage", "prompts:manage", "virtualKeys:create"],
    inheritsFrom: "viewer" as const,
  },
  viewer: {
    name: "Viewer",
    summary: "Read everything the team has, and change none of it.",
    headline: ["traces:view", "analytics:view", "datasets:view"],
    inheritsFrom: null,
  },
} as const satisfies Record<
  BuiltinTier,
  {
    name: string;
    summary: string;
    headline: readonly string[];
    inheritsFrom: BuiltinTier | null;
  }
>;

export function builtinTierPermissions(tier: BuiltinTier): string[] {
  return [...builtinRolePermissions(tier)].sort();
}

/** What this tier grants that the one below it does not. */
export function builtinTierAdditions(tier: BuiltinTier): string[] {
  const below = BUILTIN_TIER_COPY[tier].inheritsFrom;
  if (!below) return builtinTierPermissions(tier);
  const inherited = builtinRolePermissions(below);
  return builtinTierPermissions(tier).filter(
    (permission) => !inherited.has(permission),
  );
}

/** The handful of tokens a card shows, and how many it is standing in for. */
export function headlinePermissions(tier: BuiltinTier): {
  shown: readonly string[];
  total: number;
} {
  return {
    shown: BUILTIN_TIER_COPY[tier].headline,
    total: builtinTierPermissions(tier).length,
  };
}
