import { bindRestHeader } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/runtime-composition";
import { ScenarioApp } from "./app/scenario.app.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
import { createScenarioRest, scenarioRestSurface } from "./transport/scenario.rest.ts";
import { createSimulationRunsRest } from "./transport/simulation-run.rest.ts";
import { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";

/**
 * `scenarios.*`: repositories, the app, its tRPC namespace, and the two REST
 * families whose only process port was `platformUrl` (now `ScenarioApi`'s).
 * The other three REST families still need process ports `ScenarioApi` has
 * no members for; see the module handover.
 */
export const scenarioServer = defineServerModule("scenario")
  .withRepositories(scenarioRepositories)
  .withApp(ScenarioApp)
  .withTransports(createScenarioRest(), createSimulationRunsRest(), scenarioTrpcTransport)
  // Which surface a write declares itself through, off the caller's own
  // `X-LangWatch-Surface` header - nothing a process collaborator answers.
  .withTransportFacts(() => [bindRestHeader(scenarioRestSurface, "x-langwatch-surface")]);
