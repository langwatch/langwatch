/**
 * The complete `scenarios.*` tRPC surface: a flat merge of CRUD, run reads and
 * the live stream, the simulation runner, cancellation and version history.
 *
 * The five sub-surfaces are merged flat rather than nested because that is how
 * the surface has always been addressed — `scenarios.create`,
 * `scenarios.getSuiteRunData`, `scenarios.run` — and a transport move is not
 * the place to rename a client-facing procedure.
 */
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { createScenarioCancellationRouter } from "./scenario-cancellation.api";
import { createScenarioCrudRouter } from "./scenario-crud.api";
import { createScenarioEventsRouter } from "./scenario-events.api";
import { createScenarioVersionRouter } from "./scenario-version.api";
import type {
  ScenarioTrpcContext,
  ScenarioTrpcPorts,
  ScenarioTrpcProcedures,
} from "./scenario.trpc-context";
import { createSimulationRunnerRouter } from "./simulation-runner.api";

/** Installs the complete `scenarios.*` tRPC surface on a process-owned root. */
export class ScenarioTrpcApi {
  static create<
    TContext extends ScenarioTrpcContext,
    TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
    TRoot extends AnyTRPCRootTypes,
  >(
    trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
    procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
    ports: ScenarioTrpcPorts,
  ) {
    return trpc.router({
      ...createScenarioCrudRouter(trpc, procedures, ports)._def.procedures,
      ...createScenarioEventsRouter(trpc, procedures)._def.procedures,
      ...createSimulationRunnerRouter(trpc, procedures)._def.procedures,
      ...createScenarioCancellationRouter(trpc, procedures)._def.procedures,
      ...createScenarioVersionRouter(trpc, procedures)._def.procedures,
    });
  }
}
