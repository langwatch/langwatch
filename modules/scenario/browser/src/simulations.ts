import "./model/types/ambient.d.ts";

export { api as scenarioApi, api as scenarioApiHooks } from "./behavior/scenario-api.ts";
export type {
  RouterOutputs as ScenarioRouterOutputs,
  ScenarioApiMap,
} from "./behavior/scenario-api.ts";
export {
  ScenarioHostApi,
  ScenarioHostProvider,
  useOptionalScenarioHost,
  useScenarioHost,
  type ScenarioFailureNotice,
  type ScenarioHostOrganization,
  type ScenarioHostOrganizationRole,
  type ScenarioHostProject,
  type ScenarioHostTeam,
  type ScenarioHostUser,
  type ScenarioRouteReading,
  type ScenarioSuccessNotice,
} from "./model/scenario-host.ts";

/**
 * The connected agents' own card grid (ADR-128), for `@langwatch/agent-browser`'s agents
 * page to plug into `AgentManagementHostApi.connectedSection()`.
 */
