/**
 * tRPC router for simulation suite configurations.
 *
 * Provides CRUD, duplicate, archive, and run endpoints.
 */

import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { PrismaClient } from "~/generated/prisma/client";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { ProjectRepository } from "~/server/projects/project.repository";
import { runParameterValuesSchema } from "~/server/scenarios/parameters";
import { runNoteSchema } from "~/server/scenarios/run-note";
import type { SuiteRunSummary } from "~/server/scenarios/scenario-event.types";
import { SuiteService } from "~/server/suites/suite.service";
import { extractSuiteId } from "~/server/suites/suite-set-id";
import { SUITE_KINDS } from "~/server/suites/types";
import { folderRouter } from "./folder.router";
import {
  createSuiteSchema,
  projectSchema,
  suiteTargetSchema,
  updateSuiteSchema,
} from "./schemas";

function createSuiteService(prisma: PrismaClient) {
  return SuiteService.create({
    prisma,
    suiteRunService: getApp().suiteRuns.runs,
  });
}

export const suiteRouter = createTRPCRouter({
  folders: folderRouter,

  create: protectedProcedure
    .input(createSuiteSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      return service.create(input);
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
      const service = createSuiteService(ctx.prisma);
      return service.getAll(input);
    }),

  getById: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:view")
    .query(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return suite;
    }),

  update: protectedProcedure
    .input(updateSuiteSchema)
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const { id, projectId, ...data } = input;
      const service = createSuiteService(ctx.prisma);
      return service.update({ id, projectId, data });
    }),

  duplicate: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      // Validate source suite exists before checking limits — avoids masking NOT_FOUND with a limit error
      const source = await service.getById(input);
      if (!source) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Suite not found" });
      }
      // A SuiteDomainError is a HandledError — left to propagate so the tRPC
      // handled-error middleware maps its code and status, instead of
      // flattening every suite failure into one NOT_FOUND with prose.
      return await service.duplicate(input);
    }),

  archive: protectedProcedure
    .input(projectSchema.extend({ id: z.string() }))
    .permission("scenarios:manage")
    .mutation(async ({ ctx, input }) => {
      const service = createSuiteService(ctx.prisma);
      const result = await service.archive(input);
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }
      return result;
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
      const service = createSuiteService(ctx.prisma);
      return service.resolveArchivedNames({
        ...input,
        organizationId,
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
      const service = createSuiteService(ctx.prisma);
      const suite = await service.getById(input);
      if (!suite) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Suite not found",
        });
      }

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

      // No catch: a SuiteDomainError is a HandledError, so the tRPC
      // handled-error middleware maps its code and status. Wrapping it in an
      // INTERNAL_SERVER_ERROR here would drop the `cause` the middleware keys
      // off, turning "every scenario is archived" — a customer-fault 422 the
      // UI has a specific recovery action for — into an opaque 500.
      const result = await service.run({
        suite,
        projectId: input.projectId,
        organizationId,
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
   * Runs every non-archived scenario of the project through the managed
   * "All scenarios" suite (created on first use, refreshed at each run).
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
      const service = createSuiteService(ctx.prisma);
      const result = await service.runAll({
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
    .query(async ({ input }) => {
      const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;
      const startDate = input.startDate ?? Date.now() - THIRTY_DAYS_MS;
      const endDate = input.endDate ?? Date.now();

      const simulationRuns = getApp().simulations.runs;
      const summaries = await simulationRuns.getInternalSuiteSummaries({
        projectId: input.projectId,
        startDate,
        endDate,
      });

      const result: Record<string, SuiteRunSummary> = {};
      for (const summary of summaries) {
        const suiteId = extractSuiteId(summary.scenarioSetId);
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
