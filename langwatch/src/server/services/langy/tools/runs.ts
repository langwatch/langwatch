import { tool } from "ai";
import { z } from "zod";
import type { LangyToolContext } from "./types";

export function makeSearchPastRuns(ctx: LangyToolContext) {
  return tool({
    description:
      "Search past evaluation runs (BatchEvaluation) for this project, optionally filtered by experiment slug, ordered by recency.",
    inputSchema: z.object({
      experimentSlug: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    execute: async ({ experimentSlug, limit }) => {
      const where: Record<string, unknown> = { projectId: ctx.projectId };
      if (experimentSlug) {
        const exp = await ctx.prisma.experiment.findFirst({
          where: { projectId: ctx.projectId, slug: experimentSlug },
          select: { id: true },
        });
        if (!exp) return { items: [], error: "experiment not found" };
        where.experimentId = exp.id;
      }
      const rows = await ctx.prisma.batchEvaluation.findMany({
        where,
        orderBy: { createdAt: "desc" },
        take: limit,
        select: {
          id: true,
          experimentId: true,
          createdAt: true,
          status: true,
          score: true,
          passed: true,
          evaluation: true,
        },
      });
      return {
        items: rows.map((r) => ({
          id: r.id,
          experimentId: r.experimentId,
          createdAt: r.createdAt,
          status: r.status,
          score: r.score,
          passed: r.passed,
          evaluation: r.evaluation,
        })),
      };
    },
  });
}
