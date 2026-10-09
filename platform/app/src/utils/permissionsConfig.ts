import type {
  AuthzAction as Action,
  AuthzResource as Resource,
} from "@langwatch/authz";

/**
 * Permissions configuration utilities
 *
 * Single Responsibility: Provide a single source of truth for permission-related
 * ordering and valid actions per resource for the Roles UI.
 */
export const orderedResources: Resource[] = [
  // Organization and Team are managed at higher levels; omit from UI
  "traces",
  "cost",
  "scenarios",
  "annotations",
  "analytics",
  "evaluations",
  "datasets",
  "triggers",
  "workflows",
  "experiments",
  "prompts",
  "secrets",
  "auditLog",
  "team",
  "project",
  // AI Governance — admins can grant subsets to custom roles
  // (e.g. "security_analyst" → governance:view + activityMonitor:view).
  "governance",
  "ingestionSources",
  "anomalyRules",
  "complianceExport",
  "activityMonitor",
  // AI Tools Portal (Phase 7) — view defaults to all org roles, manage
  // is admin-only. Custom roles can grant manage to scoped editors.
  "aiTools",
  // "playground", // Hidden intentionally
];

export function getValidActionsForResource(resource: Resource): Action[] {
  if (resource === "cost") {
    return ["view"];
  }
  if (resource === "traces") {
    return ["view", "share"];
  }
  if (resource === "secrets" || resource === "experiments") {
    return ["view", "manage"];
  }
  if (resource === "scenarios") {
    return ["view"];
  }
  if (resource === "auditLog") {
    // Audit log is read-only; rows are emitted by other services and never
    // mutated through this surface. Only :view is meaningful.
    return ["view"];
  }
  if (resource === "complianceExport" || resource === "activityMonitor") {
    // OCSF SIEM export + activity monitor are read-only surfaces — rows
    // are derived from governance_kpis_ocsf_events / trace_summaries
    // folds, never created/updated/deleted through these endpoints.
    return ["view"];
  }
  return ["manage", "view", "create", "update", "delete"];
}
