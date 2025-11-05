import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../rbac";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";

// Base schema for all project-related operations
const projectSchema = z.object({
  projectId: z.string(),
});

/**
 * Scenario Router - Handles all scenario-related API endpoints
 *
 * ## Terminology:
 * - **Scenario Set**: A collection of related scenarios that are executed together
 * - **Batch**: A single execution instance of a scenario set (one "run" of all scenarios in the set)
 * - **Batch Run**: The execution data and results from running a batch
 * - **Scenario Run**: Individual scenario execution within a batch (one scenario's execution data)
 * - **Run State**: The current status and data of a scenario run (pending, running, completed, failed)
 */
export const scenarioRouter = createTRPCRouter({
  /**
   * Get all scenario sets for a project
   *
   * Returns high-level information about all scenario sets in the project,
   * including metadata like creation date, number of scenarios, etc.
   *
   * @param projectId - The project to get scenario sets for
   * @returns Array of scenario set metadata
   */
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

  /**
   * Get paginated run data for a scenario set
   *
   * Returns batch run data (execution results) for a specific scenario set.
   * Each item represents one batch execution of the scenario set.
   * Use this for paginated loading of batch runs.
   *
   * @param projectId - The project containing the scenario set
   * @param scenarioSetId - The scenario set to get batch runs for
   * @param limit - Maximum number of batch runs to return (1-100, default 20)
   * @param cursor - Pagination cursor for getting next page of results
   * @returns Paginated array of batch run data with execution results
   */
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

  /**
   * Get ALL run data for a scenario set without pagination
   *
   * Returns all batch run data for a scenario set without pagination limits.
   * Use with caution for scenario sets with many batch runs as this can return large datasets.
   * Each item represents one complete batch execution of the scenario set.
   *
   * @param projectId - The project containing the scenario set
   * @param scenarioSetId - The scenario set to get all batch runs for
   * @returns Complete array of all batch run data for the scenario set
   */
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

  /**
   * Get the current run state of a specific scenario run
   *
   * Returns detailed execution state and data for an individual scenario run.
   * The run state includes:
   * - Execution status (pending, running, completed, failed)
   * - Input parameters used for the scenario
   * - Output results (if completed)
   * - Error information (if failed)
   * - Execution timestamps and duration
   *
   * @param projectId - The project containing the scenario
   * @param scenarioRunId - The specific scenario run to get state for
   * @returns Complete run state data for the scenario run
   * @throws NOT_FOUND if the scenario run doesn't exist
   */
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

  /**
   * Get the total count of batch runs for a scenario set
   *
   * Returns the total number of batch executions that have been performed
   * for a specific scenario set. Useful for pagination calculations and
   * displaying total execution history.
   *
   * @param projectId - The project containing the scenario set
   * @param scenarioSetId - The scenario set to count batch runs for
   * @returns Object containing the total count of batch runs
   */
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

  /**
   * Get scenario run data by scenario ID
   *
   * Retrieves execution data for all runs of a specific scenario across
   * all batches. This gives you the execution history for a single scenario
   * definition, showing how it performed across different batch executions.
   *
   * @param projectId - The project containing the scenario
   * @param scenarioId - The scenario definition to get run data for
   * @returns Object containing array of run data for all executions of this scenario
   */
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

  /**
   * Get scenario run data for a specific batch run
   *
   * Returns all individual scenario runs that were executed as part of
   * a specific batch run. A batch run contains multiple scenario runs
   * (one for each scenario in the scenario set). This gives you the
   * detailed execution results for all scenarios in a single batch execution.
   *
   * @param projectId - The project containing the scenario set
   * @param scenarioSetId - The scenario set that was executed
   * @param batchRunId - The specific batch execution to get scenario runs for
   * @returns Array of scenario run data for all scenarios executed in this batch
   */
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

  /**
   * Get lightweight scenario run IDs for a specific batch run (OPTIMIZED)
   *
   * Returns only scenario run IDs for all scenario runs in a batch.
   * This is a performance-optimized alternative to getBatchRunData when you only
   * need IDs and don't require the full run data (messages, results, status, etc.).
   *
   * Use this endpoint when:
   * - Rendering lists/grids where individual components will fetch their own details
   * - You need to poll frequently for run IDs without heavy data transfer
   *
   * Results are pre-sorted by timestamp (oldest first) for consistent ordering.
   *
   * @param projectId - The project containing the scenario set
   * @param scenarioSetId - The scenario set that was executed
   * @param batchRunId - The specific batch execution to get scenario run IDs for
   * @returns Array of scenario run IDs (strings)
   */
  getScenarioRunIdsForBatchRun: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioSetId: z.string(),
        batchRunId: z.string(),
      }),
    )
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ input }) => {
      const scenarioRunnerService = new ScenarioEventService();
      const data = await scenarioRunnerService.getScenarioRunIdsForBatchRun({
        projectId: input.projectId,
        scenarioSetId: input.scenarioSetId,
        batchRunId: input.batchRunId,
      });
      return data;
    }),

  /**
   * Get all run states for a specific batch run (BATCH OPTIMIZED)
   *
   * Returns complete run data (messages, status, results) for all scenario runs in a batch.
   * This is optimized for batch fetching - single query returns all runs at once rather than
   * N individual queries. Use this when rendering a grid that needs all run data upfront.
   *
   * Includes:
   * - Execution status (pending, running, completed, failed)
   * - Messages array for each run
   * - Results (if completed)
   * - Timestamps and metadata
   *
   * Returns data as a map (Record) for O(1) lookups by scenarioRunId.
   *
   * @param projectId - The project containing the scenario set
   * @param scenarioSetId - The scenario set that was executed
   * @param batchRunId - The specific batch execution to get all run states for
   * @returns Map of scenarioRunId to complete run state data
   */
  getBatchRunStatesByBatchRunId: protectedProcedure
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

      // Convert array to map for O(1) lookups by scenarioRunId
      const runStatesMap = data.reduce(
        (acc, runData) => {
          acc[runData.scenarioRunId] = runData;
          return acc;
        },
        {} as Record<string, (typeof data)[0]>,
      );

      return runStatesMap;
    }),
});
