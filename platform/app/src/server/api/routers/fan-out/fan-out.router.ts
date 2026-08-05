/**
 * tRPC router for Fan Scenarios batch review, dispatch, and reporting.
 * Generation itself is a Hono route (POST /api/scenario/fan-out/generate),
 * matching scenario-generate.ts's precedent for an LLM-calling endpoint.
 *
 * See specs/scenarios/adjacent-scenario-review.feature and
 * specs/scenarios/adjacent-scenario-blast-radius.feature.
 */

import type { FanOutVariant } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "~/server/api/trpc";
import { getApp } from "~/server/app-layer/app";
import { FanOutReportService } from "~/server/app-layer/fan-out/fan-out-report.service";
import { FanOutRunService } from "~/server/app-layer/fan-out/fan-out-run.service";
import type { FanOutTarget } from "~/server/scenarios/fan-out/fan-out-generation.service";
import { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { checkProjectPermission } from "../../rbac";

const projectSchema = z.object({ projectId: z.string() });

function isFanOutTarget(value: unknown): value is FanOutTarget {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "referenceId" in value
  );
}

export const fanOutRouter = createTRPCRouter({
  getBatch: protectedProcedure
    .input(projectSchema.extend({ batchId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const repository = new FanOutRepository(ctx.prisma);
      const batch = await repository.findBatchById({
        id: input.batchId,
        projectId: input.projectId,
      });
      if (!batch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fan-out batch not found" });
      }
      return batch;
    }),

  decide: protectedProcedure
    .input(
      projectSchema.extend({
        batchId: z.string(),
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
      const fanOutRepository = new FanOutRepository(ctx.prisma);
      const scenarioRepository = new ScenarioRepository(ctx.prisma);

      const variants = await fanOutRepository.findVariantsByIds({
        ids: input.decisions.map((d) => d.variantId),
        batchId: input.batchId,
      });
      const variantById = new Map(variants.map((v) => [v.id, v]));

      const results: FanOutVariant[] = [];
      for (const { variantId, decision } of input.decisions) {
        const variant = variantById.get(variantId);
        if (!variant) continue;

        const status = decision === "approve" ? "APPROVED" : "REJECTED";
        const updated = await fanOutRepository.updateVariantStatus({
          id: variantId,
          status,
          decidedById: ctx.session.user.id,
        });
        results.push(updated);

        if (decision === "reject") {
          await scenarioRepository.archive({
            id: variant.scenarioId,
            projectId: input.projectId,
          });
        }
      }

      return { updated: results };
    }),

  run: protectedProcedure
    .input(projectSchema.extend({ batchId: z.string() }))
    .use(checkProjectPermission("scenarios:manage"))
    .mutation(async ({ ctx, input }) => {
      const fanOutRepository = new FanOutRepository(ctx.prisma);
      const batch = await fanOutRepository.findBatchById({
        id: input.batchId,
        projectId: input.projectId,
      });
      if (!batch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fan-out batch not found" });
      }

      const approvedVariants = batch.variants.filter((v) => v.status === "APPROVED");
      if (approvedVariants.length === 0) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No approved variants to run",
        });
      }

      if (!isFanOutTarget(batch.seedTarget)) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Fan-out batch is missing a valid target",
        });
      }

      const scenarioRepository = new ScenarioRepository(ctx.prisma);
      const variantScenarios = await Promise.all(
        approvedVariants.map((v) =>
          scenarioRepository.findByIdIncludingArchived({
            id: v.scenarioId,
            projectId: input.projectId,
          }),
        ),
      );
      const variantNames = new Map<string, string>();
      for (const scenario of variantScenarios) {
        if (scenario) variantNames.set(scenario.id, scenario.name);
      }

      let seedName: string | undefined;
      if (batch.seedScenarioId) {
        const seedScenario = await scenarioRepository.findByIdIncludingArchived({
          id: batch.seedScenarioId,
          projectId: input.projectId,
        });
        seedName = seedScenario?.name;
      }

      const runService = FanOutRunService.create({
        queueSimulationRun: getApp().simulations.queueRun,
      });

      const result = await runService.startRun({
        projectId: input.projectId,
        scenarioSetId: batch.scenarioSetId,
        seedScenarioId: batch.seedScenarioId,
        seedName,
        target: batch.seedTarget,
        approvedVariants,
        variantNames,
      });

      await fanOutRepository.updateBatchStatus({
        id: batch.id,
        projectId: input.projectId,
        status: "DISPATCHING",
        batchRunId: result.batchRunId,
      });

      return result;
    }),

  report: protectedProcedure
    .input(projectSchema.extend({ batchId: z.string() }))
    .use(checkProjectPermission("scenarios:view"))
    .query(async ({ ctx, input }) => {
      const fanOutRepository = new FanOutRepository(ctx.prisma);
      const batch = await fanOutRepository.findBatchById({
        id: input.batchId,
        projectId: input.projectId,
      });
      if (!batch) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Fan-out batch not found" });
      }
      if (!batch.batchRunId) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Fan-out batch has not been run yet",
        });
      }

      const reportService = FanOutReportService.create({
        simulationRuns: getApp().simulations.runs,
      });

      return reportService.getBlastRadiusReport({
        projectId: input.projectId,
        scenarioSetId: batch.scenarioSetId,
        batchRunId: batch.batchRunId,
        seedScenarioRunId: batch.seedScenarioRunId,
        variants: batch.variants,
      });
    }),
});
