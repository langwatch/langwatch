/// <reference path="../../model/types/ambient.d.ts" />
/**
 * The simulations family, as the browser application mounts it.
 *
 * THREE SCREENS, THREE ADDRESSES. `/:project/simulations/*` is the run board —
 * one catch-all page serving All Runs, a run plan, an external set and a batch
 * highlight, so navigating inside it is shallow and a live run keeps its
 * subscription. `/:project/simulations/scenarios` is the Scenario Library.
 * `/:project/agent-testing/*` is Agent Testing, the same product surface under
 * its own address and its own release flag.
 *
 * WHY ONE PACKAGE FOR ALL THREE. The credentials family's rule, read strictly:
 * a key belongs to the family that owns its TRANSPORT. Every address here calls
 * `scenarios.*` and `suites.*`, both mounted out of `@langwatch/scenario-server`,
 * and every payload on them is `@langwatch/scenario-contract`'s. Agent Testing
 * and Simulations are ONE surface over ONE transport — the run board's suite
 * rail and Agent Testing's cases rail read the same rows — so splitting them
 * would have put one product's two halves behind two host ports.
 *
 * WHAT THE OWNING FRONTEND FEATURE HAS TO MOUNT is the tRPC Provider these
 * hooks run on and the host port that answers for the project, the
 * organization, the reader, their grants, the address and the two notices.
 *
 * THE GUARDS ARE THE ROUTE'S. All three carry `scenarios:view`; Agent Testing
 * carries `release_ui_agent_testing_v2_enabled` OUTSIDE the permission guard,
 * so the address reads as "not found" for everyone while the flag is off,
 * before any permission is read.
 */

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
export { setScenarioErrorHost } from "../../behavior/errors";
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
 * The connected agents' own card grid (ADR-128), for `@langwatch/agent-web`'s
 * agents page to plug into `AgentManagementHostPort.connectedSection()`.
 * Presentational only — it reads its rows from props, not this package's
 * transport — so no host is required to render it.
 */
export { ConnectedAgentsSection } from "../../ui/sections/agents/connected/connected-agents-section";
