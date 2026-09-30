// What a permission means in words, and the picker's arithmetic (main's rolePermissions.ts).
// Keyed off the registry, so a new resource fails the typecheck until it has words.

import {
  type Action,
  type AuthzPermission,
  type AuthzResource,
  bindingScopeCanGrantPermission,
  isRegistryPermission,
} from "@langwatch/authz-contract";

import {
  type AuthzResource as OfferedResource,
  ORDERED_RESOURCES,
  validActionsForResource,
} from "./permission-catalogue.ts";

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

type ResourceCopy = {
  /** What a customer calls it. */
  label: string;
  /** One sentence: what the thing is, never how it works. */
  blurb: string;
  area: PermissionArea;
};

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
  governanceCost: {
    label: "Governance cost",
    blurb: "Your organization's spend, as the provider billed it and as the gateway measured it.",
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
  agentCache: {
    label: "Agent cache",
    blurb: "What an agent keeps mid-run, so a step it already paid for happens once.",
    area: "Building",
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
  featureFlags: {
    label: "Feature flag experiments",
    blurb: "Which experiments a project or organization is enrolled in.",
    area: "Organization",
  },
} as const satisfies Record<AuthzResource, ResourceCopy>;

const UNKNOWN_RESOURCE: ResourceCopy = {
  label: "Other",
  blurb: "A permission this version of the product no longer offers.",
  area: "Organization",
};

const RESOURCE_COPY_BY_NAME = new Map<string, ResourceCopy>(Object.entries(RESOURCE_COPY));

export function resourceCopy(resource: string): ResourceCopy {
  return RESOURCE_COPY_BY_NAME.get(resource) ?? UNKNOWN_RESOURCE;
}

type ActionCopy = {
  label: string;
  blurb: string;
};

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

const ACTION_COPY_BY_NAME = new Map<string, ActionCopy>(Object.entries(ACTION_COPY));

export function actionCopy(action: string): ActionCopy {
  return ACTION_COPY_BY_NAME.get(action) ?? UNKNOWN_ACTION;
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

/** Reading order. The offered set is the catalogue's, never the registry's wider one. */
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

export function offeredActions(resource: OfferedResource): Action[] {
  const valid = validActionsForResource(resource);
  return ACTION_ORDER.filter(
    (action) =>
      valid.some((candidate) => candidate === action) &&
      isRegistryPermission(`${resource}:${action}`),
  );
}

export function offeredPermissions(resource: OfferedResource): AuthzPermission[] {
  return offeredActions(resource)
    .map((action) => `${resource}:${action}`)
    .filter(isRegistryPermission);
}

/** Every resource the roles surface offers, grouped into its named area. */
export function offeredAreas(): {
  area: PermissionArea;
  resources: OfferedResource[];
}[] {
  return PERMISSION_AREAS.map((area) => ({
    area,
    resources: ORDERED_RESOURCES.filter((resource) => resourceCopy(resource).area === area),
  })).filter((group) => group.resources.length > 0);
}

/** How much of a resource a role holds: the picker's three answers, or custom actions. */
export type AccessLevel = "none" | "read" | "full" | "custom";

function fullLevelPermissions(resource: OfferedResource): AuthzPermission[] {
  const permissions = offeredPermissions(resource);
  const manage = permissions.filter((permission) => permission === `${resource}:manage`);
  return manage.length > 0 ? manage : permissions;
}

function readLevelPermissions(resource: OfferedResource): AuthzPermission[] {
  return offeredPermissions(resource).filter((permission) => permission === `${resource}:view`);
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
  resource: OfferedResource;
  selected: readonly string[];
}): AccessLevel {
  const held = offeredPermissions(resource).filter((permission) => selected.includes(permission));
  if (held.length === 0) return "none";
  if (sameSet(held, fullLevelPermissions(resource))) return "full";
  if (sameSet(held, readLevelPermissions(resource))) return "read";
  return "custom";
}

/** A resource whose only offered action is `view` is a switch, not a ladder. */
export function isReadOnlyResource(resource: OfferedResource): boolean {
  const actions = offeredActions(resource);
  return actions.length === 1 && actions[0] === "view";
}

/** Full access covers every action on its resource; changing what you cannot see is incoherent. */
export function withDependencies({
  resource,
  permission,
  selected,
}: {
  resource: OfferedResource;
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
  resource: OfferedResource;
  permission: AuthzPermission;
  selected: readonly AuthzPermission[];
}): AuthzPermission[] {
  const remove = new Set<string>(droppedWith({ resource, permission }));
  return selected.filter((candidate) => !remove.has(candidate));
}

function droppedWith({
  resource,
  permission,
}: {
  resource: OfferedResource;
  permission: AuthzPermission;
}): readonly string[] {
  const { action } = splitPermission(permission);
  if (action === "manage") return offeredPermissions(resource);
  if (action !== "view") return [permission];
  return offeredPermissions(resource).filter((candidate) => {
    const dependent = splitPermission(candidate).action;
    return (
      candidate === permission ||
      dependent === "create" ||
      dependent === "update" ||
      dependent === "delete"
    );
  });
}

export function setLevel({
  resource,
  level,
  selected,
}: {
  resource: OfferedResource;
  level: AccessLevel;
  selected: readonly AuthzPermission[];
}): AuthzPermission[] {
  const offered = new Set<string>(offeredPermissions(resource));
  const rest = selected.filter((permission) => !offered.has(permission));
  if (level === "none") return rest;
  if (level === "read") return unique([...rest, ...readLevelPermissions(resource)]);
  return unique([...rest, ...fullLevelPermissions(resource)]);
}

function unique(permissions: readonly AuthzPermission[]): AuthzPermission[] {
  return [...new Set(permissions)];
}

/** Permissions that grant nothing from a team- or project-scoped assignment (ADR-021). */
export function permissionsNeedingOrganizationScope(permissions: readonly string[]): string[] {
  return permissions.filter(
    (permission) => !bindingScopeCanGrantPermission({ scopeType: "TEAM", permission }),
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

/** Permissions grouped by the part of the product they are about, each group sorted. */
export function permissionsByArea(
  permissions: readonly string[],
): { area: PermissionArea; permissions: string[] }[] {
  return PERMISSION_AREAS.map((area) => ({
    area,
    permissions: permissions
      .filter((permission) => resourceCopy(splitPermission(permission).resource).area === area)
      .toSorted(),
  })).filter((group) => group.permissions.length > 0);
}
