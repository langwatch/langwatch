import { defineModule } from "@langwatch/runtime-composition";
import { ScenarioApp } from "./app/scenario.app.ts";
import { scenarioRepositories } from "./repositories/scenario-repositories.registry.ts";

/**
 * `scenarios.*`, on the annotated runtime: repositories selected once at
 * boot, the app built over them. Transports are not attached yet - the
 * tRPC and REST families still run on the legacy builders (see the
 * module's handover); a process installs this only for {@link ScenarioApp}
 * itself today, e.g. the memory-backed boot test.
 */
export const scenarioServer = defineModule("scenario")
  .withRepositories(scenarioRepositories)
  .withApp(ScenarioApp)
  .build();
