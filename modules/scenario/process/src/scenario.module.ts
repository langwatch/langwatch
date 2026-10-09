import {
  bindRestHeader,
  bindRestMiddleware,
  principalOfCredential,
  projectCredentialOfRequest,
} from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { ScenarioApi, ScenarioServerConfig } from "@langwatch/scenario-contract";

import { ScenarioModule } from "./app/scenario.app.ts";
import { scenarioChannels } from "./channels/scenario-channels.registry.ts";
import { scenarioLifecycleEventing } from "./eventing/scenario-lifecycle.pipeline.ts";
import { simulationProcessingEventing } from "./eventing/simulation-processing.pipeline.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
import { StalledRunsBackfillTask } from "./tasks/stalled-runs-backfill.task.ts";
import { agentTestCallerKey, scenarioAgentTestRest } from "./transport/scenario-agent-test.rest.ts";
import { scenarioEventsRest } from "./transport/scenario-event.rest.ts";
import { scenarioGenerateRest } from "./transport/scenario-generate.rest.ts";
import { scenarioRunExportRest } from "./transport/scenario-run-export.rest.ts";
import { createScenarioVoiceMediaDoor } from "./transport/scenario-voice-media.ws.ts";
import { scenarioVoiceRest } from "./transport/scenario-voice.rest.ts";
import { createScenarioRest, scenarioRestSurface } from "./transport/scenario.rest.ts";
import { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";
import { createSimulationRunsRest } from "./transport/simulation-run.rest.ts";

/** `scenarios.*`: repositories, the app, its tRPC namespace and REST families. */
export const scenarioProcessModule: PublishedProcessModule<
  "scenario",
  ScenarioApi,
  ScenarioServerConfig
> = defineProcessModule("scenario")
  .withRepositories(scenarioRepositories)
  .withChannels(scenarioChannels)
  .withApi(ScenarioModule)
  .withTransports(
    createScenarioRest(),
    createSimulationRunsRest(),
    createScenarioVoiceMediaDoor(),
    scenarioAgentTestRest,
    scenarioEventsRest,
    scenarioGenerateRest,
    scenarioRunExportRest,
    scenarioVoiceRest,
    scenarioTrpcTransport,
  )
  // The surface header a write declares itself through, and the API key the project door
  // resolved for an agent test run - nothing a process collaborator answers.
  .withTransportFacts(() => [
    bindRestHeader(scenarioRestSurface, "x-langwatch-surface"),
    bindRestMiddleware(agentTestCallerKey, (context) => {
      const principal = principalOfCredential(projectCredentialOfRequest(context.req.raw));
      return principal?.type === "apiKey" ? principal.id : null;
    }),
  ])
  .withEventing(scenarioLifecycleEventing)
  .withEventing(simulationProcessingEventing)
  .withTasks(({ repositories, app }) => [
    StalledRunsBackfillTask.create({
      finder: () => repositories.stalledRuns,
      execution: () => app,
    }),
  ]);
