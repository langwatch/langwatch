import {
  principalOfCredential,
  projectCredentialOfRequest,
  projectRequestContextOf,
} from "@langwatch/api/rest";
import { defineProcessModule, type PublishedProcessModule } from "@langwatch/process";
import type { ScenarioApi, ScenarioServerConfig } from "@langwatch/scenario-contract";
import { defineMigrationStep } from "@langwatch/upgrade/step";

import { ScenarioModule } from "./app/scenario.app.ts";
import { scenarioChannels } from "./channels/scenario-channels.registry.ts";
import { scenarioLifecycleEventing } from "./eventing/scenario-lifecycle.pipeline.ts";
import { simulationProcessingEventing } from "./eventing/simulation-processing.pipeline.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
import { StalledRunsBackfillService } from "./services/stalled-runs-backfill.service.ts";
import { scenarioAgentTestRest } from "./transport/scenario-agent-test.rest.ts";
import { scenarioEventsRest } from "./transport/scenario-event.rest.ts";
import { scenarioGenerateRest } from "./transport/scenario-generate.rest.ts";
import { scenarioRunExportRest } from "./transport/scenario-run-export.rest.ts";
import { createScenarioVoiceMediaDoor } from "./transport/scenario-voice-media.ws.ts";
import { scenarioVoiceRest } from "./transport/scenario-voice.rest.ts";
import { createScenarioRest } from "./transport/scenario.rest.ts";
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
  .provideMiddlewareContext({
    projectRequestContext: projectRequestContextOf,
    scenarioRestSurface: (request) => request.headers.get("x-langwatch-surface"),
    agentTestCallerKey: (request) => {
      const principal = principalOfCredential(projectCredentialOfRequest(request));
      return principal?.type === "apiKey" ? principal.id : null;
    },
  })
  .withEventing(scenarioLifecycleEventing)
  .withEventing(simulationProcessingEventing)
  .withMigrations(({ repositories, app }) => [
    defineMigrationStep({
      id: "scenario:close-stalled-runs",
      kind: "data",
      mode: "background",
      description: "Closes historical simulation runs that never received a terminal event.",
      needsOldWritersGone: true,
      run: ({ dryRun }) =>
        StalledRunsBackfillService.create({
          finder: repositories.stalledRuns,
          execution: app,
        }).backfill({ dryRun }),
    }),
  ]);
