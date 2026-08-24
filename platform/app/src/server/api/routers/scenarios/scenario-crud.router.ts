import { createLogger } from "@langwatch/observability";
import {
  ScenarioNotFoundError,
  scenarioParameterDefinitionsSchema,
} from "@langwatch/scenario-contract";
import { TRPCError } from "@trpc/server";
import { z } from "zod/v4";
import { fireScenarioCreatedNurturing } from "~/server/app-layer/billing/nurturing/featureAdoption";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { trackServerEvent } from "~/server/posthog";
import { captureException } from "~/utils/posthogErrorCapture";
import { projectSchema } from "./schemas";

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
});

/**
 * Scenario CRUD operations.
 */
export const scenarioCrudRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createScenarioSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info({ projectId: input.projectId }, "Creating scenario");

      const result = await ctx.app.scenarios.create({
        ...input,
        lastUpdatedById: ctx.session.user.id,
      });

      trackServerEvent({
        userId: ctx.session.user.id,
        event: "scenario_created",
        projectId: input.projectId,
      });

      void ctx.prisma.scenario
        .count({
          where: { projectId: input.projectId, archivedAt: null },
        })
        .then((count) => {
          fireScenarioCreatedNurturing({
            userId: ctx.session.user.id,
            scenarioCount: count,
            scenarioId: result.id,
            projectId: input.projectId,
          });
        })
        .catch(captureException);

      logger.info(
        { projectId: input.projectId, scenarioId: result.id },
        "Scenario created",
      );
      return result;
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      logger.debug({ projectId: input.projectId }, "Fetching all scenarios");
      return ctx.app.scenarios.list(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      logger.debug(
        { projectId: input.projectId, scenarioId: input.id },
        "Fetching scenario by id",
      );
      const scenario = await ctx.app.scenarios.tryGetById(input);
      if (!scenario) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scenario not found",
        });
      }
      return scenario;
    }),

  getByIdIncludingArchived: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      logger.debug(
        { projectId: input.projectId, scenarioId: input.id },
        "Fetching scenario by id including archived",
      );
      return ctx.app.scenarios.tryGetByIdIncludingArchived(input);
    }),

  update: protectedProcedure
    .input(updateScenarioSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.id },
        "Updating scenario",
      );

      const { id, projectId, ...data } = input;
      const result = await ctx.app.scenarios.update({
        id,
        projectId,
        ...data,
        lastUpdatedById: ctx.session.user.id,
      });

      logger.info({ projectId, scenarioId: id }, "Scenario updated");
      return result;
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.id },
        "Archiving scenario",
      );

      try {
        const result = await ctx.app.scenarios.archive(input);
        logger.info(
          { projectId: input.projectId, scenarioId: input.id },
          "Scenario archived",
        );
        return result;
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message,
          });
        }
        throw error;
      }
    }),

  batchArchive: protectedProcedure
    .input(projectSchema.extend({ ids: z.array(z.string()).min(1) }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
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
