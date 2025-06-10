import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { ScenarioRunnerService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";

// Base schema for all project-related operations
const projectSchema = z.object({
  projectId: z.string(),
});

export const scenarioRouter = createTRPCRouter({
  // Get scenario sets data for a project
  getScenarioSetsData: protectedProcedure
    .input(projectSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const data = await scenarioRunnerService.getScenarioSetsDataForProject({
        projectId: input.projectId,
      });
      return data;
    }),

  // OLD ROUTES
  // Get scenario run state
  getRunState: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioRunId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const data = await scenarioRunnerService.getScenarioRunData({
        projectId: input.projectId,
        scenarioRunId: input.scenarioRunId,
      });
      if (!data) {
        throw new Error("Scenario run not found");
      }
      return data;
    }),

  // Get scenario run history
  getRunHistory: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const { results } = await scenarioRunnerService.getScenarioResultsHistory(
        {
          projectId: input.projectId,
          scenarioId: input.scenarioId,
        }
      );
      return { results };
    }),

  // Get all scenario runs
  getAllRuns: protectedProcedure
    .input(projectSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const ids = await scenarioRunnerService.getScenarioRunIds({
        projectId: input.projectId,
      });
      return { ids };
    }),

  // Get all batch runs
  getAllBatchRuns: protectedProcedure
    .input(projectSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const batches = await scenarioRunnerService.getAllBatchRunsForProject({
        projectId: input.projectId,
      });
      return { batches };
    }),

  // Get scenario runs for a batch
  getRunsForBatch: protectedProcedure
    .input(
      projectSchema.extend({
        batchRunId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const ids = await scenarioRunnerService.getScenarioRunIdsForBatch({
        projectId: input.projectId,
        batchRunId: input.batchRunId,
      });
      return { ids };
    }),

  // Get scenario run data for a batch
  getBatchRunData: protectedProcedure
    .input(
      projectSchema.extend({
        batchRunId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const data = await scenarioRunnerService.getScenarioRunDataForBatch({
        projectId: input.projectId,
        batchRunId: input.batchRunId,
      });
      return { data: data ?? [] };
    }),

  // Get all events
  getAllEvents: protectedProcedure
    .input(projectSchema)
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const events = await scenarioRunnerService.getAllRunEventsForProject({
        projectId: input.projectId,
      });
      return { events };
    }),

  // Get scenario run data by scenario id
  getRunDataByScenarioId: protectedProcedure
    .input(
      projectSchema.extend({
        scenarioId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const data = await scenarioRunnerService.getScenarioRunDataByScenarioId({
        projectId: input.projectId,
        scenarioId: input.scenarioId,
      });
      return { data };
    }),
});
