import { z } from "zod";
import { defineLangyTool } from "../defineLangyTool";
import type { LangyConversationContext } from "./types";

export function makeSearchPastRuns(ctx: LangyConversationContext) {
  return defineLangyTool({
    name: "search_past_runs",
    description:
      "Search past evaluation runs (BatchEvaluation) for this project, optionally filtered by experiment slug, ordered by recency.",
    inputSchema: z.object({
      experimentSlug: z.string().optional(),
      limit: z.number().int().min(1).max(20).default(10),
    }),
    outputSchema: z.object({
      items: z.array(
        z.object({
          id: z.string(),
          experimentId: z.string(),
          createdAt: z.date(),
          status: z.string(),
          score: z.number(),
          passed: z.boolean(),
          evaluation: z.string(),
        }),
      ),
      error: z.string().optional(),
    }),
    execute: async ({ experimentSlug, limit }) => {
      let experimentId: string | undefined;
      if (experimentSlug) {
        const experiment = await ctx.experimentService.findBySlug({
          projectId: ctx.projectId,
          slug: experimentSlug,
        });
        if (!experiment) return { items: [], error: "experiment not found" };
        experimentId = experiment.id;
      }
      const rows = await ctx.batchEvaluationService.getRecentByExperiment({
        projectId: ctx.projectId,
        experimentId,
        limit,
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
