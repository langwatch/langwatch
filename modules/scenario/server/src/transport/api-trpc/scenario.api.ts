/**
 * The complete `scenarios.*` tRPC surface: a flat merge of CRUD, run reads and the live stream, the
 * simulation runner, cancellation, version history, the Results tab's reads and the run dialog's
 * configuration history.
 */
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { createResultAtomsRouter } from "./result-atoms.api.ts";
import { createRunConfigurationsRouter } from "./run-configurations.api.ts";
import { createScenarioCancellationRouter } from "./scenario-cancellation.api.ts";
import { createScenarioCrudRouter } from "./scenario-crud.api.ts";
import { createScenarioEventsRouter } from "./scenario-events.api.ts";
import { createScenarioVersionRouter } from "./scenario-version.api.ts";
import type {
  ScenarioTrpcContext,
  ScenarioTrpcPorts,
  ScenarioTrpcProcedures,
} from "../../rules/scenario-trpc-context.rules.ts";
import { createSimulationRunnerRouter } from "./simulation-runner.api.ts";

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
    return trpc.mergeRouters(
      createScenarioCrudRouter(trpc, procedures, ports),
      createScenarioEventsRouter(trpc, procedures),
      createSimulationRunnerRouter(trpc, procedures),
      createScenarioCancellationRouter(trpc, procedures),
      createScenarioVersionRouter(trpc, procedures),
      createResultAtomsRouter(trpc, procedures),
      createRunConfigurationsRouter(trpc, procedures),
    );
  }
}
