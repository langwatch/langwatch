import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../../rbac";

const projectSchema = z.object({
  projectId: z.string(),
});

/**
 * Scenario events - reading run data from ES.
 */
export const scenarioEventsRouter = createTRPCRouter({
  getScenarioSetsData: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      return service.getScenarioSetsDataForProject({
        projectId: input.projectId,
      });
    }),

  getScenarioSetRunData: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      return service.getRunDataForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
      });
    }),

  getAllScenarioSetRunData: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      return service.getAllRunDataForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
      });
    }),

  getRunState: protectedProcedure
    .input(projectSchema.extend({ scenarioRunId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      const data = await service.getScenarioRunData({
        projectId: input.projectId,
        scenarioRunId: input.scenarioRunId,
      });
      if (!data) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scenario run not found",
        });
      }
      return data;
    }),

  getScenarioSetBatchRunCount: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      const count = await service.getBatchRunCountForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
      });
      return { count };
    }),

  getRunDataByScenarioId: protectedProcedure
    .input(projectSchema.extend({ scenarioId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      const data = await service.getScenarioRunDataByScenarioId({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
      });
      return { data };
    }),

  getBatchRunData: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        batchRunId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const service = new ScenarioEventService();
      return service.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
      });
    }),
});

