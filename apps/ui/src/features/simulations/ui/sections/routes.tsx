/**
 * Which page keys the simulation screens answer, and what they are wrapped in.
 *
 * THREE KEYS, and the route table already carries five ROWS for them: the run
 * board serves `/:project/simulations`, `/:project/simulations/*` and, once the
 * library's own row has matched, everything else under the prefix. All of them
 * are wrapped in the host provider, which goes OUTSIDE the guard: a refusal
 * renders the guard's own fallback, which asks nothing of the scenario host,
 * but a page that opens needs the host mounted above it before its first
 * render.
 *
 * All three state `withPermissionGuard("scenarios:view")`, unchanged. Agent
 * Testing states `release_ui_agent_testing_v2_enabled` as well, and the ORDER
 * is the policy: the flag is read before the permission, so the address reads
 * as "not found" for everyone while the flag is off rather than as "you may
 * not". `withUiPageGuard` carries that rule already.
 *
 * `layoutComponent: DashboardLayout` was the other half of all three calls and
 * does not travel: chrome belongs to the route tree, and these pages are
 * children of layout routes the composing application serves.
 */

import { scenarioScreens } from "@langwatch/scenario-web/screens/simulations";

import type { UiPageLoaderRegistry } from "../../../../behavior/ui-page-loaders";
import {
  UiPageForbidden,
  UiPageLoading,
  UiPageNotFound,
} from "../../../../ui/elements/ui-page-fallbacks";
import { withUiPageGuard } from "../../../../ui/sections/ui-page-guard";
import {
  AGENT_TESTING_RELEASE_FLAG,
  SIMULATIONS_PAGE_PERMISSION,
} from "../../behavior/host.adapter";
import { withScenarioHost } from "./host-provider";

const FALLBACKS = {
  loading: UiPageLoading,
  notFound: UiPageNotFound,
  forbidden: UiPageForbidden,
};

export const simulationsPageLoaders: UiPageLoaderRegistry = {
  "pages/[project]/simulations/[[...path]]": async () => {
    const module = await scenarioScreens.simulations();
    const guarded = withUiPageGuard({
      permission: SIMULATIONS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = "SimulationsPage";
    return { default: withScenarioHost(guarded) };
  },
  "pages/[project]/simulations/scenarios/index": async () => {
    const module = await scenarioScreens.scenarioLibrary();
    const guarded = withUiPageGuard({
      permission: SIMULATIONS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = "ScenarioLibraryPage";
    return { default: withScenarioHost(guarded) };
  },
  "pages/[project]/agent-testing/[[...path]]": async () => {
    const module = await scenarioScreens.agentTesting();
    const guarded = withUiPageGuard({
      flags: [AGENT_TESTING_RELEASE_FLAG],
      permission: SIMULATIONS_PAGE_PERMISSION,
      fallbacks: FALLBACKS,
    })(module.default);
    guarded.displayName = "AgentTestingPage";
    return { default: withScenarioHost(guarded) };
  },
};
