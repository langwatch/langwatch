/**
 * Scenario CRUD over the process's tRPC transport.
 */
import { createLogger } from "@langwatch/observability";
import {
  ScenarioNotFoundError,
  scenarioParameterDefinitionsSchema,
} from "@langwatch/scenario-contract";
import {
  TRPCError,
  type AnyTRPCRootTypes,
  type TRPCRootObject,
  type TRPCRuntimeConfigOptions,
} from "@trpc/server";
import { z } from "zod";
import { projectSchema } from "./scenario.schemas";
import type {
  ScenarioTrpcContext,
  ScenarioTrpcPorts,
  ScenarioTrpcProcedures,
} from "./scenario.trpc-context";

const logger = createLogger("langwatch:api:scenarios:crud");

const createScenarioSchema = projectSchema.extend({
  name: z.string().min(1),
  situation: z.string(),
  criteria: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
  // Optional per-scenario model overrides; null clears back to the project
  // default (scenarios.user_simulator / scenarios.judge).
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
  // The parameters the scenario declares, each with an optional description
  // and default. A run supplies values for these names.
  parameters: scenarioParameterDefinitionsSchema.optional(),
  // Turn config (ADR-015); null clears back to SDK default.
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // The folder (test suite) this case is filed in; absent or null = unfiled.
  folderId: z.string().nullish(),
});

const updateScenarioSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  simulatorModel: z.string().nullish(),
  judgeModel: z.string().nullish(),
  parameters: scenarioParameterDefinitionsSchema.optional(),
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // Absent = keep the current folder; null = unfile; a folder id = move.
  folderId: z.string().nullish(),
  // The version the editor loaded. When sent, a save against any other
  // version is refused with scenario_stale_version instead of overwriting
  // the newer save. Absent = save over whatever is there.
  expectedVersion: z.number().int().min(1).optional(),
});

export function createScenarioCrudRouter<
  TContext extends ScenarioTrpcContext,
  TOptions extends TRPCRuntimeConfigOptions<TContext, object>,
  TRoot extends AnyTRPCRootTypes,
>(
  trpc: TRPCRootObject<TContext, object, TOptions, TRoot>,
  procedures: ScenarioTrpcProcedures<TContext, TOptions, TRoot>,
  ports: ScenarioTrpcPorts,
) {
  const { protected: procedure, policy } = procedures;

  return trpc.router({
    create: policy("scenarios:manage")(procedure.input(createScenarioSchema)).mutation(
      async ({ ctx, input }) => {
        logger.info({ projectId: input.projectId }, "Creating scenario");

        const userId = ctx.actor().id;
        const result = await ctx.app.scenarios.create({
          ...input,
          lastUpdatedById: userId,
        });

        ports.trackScenarioCreated({ userId, projectId: input.projectId });

        void ctx.app.scenarios
          .count({ projectId: input.projectId })
          .then((count) => {
            ports.fireScenarioCreatedNurturing({
              userId,
              scenarioCount: count,
              scenarioId: result.id,
              projectId: input.projectId,
            });
          })
          .catch(ports.captureException);

        logger.info({ projectId: input.projectId, scenarioId: result.id }, "Scenario created");
        return result;
      },
    ),

    getAll: policy("scenarios:view")(procedure.input(projectSchema)).query(
      async ({ ctx, input }) => {
        logger.debug({ projectId: input.projectId }, "Fetching all scenarios");
        return ctx.app.scenarios.list(input);
      },
    ),

    getById: policy("scenarios:view")(
      procedure.input(projectSchema.extend({ id: z.string() })),
    ).query(async ({ ctx, input }) => {
      logger.debug({ projectId: input.projectId, scenarioId: input.id }, "Fetching scenario by id");
      const scenario = await ctx.app.scenarios.tryGetById(input);
      if (!scenario) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scenario not found",
        });
      }
      return scenario;
    }),

    getByIdIncludingArchived: policy("scenarios:view")(
      procedure.input(projectSchema.extend({ id: z.string() })),
    ).query(async ({ ctx, input }) => {
      logger.debug(
        { projectId: input.projectId, scenarioId: input.id },
        "Fetching scenario by id including archived",
      );
      return ctx.app.scenarios.tryGetByIdIncludingArchived(input);
    }),

    update: policy("scenarios:manage")(procedure.input(updateScenarioSchema)).mutation(
      async ({ ctx, input }) => {
        logger.info({ projectId: input.projectId, scenarioId: input.id }, "Updating scenario");

        const { id, projectId, expectedVersion, ...data } = input;
        const userId = ctx.actor().id;
        try {
          const result = await ctx.app.scenarios.update({
            id,
            projectId,
            ...data,
            lastUpdatedById: userId,
            actor: { userId, label: "user" },
            expectedVersion,
          });

          logger.info({ projectId, scenarioId: id }, "Scenario updated");
          return result;
        } catch (error) {
          if (error instanceof ScenarioNotFoundError) {
            throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
          }
          throw error;
        }
      },
    ),

    archive: policy("scenarios:manage")(
      procedure.input(projectSchema.extend({ id: z.string() })),
    ).mutation(async ({ ctx, input }) => {
      logger.info({ projectId: input.projectId, scenarioId: input.id }, "Archiving scenario");

      try {
        const result = await ctx.app.scenarios.archive(input);
        logger.info({ projectId: input.projectId, scenarioId: input.id }, "Scenario archived");
        return result;
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Scenario not found",
          });
        }
        throw error;
      }
    }),

    moveToFolder: policy("scenarios:manage")(
      procedure.input(
        projectSchema.extend({
          scenarioId: z.string(),
          // A folder id files the case there; null unfiles it.
          folderId: z.string().nullable(),
        }),
      ),
    ).mutation(async ({ ctx, input }) => {
      logger.info(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          folderId: input.folderId,
        },
        "Moving scenario to folder",
      );

      try {
        return await ctx.app.scenarios.moveToFolder({
          scenarioId: input.scenarioId,
          projectId: input.projectId,
          folderId: input.folderId,
        });
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
        }
        throw error;
      }
    }),

    duplicate: policy("scenarios:manage")(
      procedure.input(projectSchema.extend({ scenarioId: z.string() })),
    ).mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.scenarioId },
        "Duplicating scenario",
      );

      try {
        return await ctx.app.scenarios.duplicate({
          scenarioId: input.scenarioId,
          projectId: input.projectId,
          lastUpdatedById: ctx.actor().id,
        });
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
        }
        throw error;
      }
    }),

    batchArchive: policy("scenarios:manage")(
      procedure.input(projectSchema.extend({ ids: z.array(z.string()).min(1) })),
    ).mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, count: input.ids.length },
        "Batch archiving scenarios",
      );

      const result = await ctx.app.scenarios.batchArchive(input);

      logger.info(
        {
          projectId: input.projectId,
          archived: result.archived.length,
          failed: result.failed.length,
        },
        "Batch archive complete",
      );
      return result;
    }),
  });
}
