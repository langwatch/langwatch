import { defineServerModule } from "@langwatch/runtime-composition";
import { ScenarioApp } from "./app/scenario.app.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";
import { scenarioTrpcTransport } from "./transport/scenario.trpc.ts";

/**
 * `scenarios.*`, on the annotated runtime: repositories selected once at boot,
 * the app built over them, and the one flat tRPC namespace the browser calls
 * served from the contract's own declaration. The REST families the same
 * module publishes are still on the legacy builders; see the module handover.
 */
export const scenarioServer = defineServerModule("scenario")
  .withRepositories(scenarioRepositories)
  .withApp(ScenarioApp)
  .withTransports(scenarioTrpcTransport)
  .build();
