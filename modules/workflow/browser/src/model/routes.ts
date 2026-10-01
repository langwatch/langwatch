/**
 * Moved to `@langwatch/workflow-contract` (pure, zero imports) to close
 * cycle A leg 2 (scenario -> workflow). Re-exported here so the
 * `surfaces/workflow-routes` subpath keeps its shape unchanged.
 */
export {
  projectRoutes,
  type Route,
  findCurrentRoute,
  getRoutePath,
  buildRoutePath,
  buildProjectSwitchHref,
} from "@langwatch/workflow-contract";
