import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { prisma } from "../../db";
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
import { checkUserPermissionForProject, TeamRoleGroup } from "../permission";
import { createTRPCRouter, protectedProcedure } from "../trpc";

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
            "workflow_version_id",
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

      const versionIds = dspySteps.hits.hits
        .map((hit) => {
          return hit._source!.workflow_version_id!;
        })
        .filter(Boolean);

      const versionsMap = await getVersionMap(input.projectId, versionIds);

      const result: DSPyRunsSummary[] = (
        dspySteps.aggregations!.runs as any
      ).buckets
        .map((bucket: any) => {
          const steps = dspySteps.hits.hits.filter(
            (hit) => hit._source!.run_id === bucket.key
          );
          const versionId = steps.filter(
            (step) => step._source!.workflow_version_id
          )[0]?._source!.workflow_version_id;

          return {
            runId: bucket.key,
            workflow_version: versionId ? versionsMap[versionId] : null,
            steps: steps
              .map((hit) => {
                const source = hit._source!;
                const llmCalls = source.llm_calls ?? [];

                return {
                  run_id: source.run_id,
                  index: source.index,
                  score: source.score,
                  label: source.label,
                  optimizer: {
                    name: source.optimizer.name,
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
                    created_at: source.timestamps.created_at,
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
        "run_id" | "workflow_version_id" | "timestamps" | "total"
      >;

      const batchEvaluationRuns =
        await esClient.search<ESBatchEvaluationRunInfo>({
          index: BATCH_EVALUATION_INDEX.alias,
          size: 10_000,
          body: {
            _source: [
              "run_id",
              "workflow_version_id",
              "timestamps.created_at",
              "timestamps.updated_at",
              "timestamps.finished_at",
              "timestamps.stopped_at",
              "total",
            ],
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
                    nested: {
                      path: "evaluations",
                    },
                    aggs: {
                      cost: {
                        sum: {
                          field: "evaluations.cost",
                        },
                      },
                    },
                  },
                  dataset_average_cost: {
                    avg: {
                      field: "dataset.cost",
                    },
                  },
                  dataset_average_duration: {
                    avg: {
                      field: "dataset.duration",
                    },
                  },
                  evaluations: {
                    nested: {
                      path: "evaluations",
                    },
                    aggs: {
                      child: {
                        terms: { field: "evaluations.evaluator", size: 100 },
                        aggs: {
                          name: {
                            terms: { field: "evaluations.name", size: 100 },
                          },
                          processed_evaluations: {
                            filter: {
                              term: { "evaluations.status": "processed" },
                            },
                            aggs: {
                              average_score: {
                                avg: {
                                  field: "evaluations.score",
                                },
                              },
                              has_passed: {
                                filter: {
                                  bool: {
                                    should: [
                                      { term: { "evaluations.passed": true } },
                                      { term: { "evaluations.passed": false } },
                                    ],
                                  },
                                },
                              },
                              average_passed: {
                                avg: {
                                  field: "evaluations.passed",
                                },
                              },
                            },
                          },
                        },
                      },
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

      const versionsMap = await getVersionMap(input.projectId, versionIds);

      const runs = batchEvaluationRuns.hits.hits.map((hit) => {
        const source = hit._source!;

        const runAgg = (
          batchEvaluationRuns.aggregations!.runs as any
        ).buckets.find((bucket: any) => bucket.key === source.run_id);

        return {
          run_id: source.run_id,
          workflow_version: source.workflow_version_id
            ? versionsMap[source.workflow_version_id]
            : null,
          timestamps: source.timestamps,
          total: source.total,
          summary: {
            cost: runAgg?.dataset_cost.value + runAgg?.evaluations_cost.cost.value,
            dataset_average_cost: runAgg?.dataset_average_cost.value,
            dataset_average_duration: runAgg?.dataset_average_duration.value,
            evaluations: Object.fromEntries(
              runAgg?.evaluations.child.buckets.map((bucket: any) => {
                return [
                  bucket.key,
                  {
                    name: bucket.name.buckets[0].key ?? bucket.key,
                    average_score:
                      bucket.processed_evaluations.average_score.value,
                    ...(bucket.processed_evaluations.has_passed.doc_count > 0
                      ? {
                          average_passed:
                            bucket.processed_evaluations.average_passed.value,
                        }
                      : {}),
                  },
                ];
              })
            ) as Record<
              string,
              {
                name: string;
                average_score: number;
                average_passed?: number;
              }
            >,
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

const getVersionMap = async (projectId: string, versionIds: string[]) => {
  const versions = await prisma.workflowVersion.findMany({
    where: {
      projectId: projectId,
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

  return versionsMap;
};
