import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../../rbac";

// Base schema for all project-related operations
const projectSchema = z.object({
  projectId: z.string(),
});

export const scenarioEventsRouter = createTRPCRouter({
  // Get scenario sets data for a project
  getScenarioSetsData: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getScenarioSetsDataForProject({
        projectId: input.projectId,
      });
      return data;
    }),

  // Get all run data for a scenario set
  getScenarioSetRunData: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(), // Cursor for pagination
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getRunDataForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        limit: input.limit,
        cursor: input.cursor,
      });
      return data;
    }),

  // Get ALL run data for a scenario set without pagination
  getAllScenarioSetRunData: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getAllRunDataForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
      });
      return data;
    }),

  // Get scenario run state
  getRunState: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioRunId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getScenarioRunData({
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

  // Get total count of batch runs for a scenario set (for pagination)
  getScenarioSetBatchRunCount: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const count = await scenarioRunnerService.getBatchRunCountForScenarioSet({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
      });
      return { count };
    }),

  // Get scenario run data by scenario id
  getRunDataByScenarioId: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getScenarioRunDataByScenarioId({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
      });
      return { data };
    }),

  // Get scenario run data for a specific batch run
  getBatchRunData: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        batchRunId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
      });
      return data;
    }),
});
