/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, archive, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { ValidationError } from "@langwatch/handled-error";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { runNoteSchema, runParameterValuesSchema } from "@langwatch/scenario-contract";
import type { SuiteRunSummary } from "@langwatch/scenario-contract";
import {
  SuiteNotFoundError,
  SuiteScopeNotAllowedError,
  SUITE_KINDS,
  tryExtractSuiteId,
} from "@langwatch/suite-contract";
import { folderRouter } from "./folder.router";
import { createSuiteSchema, projectSchema, suiteTargetSchema, updateSuiteSchema } from "./schemas";

export const suiteRouter = createTRPCRouter({
  folders: folderRouter,

  create: protectedProcedure
    .input(createSuiteSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.create(input);
    }),

  // The kinds default is "custom" inside the service: v1 callers name no
  // kind and must never receive folder rows. v2 callers name what they want.
  getAll: protectedProcedure
    .input(
      projectSchema.extend({
        kinds: z.array(z.enum(SUITE_KINDS)).min(1).optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const kinds = input.kinds ?? ["custom"];
      const [suites, folders] = await Promise.all([
        kinds.includes("custom")
          ? ctx.app.suites.list({ projectId: input.projectId })
          : Promise.resolve([]),
        kinds.includes("folder")
          ? ctx.app.scenarios.listFolders({ projectId: input.projectId })
          : Promise.resolve([]),
      ]);

      return [...suites, ...folders].sort(
        (left, right) => right.updatedAt.getTime() - left.updatedAt.getTime(),
      );
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      try {
        return await ctx.app.suites.get(input);
      } catch (error) {
        if (!(error instanceof SuiteNotFoundError)) throw error;
      }

      const folder = await ctx.app.scenarios.tryGetFolder({
        folderId: input.id,
        projectId: input.projectId,
      });
      if (!folder) throw new SuiteNotFoundError(input.id);
      return folder;
    }),

  update: protectedProcedure
    .input(updateSuiteSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const folder = await ctx.app.scenarios.tryGetFolder({
        folderId: input.id,
        projectId: input.projectId,
      });
      if (folder) {
        if (input.scope !== undefined) {
          throw new SuiteScopeNotAllowedError();
        }
        if (input.scenarioIds !== undefined) {
          throw new ValidationError(
            "A folder's scenarios are managed by filing scenarios into it",
            {
              meta: {
                fieldErrors: {
                  scenarioIds: ["A folder's scenarios are managed by filing scenarios into it"],
                },
              },
            },
          );
        }

        const {
          id,
          projectId,
          name,
          description,
          targets,
          repeatCount,
          labels,
          simulatorModel,
          judgeModel,
        } = input;
        return ctx.app.scenarios.updateFolder({
          name,
          description,
          targets,
          repeatCount,
          labels,
          simulatorModel,
          judgeModel,
          projectId,
          folderId: id,
        });
      }
      return ctx.app.suites.update(input);
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.duplicate(input);
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      return ctx.app.suites.archive(input);
    }),

  resolveArchivedNames: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        scenarioIds: z.array(z.string()),
        targets: z.array(suiteTargetSchema),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const project = await ctx.app.projects.tryGetWithTeam(input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }
      return ctx.app.suites.resolveArchivedNames({
        ...input,
        organizationId: project.team.organizationId,
      });
    }),

  run: protectedProcedure
    .input(
      projectSchema.extend({
        id: z.string(),
        idempotencyKey: z.string(),
        /** Optional client-generated batch run ID for immediate placeholder feedback */
        batchRunId: z.string().optional(),
        /**
         * Constant values applied to every scenario in the run. A value
         * supplied here overrides the scenario's own default for that name.
         */
        parameters: runParameterValuesSchema.optional(),
        /**
         * One short line describing why this batch was run, stamped onto every
         * run of the batch.
         */
        note: runNoteSchema,
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const project = await ctx.app.projects.tryGetWithTeam(input.projectId);
      if (!project) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }

      // No catch: a Suite execution error is a HandledError, so the tRPC
      // handled-error middleware maps its code and status. Wrapping it in an
      // INTERNAL_SERVER_ERROR here would drop the `cause` the middleware keys
      // off, turning "every scenario is archived" — a customer-fault 422 the
      // UI has a specific recovery action for — into an opaque 500.
      const result = await ctx.app.suites.run({
        id: input.id,
        projectId: input.projectId,
        organizationId: project.team.organizationId,
        idempotencyKey: input.idempotencyKey,
        batchRunId: input.batchRunId,
        parameters: input.parameters,
        note: input.note,
      });

      return {
        scheduled: true,
        ...result,
      };
    }),

  /**
   * Runs every non-archived test case of the project through the managed
   * "All test cases" suite (created on first use, refreshed at each run).
   */
  runAll: protectedProcedure
    .input(
      projectSchema.extend({
        idempotencyKey: z.string(),
        /** Optional client-generated batch run ID for immediate placeholder feedback */
        batchRunId: z.string().optional(),
        /** Targets chosen in the run dialog; persisted for the next run's preselect. */
        targets: z.array(suiteTargetSchema).optional(),
        parameters: runParameterValuesSchema.optional(),
        note: runNoteSchema,
      }),
    )
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const projectRepository = new ProjectRepository(ctx.prisma);
      const organizationId = await projectRepository.getOrganizationId({
        projectId: input.projectId,
      });
      if (!organizationId) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Organization not found for project",
        });
      }
      const result = await ctx.app.suites.runAll({
        projectId: input.projectId,
        organizationId,
        idempotencyKey: input.idempotencyKey,
        batchRunId: input.batchRunId,
        targets: input.targets,
        parameters: input.parameters,
        note: input.note,
      });
      return {
        scheduled: true,
        ...result,
      };
    }),

  getSummaries: protectedProcedure
    .input(
      projectSchema.extend({
        startDate: z.number().int().nonnegative().optional(),
        endDate: z.number().int().nonnegative().optional(),
      }),
    )
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const startDate = input.startDate ?? Date.now() - THIRTY_DAYS_MS;
      const endDate = input.endDate ?? Date.now();

      const summaries = await ctx.app.simulations.getInternalSuiteSummaries({
        projectId: input.projectId,
        startDate,
        endDate,
      });

      const result: Record<string, SuiteRunSummary> = {};
      for (const summary of summaries) {
        const suiteId = tryExtractSuiteId(summary.scenarioSetId);
        if (!suiteId) continue;
        result[suiteId] = {
          passedCount: summary.passedCount,
          failedCount: summary.failedCount,
          totalCount: summary.totalCount,
          lastRunTimestamp: summary.lastRunTimestamp,
        };
      }
      return result;
    }),
});
