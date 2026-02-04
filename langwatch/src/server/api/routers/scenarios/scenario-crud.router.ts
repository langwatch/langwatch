import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { enforceLicenseLimit } from "~/server/license-enforcement";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../../rbac";
import { projectSchema } from "./schemas";

const logger = createLogger("langwatch:api:scenarios:crud");

const createScenarioSchema = projectSchema.extend({
  name: z.string().min(1),
  situation: z.string(),
  criteria: z.array(z.string()).default([]),
  labels: z.array(z.string()).default([]),
});

const updateScenarioSchema = projectSchema.extend({
  id: z.string(),
  name: z.string().min(1).optional(),
  situation: z.string().optional(),
  criteria: z.array(z.string()).optional(),
  labels: z.array(z.string()).optional(),
});

/**
 * Scenario CRUD operations.
 */
export const scenarioCrudRouter = createTRPCRouter({
  create: protectedProcedure
    .input(createScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      logger.info({ projectId: input.projectId }, "Creating scenario");

      // Enforce scenario limit before creation
      await enforceLicenseLimit(ctx, input.projectId, "scenarios");

      const service = ScenarioService.create(ctx.prisma);
      const result = await service.create({
        ...input,
        lastUpdatedById: ctx.session.user.id,
      });

      logger.info({ projectId: input.projectId, scenarioId: result.id }, "Scenario created");
      return result;
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      logger.debug({ projectId: input.projectId }, "Fetching all scenarios");
      const service = ScenarioService.create(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      logger.debug({ projectId: input.projectId, scenarioId: input.id }, "Fetching scenario by id");
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

  update: protectedProcedure
    .input(updateScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      logger.info({ projectId: input.projectId, scenarioId: input.id }, "Updating scenario");

      const { id, projectId, ...data } = input;
      const service = ScenarioService.create(ctx.prisma);
      const result = await service.update(id, projectId, {
        ...data,
        lastUpdatedById: ctx.session.user.id,
      });

      logger.info({ projectId, scenarioId: id }, "Scenario updated");
      return result;
    }),
});
