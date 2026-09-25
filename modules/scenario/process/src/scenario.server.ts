import { bindRestHeader } from "@langwatch/api/rest";
import { defineServerModule } from "@langwatch/kernel";

import { ScenarioApp } from "./app/scenario.app.ts";
import { scenarioLifecycleEventing } from "./eventing/scenario-lifecycle.pipeline.ts";
import { simulationProcessingEventing } from "./eventing/simulation-processing.pipeline.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
import { StalledRunsBackfillTask } from "./tasks/stalled-runs-backfill.task.ts";
import { scenarioEventsRest } from "./transport/scenario-event.rest.ts";
import { scenarioGenerateRest } from "./transport/scenario-generate.rest.ts";
import { scenarioRunExportRest } from "./transport/scenario-run-export.rest.ts";
import { createScenarioRest, scenarioRestSurface } from "./transport/scenario.rest.ts";
import { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
import { createSimulationRunsRest } from "./transport/simulation-run.rest.ts";

/** `scenarios.*`: repositories, the app, its tRPC namespace and REST families. */
export const scenarioServer = defineServerModule("scenario")
  .withRepositories(scenarioRepositories)
  .withApp(ScenarioApp)
  .withTransports(
    createScenarioRest(),
    createSimulationRunsRest(),
    scenarioEventsRest,
    scenarioGenerateRest,
    scenarioRunExportRest,
    scenarioTrpcTransport,
  )
  // Which surface a write declares itself through, off the caller's own
  // `X-LangWatch-Surface` header - nothing a process collaborator answers.
  .withTransportFacts(() => [bindRestHeader(scenarioRestSurface, "x-langwatch-surface")])
  .withEventing(scenarioLifecycleEventing)
  .withEventing(simulationProcessingEventing)
  .withTasks(({ repositories, members }) => [
    StalledRunsBackfillTask.create({
      finder: () => repositories.stalledRuns,
      execution: () => members.scenarioExecution,
    }),
  ]);
