import { bindRestHeader } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { ScenarioApp } from "./app/scenario.app.ts";
import { scenarioLifecycleEventing } from "./eventing/scenario-lifecycle.pipeline.ts";
import { simulationProcessingEventing } from "./eventing/simulation-processing.pipeline.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
import { scenarioGenerateRest } from "./transport/scenario-generate.rest.ts";
import { scenarioRunExportRest } from "./transport/scenario-run-export.rest.ts";
import { createScenarioRest, scenarioRestSurface } from "./transport/scenario.rest.ts";
import { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
import { createSimulationRunsRest } from "./transport/simulation-run.rest.ts";

/**
 * `scenarios.*`: repositories, the app, its tRPC namespace, and the two REST
 * families whose only process port was `platformUrl` (now `ScenarioApi`'s).
 * The other three still need ports `ScenarioApi` lacks; see the module handover.
 */
export const scenarioServer = defineServerModule("scenario")
  .withRepositories(scenarioRepositories)
  .withApp(ScenarioApp)
  .withTransports(
    createScenarioRest(),
    createSimulationRunsRest(),
    scenarioGenerateRest,
    scenarioRunExportRest,
    scenarioTrpcTransport,
  )
  // Which surface a write declares itself through, off the caller's own
  // `X-LangWatch-Surface` header - nothing a process collaborator answers.
  .withTransportFacts(() => [bindRestHeader(scenarioRestSurface, "x-langwatch-surface")])
  .withEventing(scenarioLifecycleEventing)
  .withEventing(simulationProcessingEventing);
