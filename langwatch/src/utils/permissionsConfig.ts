import type { Action, Resource } from "../server/api/rbac";
import { Actions, Resources } from "../server/api/rbac";

/**
 * Permissions configuration utilities
 *
 * Single Responsibility: Provide a single source of truth for permission-related
 * ordering and valid actions per resource for the Roles UI.
 */
export const orderedResources: Resource[] = [
  // Organization and Team are managed at higher levels; omit from UI
  Resources.TRACES,
  Resources.COST,
  Resources.SCENARIOS,
  Resources.ANNOTATIONS,
  Resources.ANALYTICS,
  Resources.EVALUATIONS,
  Resources.DATASETS,
  Resources.TRIGGERS,
  Resources.WORKFLOWS,
  Resources.PROMPTS,
  Resources.SECRETS,
  Resources.AUDIT_LOG,
  Resources.TEAM,
  Resources.PROJECT,
  // AI Governance — admins can grant subsets to custom roles
  // (e.g. "security_analyst" → governance:view + activityMonitor:view).
  Resources.GOVERNANCE,
  Resources.INGESTION_SOURCES,
  Resources.ANOMALY_RULES,
  Resources.COMPLIANCE_EXPORT,
  Resources.ACTIVITY_MONITOR,
  // Resources.PLAYGROUND, // Hidden intentionally
];

export function getValidActionsForResource(resource: Resource): Action[] {
  if (resource === Resources.COST) {
    return [Actions.VIEW];
  }
  if (resource === Resources.TRACES) {
    return [Actions.VIEW, Actions.SHARE];
  }
  if (resource === Resources.SECRETS) {
    return [Actions.VIEW, Actions.MANAGE];
  }
  if (resource === Resources.SCENARIOS) {
    return [Actions.VIEW];
  }
  if (resource === Resources.AUDIT_LOG) {
    // Audit log is read-only; rows are emitted by other services and never
    // mutated through this surface. Only :view is meaningful.
    return [Actions.VIEW];
  }
  if (
    resource === Resources.COMPLIANCE_EXPORT ||
    resource === Resources.ACTIVITY_MONITOR
  ) {
    // OCSF SIEM export + activity monitor are read-only surfaces — rows
    // are derived from governance_kpis_ocsf_events / trace_summaries
    // folds, never created/updated/deleted through these endpoints.
    return [Actions.VIEW];
  }
  return [
    Actions.MANAGE,
    Actions.VIEW,
    Actions.CREATE,
    Actions.UPDATE,
    Actions.DELETE,
  ];
}
