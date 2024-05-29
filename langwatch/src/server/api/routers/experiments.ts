import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { TRPCError } from "@trpc/server";
import { DSPY_STEPS_INDEX, esClient } from "../../elasticsearch";
import type {
  DSPyRunsSummary,
  DSPyStep,
  DSPyStepSummary,
} from "../../experiments/types";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../../db";

export const experimentsRouter = createTRPCRouter({
  getExperimentBySlug: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      return experiment;
    }),

  getExperimentDSPyRuns: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const dspySteps = await esClient.search<DSPyStep>({
        index: DSPY_STEPS_INDEX,
        size: 10_000,
        body: {
          query: {
            bool: {
              must: [
                { term: { experiment_id: experiment.id } },
                { term: { project_id: input.projectId } },
              ] as QueryDslBoolQuery["must"],
            } as QueryDslBoolQuery,
          },
          sort: [{ index: "asc" }],
          _source: [
            "run_id",
            "index",
            "score",
            "label",
            "optimizer.name",
            "llm_calls.completion_tokens",
            "llm_calls.prompt_tokens",
            "llm_calls.cost",
            "timestamps.created_at",
          ],
          aggs: {
            runs: {
              terms: { field: "run_id", size: 1_000 },
            },
          },
        },
      });

      const result: DSPyRunsSummary[] = (
        dspySteps.aggregations!.runs as any
      ).buckets
        .map((bucket: any) => {
          const steps = dspySteps.hits.hits.filter(
            (hit) => hit._source!.run_id === bucket.key
          );

          return {
            runId: bucket.key,
            steps: steps.map((hit) => {
              const llmCalls = hit._source!.llm_calls ?? [];

              return {
                run_id: hit._source!.run_id,
                index: hit._source!.index,
                score: hit._source!.score,
                label: hit._source!.label,
                optimizer: {
                  name: hit._source!.optimizer.name,
                },
                llm_calls_summary: {
                  total: llmCalls.length,
                  total_tokens: llmCalls.reduce(
                    (acc, curr) =>
                      acc +
                      (curr.completion_tokens ?? 0) +
                      (curr.prompt_tokens ?? 0),
                    0
                  ),
                  total_cost: llmCalls.reduce(
                    (acc, curr) => acc + (curr?.cost ?? 0),
                    0
                  ),
                },
                timestamps: {
                  created_at: hit._source!.timestamps.created_at,
                },
              } as DSPyStepSummary;
            }),
            created_at: Math.min(
              ...steps.map((hit) => hit._source!.timestamps.created_at)
            ),
          };
        })
        .sort(
          (a: DSPyRunsSummary, b: DSPyRunsSummary) =>
            b.created_at - a.created_at
        );

      return result;
    }),

  getExperimentDSPyStep: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
        runId: z.string(),
        index: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const dspyStep = await esClient.search<DSPyStep>({
        index: DSPY_STEPS_INDEX,
        size: 10_000,
        body: {
          query: {
            bool: {
              must: [
                { term: { experiment_id: experiment.id } },
                { term: { project_id: input.projectId } },
                { term: { run_id: input.runId } },
                { term: { index: input.index } },
              ] as QueryDslBoolQuery["must"],
            } as QueryDslBoolQuery,
          },
        },
      });

      const result = dspyStep.hits.hits[0];
      if (!result?._source) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "DSPy step not found",
        });
      }

      return result._source;
    }),
});

const getExperimentBySlug = async (
  projectId: string,
  experimentSlug: string
) => {
  const experiment = await prisma.experiment.findFirst({
    where: {
      projectId: projectId,
      slug: experimentSlug,
    },
  });

  if (!experiment) {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: "Experiment not found",
    });
  }

  return experiment;
};
