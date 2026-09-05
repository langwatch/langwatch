/**
 * The run dialog's configuration history, over the process's tRPC transport.
 */
import { createTrpcService } from "@langwatch/api/trpc";
import { runConfigurationEntrySchema } from "@langwatch/scenario-contract";
import type { AnyTRPCRootTypes, TRPCRootObject, TRPCRuntimeConfigOptions } from "@trpc/server";
import { z } from "zod";
import { MAX_RUN_CONFIGURATIONS } from "../../ports/run-configurations-read.port";
import type {
  ScenarioTrpcContext,
  ScenarioTrpcProcedures,
} from "../../rules/scenario-trpc-context.rules";

export function createRunConfigurationsRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
) {
  const { protected: procedure, policy, validateOutput } = procedures;

  return (
    createTrpcService({
      root: trpc,
      procedures: { protected: procedure, policy },
      validateOutput,
    })
      /**
       * Every configuration this project's run plans already ran with, newest first, one entry per
       * configuration. The Run name dropdown reads this and filters it by the scope the dialog
       * currently holds.
       */
      .query("getRunConfigurations", (p) =>
        p
          .withInput(
            z.object({
              projectId: z.string(),
              startDate: z.number().int().nonnegative().optional(),
              endDate: z.number().int().nonnegative().optional(),
              limit: z.number().int().min(1).max(MAX_RUN_CONFIGURATIONS).optional(),
            }),
          )
          .withOutput(runConfigurationEntrySchema.array())
          .withPermission("scenarios:view")
          .handle(async ({ ctx, input }) => {
            return ctx.app.scenarios.getRunConfigurations(input);
          }),
      )
      .build()
  );
}
