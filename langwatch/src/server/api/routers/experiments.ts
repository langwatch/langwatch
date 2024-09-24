import { z } from "zod";
import { createTRPCRouter, protectedProcedure } from "../trpc";
import { TeamRoleGroup, checkUserPermissionForProject } from "../permission";
import { TRPCError } from "@trpc/server";
import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  DSPY_STEPS_INDEX,
  esClient,
} from "../../elasticsearch";
import type {
  DSPyRunsSummary,
  DSPyStep,
  DSPyStepSummary,
  ESBatchEvaluation,
} from "../../experiments/types";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { prisma } from "../../db";
import type { WorkflowVersion } from "@prisma/client";

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

  getAllByProjectId: protectedProcedure
    .input(z.object({ projectId: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiments = await prisma.experiment.findMany({
        where: {
          projectId: input.projectId,
        },
      });

      return experiments;
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
        index: DSPY_STEPS_INDEX.alias,
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
            steps: steps
              .map((hit) => {
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
              })
              .sort(
                (a, b) => a.timestamps.created_at - b.timestamps.created_at
              ),
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
        index: DSPY_STEPS_INDEX.alias,
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

  getExperimentBatchEvaluationRuns: protectedProcedure
    .input(z.object({ projectId: z.string(), experimentSlug: z.string() }))
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      type ESBatchEvaluationRunInfo = Pick<
        ESBatchEvaluation,
        "run_id" | "workflow_version_id" | "timestamps"
      >;

      const batchEvaluationRuns =
        await esClient.search<ESBatchEvaluationRunInfo>({
          index: BATCH_EVALUATION_INDEX.alias,
          size: 10_000,
          body: {
            _source: ["run_id", "workflow_version_id", "timestamps.created_at"],
            query: {
              bool: {
                must: [
                  { term: { experiment_id: experiment.id } },
                  { term: { project_id: input.projectId } },
                ] as QueryDslBoolQuery["must"],
              } as QueryDslBoolQuery,
            },
            sort: [{ "timestamps.created_at": "desc" }],
            aggs: {
              runs: {
                terms: { field: "run_id", size: 1_000 },
                aggs: {
                  dataset_cost: {
                    sum: {
                      field: "dataset.cost",
                    },
                  },
                  evaluations_cost: {
                    sum: {
                      field: "evaluations.cost",
                    },
                  },
                },
              },
            },
          },
        });

      const versionIds = batchEvaluationRuns.hits.hits
        .map((hit) => {
          return hit._source!.workflow_version_id!;
        })
        .filter(Boolean);

      const versions = await prisma.workflowVersion.findMany({
        where: {
          projectId: input.projectId,
          id: {
            in: versionIds,
          },
        },
        select: {
          id: true,
          version: true,
          commitMessage: true,
          author: {
            select: {
              name: true,
              image: true,
            },
          },
        },
      });

      const versionsMap = versions.reduce(
        (acc, version) => {
          acc[version.id] = version;
          return acc;
        },
        {} as Record<string, (typeof versions)[number]>
      );

      const runs = batchEvaluationRuns.hits.hits.map((hit) => {
        const source = hit._source!;

        const runAgg = (
          batchEvaluationRuns.aggregations!.runs as any
        ).buckets.find((bucket: any) => bucket.key === source.run_id);

        return {
          run_id: hit._source!.run_id,
          workflow_version: versionsMap[hit._source!.workflow_version_id!],
          created_at: hit._source!.timestamps.created_at,
          summary: {
            cost: runAgg?.dataset_cost.value + runAgg?.evaluations_cost.value,
          },
        };
      });

      return { runs };
    }),

  getExperimentBatchEvaluationRun: protectedProcedure
    .input(
      z.object({
        projectId: z.string(),
        experimentSlug: z.string(),
        runId: z.string(),
      })
    )
    .use(checkUserPermissionForProject(TeamRoleGroup.EXPERIMENTS_MANAGE))
    .query(async ({ input }) => {
      const experiment = await getExperimentBySlug(
        input.projectId,
        input.experimentSlug
      );

      const id = batchEvaluationId({
        projectId: input.projectId,
        experimentId: experiment.id,
        runId: input.runId,
      });

      const batchEvaluationRun = await esClient.get<ESBatchEvaluation>({
        index: BATCH_EVALUATION_INDEX.alias,
        id: id,
      });

      const result = batchEvaluationRun._source;
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Batch evaluation run not found",
        });
      }

      return result;
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
