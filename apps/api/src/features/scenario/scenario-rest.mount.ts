/**
 * Mounts the scenario module's own REST families on this process's project
 * door: the scenarios (test cases) a project defines, their version history,
 * and the events an SDK reports while a scenario runs. `platformUrl` and
 * `scenarioRunPlatformUrl` are resolved by the process at mount time, exactly
 * as every deployment-address builder is - a transport package has no access
 * to the external origin and must not read it for itself.
 */
import type {
  ScenarioApi,
  ScenarioTabRegistry,
  SimulationService,
} from "@langwatch/scenario-contract";
import {
  createScenarioEventsRest,
  createScenarioRest,
  createSimulationRunsRest,
  scenarioEventErrorHandler,
  scenarioRestSurface,
  scenarioRestErrorHandler,
  simulationRunErrorHandler,
  type InlineMediaExtraction,
  type ScenarioRunPlatformUrlBuilder,
} from "@langwatch/scenario-server";
import {
  type AppRestBroadcast,
  bindRestHeader,
  bodyLimit,
  type MountableRestApp,
  type PlatformUrlBuilder,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import type { MiddlewareHandler } from "hono";

import type { ApiRestRuntime } from "../../app-rest/api-rest.runtime.ts";

const SCENARIO_EVENT_BODY_LIMIT_BYTES = 50 * 1024 * 1024;

export function mountScenariosRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    scenarios: () => ScenarioApi;
    platformUrl: PlatformUrlBuilder;
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  return runtime.mount(
    createScenarioRest({ platformUrl: options.platformUrl }).router(),
    options.scenarios,
    {
      onError: scenarioRestErrorHandler(options.errors),
      facts: [bindRestHeader(scenarioRestSurface, "X-LangWatch-Surface")],
    },
  );
}

export function mountSimulationRunsRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    scenarios: () => ScenarioApi;
    simulations: () => SimulationService;
    scenarioRunPlatformUrl: ScenarioRunPlatformUrlBuilder;
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  const declaration = createSimulationRunsRest({
    scenarioRunPlatformUrl: options.scenarioRunPlatformUrl,
    findBatchSummary: (input) => options.simulations().findBatchSummary(input),
  });

  return runtime.mount(declaration.router(), options.scenarios, {
    onError: simulationRunErrorHandler(options.errors),
  });
}

export function mountScenarioEventsRest(
  runtime: ApiRestRuntime,
  options: Readonly<{
    scenarios: () => ScenarioApi;
    simulations: () => SimulationService;
    scenarioTabs: () => ScenarioTabRegistry;
    broadcast: () => AppRestBroadcast;
    extractInlineMedia: InlineMediaExtraction;
    platformUrl: PlatformUrlBuilder;
    traceUsageGuard: MiddlewareHandler;
    errors: RestErrorHandler;
  }>,
): MountableRestApp {
  const declaration = createScenarioEventsRest({
    simulations: options.simulations,
    scenarioTabs: options.scenarioTabs,
    broadcast: options.broadcast,
    extractInlineMedia: options.extractInlineMedia,
    platformUrl: options.platformUrl,
  });

  return runtime.mount(declaration.router(), options.scenarios, {
    onError: scenarioEventErrorHandler(options.errors),
    middleware: [scenarioEventWriteMiddleware(options.traceUsageGuard)],
  });
}

function scenarioEventWriteMiddleware(traceUsageGuard: MiddlewareHandler): MiddlewareHandler {
  const eventBodyLimit = bodyLimit({ maxSize: SCENARIO_EVENT_BODY_LIMIT_BYTES });

  return async (context, next) => {
    const isFamilyRoot = context.req.path.endsWith("/scenario-events");
    if (!isFamilyRoot) {
      await next();
      return;
    }

    if (context.req.method === "POST") {
      return eventBodyLimit(context, () => traceUsageGuard(context, next));
    }

    if (context.req.method === "DELETE") {
      return traceUsageGuard(context, next);
    }

    await next();
  };
}
