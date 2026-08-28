import { createLogger } from "@langwatch/observability";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { fireScenarioCreatedNurturing } from "~/../ee/billing/nurturing/hooks/featureAdoption";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { modelOverrideSchema } from "~/server/modelProviders/modelOverrideSchema";
import { trackServerEvent } from "~/server/posthog";
import { ScenarioNotFoundError } from "~/server/scenarios/errors";
import { scenarioParameterDefinitionsSchema } from "~/server/scenarios/parameters";
import { ScenarioService } from "~/server/scenarios/scenario.service";
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
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
  // The parameters the scenario declares, each with an optional description
  // and default. A run supplies values for these names.
  parameters: scenarioParameterDefinitionsSchema.optional(),
  // Turn config (ADR-015); null clears back to SDK default.
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // The test suite this scenario is filed in; absent or null files it into Default.
  testSuiteId: z.string().nullish(),
});

const updateScenarioSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
  simulatorModel: modelOverrideSchema.nullish(),
  judgeModel: modelOverrideSchema.nullish(),
  parameters: scenarioParameterDefinitionsSchema.optional(),
  maxTurns: z.number().int().min(1).max(100).nullish(),
  minTurns: z.number().int().min(0).max(100).nullish(),
  // Absent = keep the current test suite; null = unfile; a test suite id = move.
  testSuiteId: z.string().nullish(),
  // The version the editor loaded. When sent, a save against any other
  // version is refused with scenario_stale_version instead of overwriting
  // the newer save. Absent = save over whatever is there.
  expectedVersion: z.number().int().min(1).optional(),
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

      const service = ScenarioService.create(ctx.prisma);
      const result = await service.create(
        {
          ...input,
          lastUpdatedById: ctx.session.user.id,
        },
        { actor: { userId: ctx.session.user.id, label: "user" } },
      );

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
      const service = ScenarioService.create(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      logger.debug(
        { projectId: input.projectId, scenarioId: input.id },
        "Fetching scenario by id",
      );
      const service = ScenarioService.create(ctx.prisma);
      const scenario = await service.getById(input);
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
      const service = ScenarioService.create(ctx.prisma);
      return service.getByIdIncludingArchived(input);
    }),

  update: protectedProcedure
    .input(updateScenarioSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.id },
        "Updating scenario",
      );

      const { id, projectId, expectedVersion, ...data } = input;
      const service = ScenarioService.create(ctx.prisma);
      try {
        const result = await service.update({
          id,
          projectId,
          data: {
            ...data,
            lastUpdatedById: ctx.session.user.id,
          },
          options: {
            actor: { userId: ctx.session.user.id, label: "user" },
            expectedVersion,
          },
        });

        logger.info({ projectId, scenarioId: id }, "Scenario updated");
        return result;
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.id },
        "Archiving scenario",
      );

      const service = ScenarioService.create(ctx.prisma);
      try {
        const result = await service.archive(input);
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

  moveToTestSuite: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
        // A test suite id files the scenario there; null unfiles it.
        testSuiteId: z.string().nullable(),
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
          testSuiteId: input.testSuiteId,
        },
        "Moving scenario to test suite",
      );

      const service = ScenarioService.create(ctx.prisma);
      try {
        return await service.moveToTestSuite({
          scenarioId: input.scenarioId,
          projectId: input.projectId,
          testSuiteId: input.testSuiteId,
        });
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
        }
        throw error;
      }
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ scenarioId: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      logger.info(
        { projectId: input.projectId, scenarioId: input.scenarioId },
        "Duplicating scenario",
      );

      const service = ScenarioService.create(ctx.prisma);
      try {
        return await service.duplicate({
          scenarioId: input.scenarioId,
          projectId: input.projectId,
          lastUpdatedById: ctx.session.user.id,
        });
      } catch (error) {
        if (error instanceof ScenarioNotFoundError) {
          throw new TRPCError({ code: "NOT_FOUND", message: error.message });
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

      const service = ScenarioService.create(ctx.prisma);
      const result = await service.batchArchive(input);

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
