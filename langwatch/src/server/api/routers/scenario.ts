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

  // Get all run data for a scenario set
  getScenarioSetRunData: protectedProcedure
    .input(projectSchema.extend({ scenarioSetId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.SCENARIOS_VIEW))
    .query(async ({ input, ctx }) => {
      const scenarioRunnerService = new ScenarioRunnerService();
      const data = await scenarioRunnerService.getRunDataForScenarioSet({
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
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Scenario run not found",
        });
      }
      return data;
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
