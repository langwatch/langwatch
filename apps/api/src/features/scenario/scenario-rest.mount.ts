/**
 * Mounts the scenario module's own REST families on this process's project
 * door: the scenarios (test cases) a project defines, their version history,
 * and the events an SDK reports while a scenario runs. `platformUrl` and
 * `scenarioRunPlatformUrl` are resolved by the process at mount time, exactly
 * as every deployment-address builder is - a transport package has no access
 * to the external origin and must not read it for itself.
 */
import type { ScenarioApi, ScenarioTabRegistry, SimulationService } from "@langwatch/scenario-contract";
import {
  createScenarioEventsRest,
  createScenarioRest,
  createSimulationRunsRest,
  scenarioRestSurface,
  type InlineMediaExtraction,
  type ScenarioRunPlatformUrlBuilder,
} from "@langwatch/scenario-server";
import {
  type AppRestBroadcast,
  bindRestHeader,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestErrorHandler,
} from "@langwatch/api/rest";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

export function mountScenarioRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    scenarios: () => ScenarioApi;
    simulations: () => SimulationService;
    scenarioTabs: () => ScenarioTabRegistry;
    broadcast: () => AppRestBroadcast;
    extractInlineMedia: InlineMediaExtraction;
    platformUrl: PlatformUrlBuilder;
    scenarioRunPlatformUrl: ScenarioRunPlatformUrlBuilder;
    errors: RestErrorHandler;
  }>,
): readonly MountableRestApp[] {
  return [
    runtime.mount(createScenarioRest({ platformUrl: options.platformUrl }), options.scenarios, {
      onError: options.errors,
      facts: [bindRestHeader(scenarioRestSurface, "X-LangWatch-Surface")],
    }),
    runtime.mount(
      createSimulationRunsRest({
        scenarioRunPlatformUrl: options.scenarioRunPlatformUrl,
        findBatchSummary: (input) => options.simulations().findBatchSummary(input),
      }),
      options.scenarios,
      { onError: options.errors },
    ),
    runtime.mount(
      createScenarioEventsRest({
        simulations: options.simulations,
        scenarioTabs: options.scenarioTabs,
        broadcast: options.broadcast,
        extractInlineMedia: options.extractInlineMedia,
        platformUrl: options.platformUrl,
      }),
      options.scenarios,
      { onError: options.errors },
    ),
  ];
}
