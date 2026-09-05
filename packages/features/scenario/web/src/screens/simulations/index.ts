/// <reference path="../../model/types/ambient.d.ts" />

import type { ComponentType } from "react";

export type ScenarioScreenLoader = () => Promise<{ default: ComponentType }>;

export const scenarioScreens = {
  simulations: () => import("./simulations.screen"),
  scenarioLibrary: () => import("./scenario-library.screen"),
  agentTesting: () => import("../agent-testing/agent-testing.screen"),
} as const satisfies Record<string, ScenarioScreenLoader>;

export type ScenarioScreenName = keyof typeof scenarioScreens;

export { api as scenarioApi, api as scenarioApiHooks } from "../../behavior/scenario-api";
export type {
  RouterOutputs as ScenarioRouterOutputs,
  ScenarioApiMap,
} from "../../behavior/scenario-api";
export {
  ScenarioHostPort,
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
} from "../../model/scenario-host";

/**
 * The connected agents' own card grid (ADR-128), for `@langwatch/agent-web`'s agents
 * page to plug into `AgentManagementHostPort.connectedSection()`.
 */
export { ConnectedAgentsSection } from "../../ui/sections/agents/connected/connected-agents-section";
