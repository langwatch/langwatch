import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../rbac";

// Base schema for all project-related operations
const projectSchema = z.object({
  projectId: z.string(),
});

// Filter schema for table view
const filterSchema = z.object({
  columnId: z.string(),
  operator: z.enum(["eq", "contains"]),
  value: z.unknown(),
});

// Sorting schema for table view
const sortingSchema = z.object({
  columnId: z.string(),
  order: z.enum(["asc", "desc"]),
});

// Pagination schema for table view
const paginationSchema = z.object({
  page: z.number().min(1).default(1),
  pageSize: z.number().min(1).max(100).default(20),
});

export const scenarioRouter = createTRPCRouter({
  // Get scenario sets data for a project
  getScenarioSetsData: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
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
    .query(async ({ input }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getRunDataForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
      });
      return data;
    }),

  // Get filtered scenario runs for table view
  getFilteredScenarioRuns: protectedProcedure
    .input(
      projectSchema.extend({
        filters: z.array(filterSchema).optional(),
        sorting: sortingSchema.optional(),
        pagination: paginationSchema.optional(),
        search: z.string().optional(),
        includeTraces: z.boolean().default(false),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const scenarioRunnerService = new ScenarioEventService();
      return await scenarioRunnerService.getFilteredScenarioRuns({
        projectId: input.projectId,
        filters: input.filters,
        sorting: input.sorting,
        pagination: input.pagination,
        search: input.search,
        includeTraces: input.includeTraces,
      });
    }),

  // Get available metadata keys for dynamic columns
  getAvailableMetadataKeys: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const scenarioRunnerService = new ScenarioEventService();
      return await scenarioRunnerService.getAvailableMetadataKeys({
        projectId: input.projectId,
      });
    }),

  // Get filter options for enum columns
  getFilterOptions: protectedProcedure
    .input(
      projectSchema.extend({
        columnId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const scenarioRunnerService = new ScenarioEventService();
      return await scenarioRunnerService.getFilterOptions({
        projectId: input.projectId,
        columnId: input.columnId,
      });
    }),

  // Export scenarios as CSV
  exportScenariosCsv: protectedProcedure
    .input(
      projectSchema.extend({
        filters: z.array(filterSchema).optional(),
        columns: z.array(z.string()),
        includeTraces: z.boolean().default(false),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .mutation(async ({ input }) => {
      const scenarioRunnerService = new ScenarioEventService();
      return await scenarioRunnerService.exportScenariosCsv({
        projectId: input.projectId,
        filters: input.filters,
        columns: input.columns,
        includeTraces: input.includeTraces,
      });
    }),
});
