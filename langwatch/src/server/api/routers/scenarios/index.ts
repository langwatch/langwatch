import { createTRPCRouter } from "~/server/api/trpc";
import { cancellationRouter } from "./cancellation.router";
import { scenarioCrudRouter } from "./scenario-crud.router";
import { scenarioEventsRouter } from "./scenario-events.router";
import { simulationRunnerRouter } from "./simulation-runner.router";

export { type SimulationTarget } from "./simulation-runner.router";

/**
 * Combined scenarios router.
 * Flat merge of CRUD, events, simulation runner, and cancellation procedures.
 */
export const scenarioRouter = createTRPCRouter({
  ...scenarioCrudRouter._def.procedures,
  ...scenarioEventsRouter._def.procedures,
  ...simulationRunnerRouter._def.procedures,
  ...cancellationRouter._def.procedures,
});
