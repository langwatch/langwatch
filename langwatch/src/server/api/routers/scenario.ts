import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ScenarioEventService } from "~/app/api/scenario-events/[[...route]]/scenario-event.service";
import { ScenarioService } from "~/server/scenarios/scenario.service";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { checkProjectPermission } from "../rbac";

// Base schema for all project-related operations
const projectSchema = z.object({
  projectId: z.string(),
});

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

const runScenarioSchema = projectSchema.extend({
  scenarioId: z.string(),
  promptId: z.string(),
});

/**
 * TODO: Split the router into scenario crud and scenario events.
 */
export const scenarioRouter = createTRPCRouter({
  // ============================================================================
  // SCENARIO CRUD
  // ============================================================================

  create: protectedProcedure
    .input(createScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = ScenarioService.create(ctx.prisma);
      return service.create({
        ...input,
        lastUpdatedById: ctx.session.user.id,
      });
    }),

  getAll: protectedProcedure
    .input(projectSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = ScenarioService.create(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = ScenarioService.create(ctx.prisma);
      const scenario = await service.getById(input);
      if (!scenario) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Scenario not found" });
      }
      return scenario;
    }),

  update: protectedProcedure
    .input(updateScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const { id, projectId, ...data } = input;
      const service = ScenarioService.create(ctx.prisma);
      return service.update(id, projectId, {
        ...data,
        lastUpdatedById: ctx.session.user.id,
      });
    }),

  /**
   * Run a scenario against a prompt target.
   * Returns immediately with setId for redirect; execution is async.
   */
  run: protectedProcedure
    .input(runScenarioSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const setId = "local-scenarios";

      // TODO: Wire up ScenarioRunnerService with PromptConfigAdapter
      // For now, just return the setId for redirect
      // void runnerService.execute({ scenarioId: input.scenarioId, promptId: input.promptId, setId });

      return { setId };
    }),

  // ============================================================================
  // SCENARIO EVENTS (existing)
  // ============================================================================

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
