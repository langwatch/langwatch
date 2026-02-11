import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import type { PrismaClient } from "@prisma/client";
import { TRPCError } from "@trpc/server";
import { getLangWatchTracer } from "langwatch";
import { prisma as defaultPrisma } from "~/server/db";
import {
  BATCH_EVALUATION_INDEX,
  batchEvaluationId,
  esClient,
} from "~/server/elasticsearch";
import type { ESBatchEvaluation } from "~/server/experiments/types";
import { createLogger } from "~/utils/logger/server";
import { getVersionMap } from "./getVersionMap";
import type { ESRunAggregationBucket } from "./mappers";
import {
  mapEsBatchEvaluationToRunWithItems,
  mapEsRunToExperimentRun,
} from "./mappers";
import type { ExperimentRun, ExperimentRunWithItems } from "./types";

/**
 * Elasticsearch backend for experiment run queries.
 *
 * This service extracts the ES query logic previously inline in the
 * experiments tRPC router into a reusable service class.
 */
export class ElasticsearchExperimentRunService {
  private readonly logger = createLogger(
    "langwatch:experiment-runs:elasticsearch-service",
  );
  private readonly tracer = getLangWatchTracer(
    "langwatch.experiment-runs.elasticsearch-service",
  );

  constructor(readonly prisma: PrismaClient) {}

  /**
   * Static factory method for creating the service with default dependencies.
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
  ): ElasticsearchExperimentRunService {
    return new ElasticsearchExperimentRunService(prisma);
  }

  /**
   * List experiment runs for one or more experiments.
   *
   * Returns runs grouped by experiment ID, with per-evaluator breakdown
   * and workflow version metadata.
   */
  async listRuns({
    projectId,
    experimentIds,
  }: {
    projectId: string;
    experimentIds: string[];
  }): Promise<Record<string, ExperimentRun[]>> {
    return this.tracer.withActiveSpan(
      "ElasticsearchExperimentRunService.listRuns",
      {
        attributes: {
          "tenant.id": projectId,
          "experiment.count": experimentIds.length,
        },
      },
      async () => {
        if (experimentIds.length === 0) {
          return {};
        }

        this.logger.debug(
          { projectId, experimentIdCount: experimentIds.length },
          "Listing experiment runs from Elasticsearch",
        );

        type ESBatchEvaluationRunInfo = Pick<
          ESBatchEvaluation,
          | "experiment_id"
          | "run_id"
          | "workflow_version_id"
          | "timestamps"
          | "progress"
          | "total"
        >;

        const client = await esClient({ projectId });
        const batchEvaluationRuns =
          await client.search<ESBatchEvaluationRunInfo>({
            index: BATCH_EVALUATION_INDEX.alias,
            size: 10_000,
            body: {
              _source: [
                "experiment_id",
                "run_id",
                "workflow_version_id",
                "timestamps.created_at",
                "timestamps.updated_at",
                "timestamps.finished_at",
                "timestamps.stopped_at",
                "progress",
                "total",
              ],
              query: {
                bool: {
                  must: [
                    { terms: { experiment_id: experimentIds } },
                    { term: { project_id: projectId } },
                  ] as QueryDslBoolQuery["must"],
                } as QueryDslBoolQuery,
              },
              sort: [{ "timestamps.created_at": "desc" }],
              aggs: {
                runs: {
                  terms: { field: "run_id", size: 1_000 },
                  aggs: {
                    dataset_cost: {
                      sum: { field: "dataset.cost" },
                    },
                    evaluations_cost: {
                      nested: { path: "evaluations" },
                      aggs: {
                        cost: { sum: { field: "evaluations.cost" } },
                        average_cost: { avg: { field: "evaluations.cost" } },
                        average_duration: {
                          avg: { field: "evaluations.duration" },
                        },
                      },
                    },
                    dataset_average_cost: {
                      avg: { field: "dataset.cost" },
                    },
                    dataset_average_duration: {
                      avg: { field: "dataset.duration" },
                    },
                    evaluations: {
                      nested: { path: "evaluations" },
                      aggs: {
                        child: {
                          terms: {
                            field: "evaluations.evaluator",
                            size: 100,
                          },
                          aggs: {
                            name: {
                              terms: {
                                field: "evaluations.name",
                                size: 100,
                              },
                            },
                            processed_evaluations: {
                              filter: {
                                term: { "evaluations.status": "processed" },
                              },
                              aggs: {
                                average_score: {
                                  avg: { field: "evaluations.score" },
                                },
                                has_passed: {
                                  filter: {
                                    bool: {
                                      should: [
                                        {
                                          term: {
                                            "evaluations.passed": true,
                                          },
                                        },
                                        {
                                          term: {
                                            "evaluations.passed": false,
                                          },
                                        },
                                      ],
                                    },
                                  },
                                },
                                average_passed: {
                                  avg: { field: "evaluations.passed" },
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
          .map((hit) => hit._source?.workflow_version_id)
          .filter((id): id is string => Boolean(id));

        const versionsMap = await getVersionMap({
          prisma: this.prisma,
          projectId,
          versionIds,
        });

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const aggBuckets = (batchEvaluationRuns.aggregations?.runs as any)
          ?.buckets as ESRunAggregationBucket[] | undefined;

        const result: Record<string, ExperimentRun[]> = {};

        for (const hit of batchEvaluationRuns.hits.hits) {
          const source = hit._source!;

          const runAgg = aggBuckets?.find(
            (bucket) => bucket.key === source.run_id,
          );

          const workflowVersion = source.workflow_version_id
            ? (versionsMap[source.workflow_version_id] ?? null)
            : null;

          const run = mapEsRunToExperimentRun(source, runAgg, workflowVersion);

          if (!(run.experimentId in result)) {
            result[run.experimentId] = [];
          }
          result[run.experimentId]!.push(run);
        }

        this.logger.debug(
          {
            projectId,
            hitCount: batchEvaluationRuns.hits.hits.length,
            experimentCount: Object.keys(result).length,
          },
          "Successfully listed experiment runs from Elasticsearch",
        );

        return result;
      },
    );
  }

  /**
   * Get a single experiment run with all its items (dataset entries and evaluations).
   *
   * Includes retry logic (3 attempts with 1s delay) for eventual consistency.
   *
   * @throws TRPCError NOT_FOUND if the run is not found after retries
   */
  async getRun({
    projectId,
    experimentId,
    runId,
  }: {
    projectId: string;
    experimentId: string;
    runId: string;
  }): Promise<ExperimentRunWithItems> {
    return this.tracer.withActiveSpan(
      "ElasticsearchExperimentRunService.getRun",
      {
        attributes: {
          "tenant.id": projectId,
          "run.id": runId,
          "experiment.id": experimentId,
        },
      },
      async () => {
        this.logger.debug(
          { projectId, experimentId, runId },
          "Fetching experiment run from Elasticsearch",
        );

        const id = batchEvaluationId({
          projectId,
          experimentId,
          runId,
        });

        const client = await esClient({ projectId });
        let source: ESBatchEvaluation | undefined;
        let attempts = 0;

        while (attempts < 3) {
          const searchResult = await client.search<ESBatchEvaluation>({
            index: BATCH_EVALUATION_INDEX.alias,
            body: {
              query: {
                term: { _id: id },
              },
            },
            size: 1,
          });

          attempts++;

          source = searchResult.hits.hits[0]?._source ?? undefined;
          if (source) {
            break;
          }

          await new Promise((resolve) => setTimeout(resolve, 1_000));
        }

        if (!source) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "Batch evaluation run not found",
          });
        }

        const result = mapEsBatchEvaluationToRunWithItems(source);

        this.logger.debug(
          {
            projectId,
            runId,
            datasetCount: result.dataset.length,
            evaluationCount: result.evaluations.length,
          },
          "Successfully fetched experiment run from Elasticsearch",
        );

        return result;
      },
    );
  }

}
