/**
 * Which page keys the simulation screens answer, and what they are wrapped in.
 *
 * THREE KEYS, and the route table already carries five ROWS for them: the run
 * board serves `/:project/simulations`, `/:project/simulations/*` and, once the
 * library's own row has matched, everything else under the prefix.
 *
 * All three state `withPermissionGuard("scenarios:view")`, unchanged. Agent
 * Testing states `release_ui_agent_testing_v2_enabled` as well, and the ORDER
 * is the policy: the flag is read before the permission, so the address reads
 * as "not found" for everyone while the flag is off rather than as "you may
 * not". `withUiPageGuard` (via `uiPage`) carries that rule already.
 */

import { scenarioScreens } from "@langwatch/scenario-web/screens/simulations";
import type { ComponentType } from "react";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import { uiPage } from "../../../../ui/sections/ui-page";
import { ScenarioHost } from "./host";

/** The grant all three platform pages carried, unchanged. */
const SIMULATIONS_PAGE_PERMISSION = "scenarios:view";

/** The release flag that gated the Agent Testing address, unchanged. */
const AGENT_TESTING_RELEASE_FLAG = "release_ui_agent_testing_v2_enabled";

export const simulationsPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/simulations/[[...path]]": uiPage({
    screen: async () => ({ default: (await scenarioScreens.simulations()).default as ComponentType }),
    host: ScenarioHost,
    permission: SIMULATIONS_PAGE_PERMISSION,
  }),
  "pages/[project]/simulations/scenarios/index": uiPage({
    screen: async () => ({
      default: (await scenarioScreens.scenarioLibrary()).default as ComponentType,
    }),
    host: ScenarioHost,
    permission: SIMULATIONS_PAGE_PERMISSION,
  }),
  "pages/[project]/agent-testing/[[...path]]": uiPage({
    screen: async () => ({ default: (await scenarioScreens.agentTesting()).default as ComponentType }),
    host: ScenarioHost,
    permission: SIMULATIONS_PAGE_PERMISSION,
    flags: [AGENT_TESTING_RELEASE_FLAG],
  }),
};
