/**
 * The run dialog's configuration history, over the process's tRPC transport.
 */
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { MAX_RUN_CONFIGURATIONS } from "../../ports/run-configurations-read.port";
import type { ScenarioTrpcContext, ScenarioTrpcProcedures } from "./scenario.trpc-context";

export function createRunConfigurationsRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy } = procedures;

  return trpc.router({
    /**
     * Every configuration this project's run plans already ran with, newest
     * first, one entry per configuration.
     *
     * The Run name dropdown reads this and filters it by the scope the dialog
     * currently holds. It replaces the plan-row read, which could only ever
     * answer one entry per plan: a plan row holds the configuration of its LAST
     * run, while two runs of one plan that used different parameters or a
     * different repeat count are two configurations and both belong in the list.
     *
     * `startDate` widens the window past the default. An empty list is the
     * ordinary state of a project whose plans never ran.
     */
    getRunConfigurations: policy("scenarios:view")(
      procedure.input(
        z.object({
          projectId: z.string(),
          startDate: z.number().int().nonnegative().optional(),
          endDate: z.number().int().nonnegative().optional(),
          limit: z.number().int().min(1).max(MAX_RUN_CONFIGURATIONS).optional(),
        }),
      ),
    ).query(async ({ ctx, input }) => {
      return ctx.app.scenarios.getRunConfigurations(input);
    }),
  });
}
