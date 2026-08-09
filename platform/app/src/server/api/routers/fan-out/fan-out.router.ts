/**
 * tRPC router for Fan Scenarios batch review, dispatch, and reporting.
 * Generation itself is a Hono route (POST /api/scenario/fan-out/generate),
 * matching scenario-generate.ts's precedent for an LLM-calling endpoint.
 *
 * See specs/scenarios/adjacent-scenario-review.feature and
 * specs/scenarios/adjacent-scenario-blast-radius.feature.
 */

import type { PrismaClient } from "@prisma/client";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { FanOutReportService } from "~/server/app-layer/fan-out/fan-out-report.service";
import { FanOutReviewService } from "~/server/app-layer/fan-out/fan-out-review.service";
import { FanOutRunService } from "~/server/app-layer/fan-out/fan-out-run.service";
import { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { checkProjectPermission } from "../../rbac";

const projectSchema = z.object({ projectId: z.string() });
const batchSchema = projectSchema.extend({ batchId: z.string() });

function reviewService(prisma: PrismaClient): FanOutReviewService {
  return FanOutReviewService.create({
    fanOutRepository: new FanOutRepository(prisma),
    scenarioRepository: new ScenarioRepository(prisma),
  });
}

export const fanOutRouter = createTRPCRouter({
  getBatch: protectedProcedure
    .input(batchSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      return reviewService(ctx.prisma).getBatchForReview({
        projectId: input.projectId,
        batchId: input.batchId,
      });
    }),

  decide: protectedProcedure
    .input(
      batchSchema.extend({
        decisions: z
          .array(
            z.object({
              variantId: z.string(),
              decision: z.enum(["approve", "reject"]),
            }),
          )
          .min(1),
      }),
    )
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      return reviewService(ctx.prisma).decide({
        projectId: input.projectId,
        batchId: input.batchId,
        decisions: input.decisions,
        decidedById: ctx.session.user.id,
      });
    }),

  run: protectedProcedure
    .input(batchSchema)
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const service = FanOutRunService.create({
        queueSimulationRun: getApp().simulations.queueRun,
        fanOutRepository: new FanOutRepository(ctx.prisma),
        scenarioRepository: new ScenarioRepository(ctx.prisma),
      });

      return service.dispatchBatch({
        projectId: input.projectId,
        batchId: input.batchId,
      });
    }),

  report: protectedProcedure
    .input(batchSchema)
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const service = FanOutReportService.create({
        simulationRuns: getApp().simulations.runs,
        fanOutRepository: new FanOutRepository(ctx.prisma),
      });

      return service.getReportForBatch({
        projectId: input.projectId,
        batchId: input.batchId,
      });
    }),
});
