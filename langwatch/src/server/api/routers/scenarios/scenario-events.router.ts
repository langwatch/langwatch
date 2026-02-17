import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ScenarioEventService } from "~/server/scenarios/scenario-event.service";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { createLogger } from "~/utils/logger/server";
import { checkProjectPermission } from "../../rbac";

const logger = createLogger("langwatch:api:scenarios:events");

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
      logger.debug({ projectId: input.projectId }, "Fetching scenario sets data");
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
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, limit: input.limit, hasCursor: !!input.cursor },
        "Fetching scenario set run data",
      );
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
      logger.debug({ projectId: input.projectId, scenarioSetId: input.scenarioSetId }, "Fetching all scenario set run data");
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
      logger.debug({ projectId: input.projectId, scenarioRunId: input.scenarioRunId }, "Fetching scenario run state");
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
      logger.debug({ projectId: input.projectId, scenarioSetId: input.scenarioSetId }, "Fetching batch run count");
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
      logger.debug({ projectId: input.projectId, scenarioId: input.scenarioId }, "Fetching run data by scenario id");
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
      logger.debug(
        { projectId: input.projectId, scenarioSetId: input.scenarioSetId, batchRunId: input.batchRunId },
        "Fetching batch run data",
      );
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
      });
      return data;
    }),

  // Get run data for all suites (cross-suite view)
  getAllSuiteRunData: protectedProcedure
    .input(
      projectSchema.extend({
        limit: z.number().min(1).max(100).default(20),
        cursor: z.string().optional(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input, ctx }) => {
      logger.debug({ projectId: input.projectId, limit: input.limit, hasCursor: !!input.cursor }, "Fetching all suite run data");
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getRunDataForAllSuites({
        projectId: input.projectId,
        limit: input.limit,
        cursor: input.cursor,
      });
      return data;
    }),
});
