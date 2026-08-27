export type LangyPermissionVerdict =
  | { readonly disposition: "granted" }
  | { readonly disposition: "excluded"; readonly reason: string };

const delegableActions = new Set(["view", "create", "update"]);

const actionExclusions: Record<string, string> = {
  manage: "implies delete via the rbac hierarchy",
  delete: "destroys a user's data",
  share: "creates PUBLIC links to a user's traces",
  rotate: "rotates a live credential",
  attach: "changes which guardrails police a key",
  detach: "changes which guardrails police a key",
  viewOtherPersonal: "reads other members' personal keys, an admin audit power",
};

const delegableFamilies = new Set([
  "project",
  "traces",
  "evaluations",
  "datasets",
  "scenarios",
  "annotations",
  "analytics",
  "prompts",
  "triggers",
  "workflows",
  "experiments",
]);

const offLimitsFamilies: Record<string, string> = {
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

const readOnlyFamilies: Record<string, string> = {
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

export function splitPermission(permission: string): {
  family: string;
  action: string;
} {
  const separatorIndex = permission.indexOf(":");
  if (separatorIndex === -1) return { family: permission, action: "" };

  return {
    family: permission.slice(0, separatorIndex),
    action: permission.slice(separatorIndex + 1),
  };
}

export function classifyForLangy(permission: string): LangyPermissionVerdict {
  const { family, action } = splitPermission(permission);

  if (!action) {
    return {
      disposition: "excluded",
      reason: "not a `resource:action` permission",
    };
  }

  if (!delegableActions.has(action)) {
    return {
      disposition: "excluded",
      reason:
        actionExclusions[action] ??
        `\`${action}\` is not an action Langy may ever be delegated`,
    };
  }

  const offLimits = offLimitsFamilies[family];
  if (offLimits) return { disposition: "excluded", reason: offLimits };

  if (!delegableFamilies.has(family)) {
    return {
      disposition: "excluded",
      reason:
        `\`${family}\` is not on the list of families Langy may be delegated. ` +
        "If Langy should be able to use it, add it to DELEGABLE_FAMILIES; if " +
        "not, record why in OFF_LIMITS_FAMILIES",
    };
  }

  const readOnly = readOnlyFamilies[family];
  if (readOnly && action !== "view") {
    return { disposition: "excluded", reason: readOnly };
  }

  return { disposition: "granted" };
}
