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
  Resources.TEAM,
  Resources.PROJECT,
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
  return [
    Actions.MANAGE,
    Actions.VIEW,
    Actions.CREATE,
    Actions.UPDATE,
    Actions.DELETE,
  ];
}
