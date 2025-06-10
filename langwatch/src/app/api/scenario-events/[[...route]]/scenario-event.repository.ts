import { scenarioEventSchema, scenarioMessageSnapshotSchema } from "./schemas";
import { ScenarioEventType } from "./enums";
import type {
  ScenarioEvent,
  ScenarioMessageSnapshotEvent,
  ScenarioRunFinishedEvent,
  ScenarioBatch,
} from "./types";
import { Client as ElasticClient } from "@elastic/elasticsearch";
import { z } from "zod";
import { esClient } from "~/server/elasticsearch";

const projectIdSchema = z.string();
const scenarioRunIdSchema = z.string();
const batchRunIdSchema = z.string();
const scenarioIdSchema = z.string();

export class ScenarioEventRepository {
  private readonly indexName = "scenario-events";
  private client: ElasticClient | null = null;

  async saveEvent({
    projectId,
    ...event
  }: ScenarioEvent & { projectId: string }) {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedEvent = scenarioEventSchema.parse(event);

    const client = await this.getClient();

    await client.index({
      index: this.indexName,
      body: {
        ...validatedEvent,
        projectId: validatedProjectId,
        timestamp: validatedEvent.timestamp || Date.now(),
      },
    });
  }

  async getLatestMessageSnapshotEventByScenarioRunId({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioMessageSnapshotEvent | undefined> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioRunId = scenarioRunIdSchema.parse(scenarioRunId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { term: { scenarioRunId: validatedScenarioRunId } },
              { term: { type: ScenarioEventType.MESSAGE_SNAPSHOT } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    return response.hits.hits[0]?._source as ScenarioMessageSnapshotEvent;
  }

  async getLatestRunFinishedEventByScenarioRunId({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunFinishedEvent | undefined> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioRunId = scenarioRunIdSchema.parse(scenarioRunId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { term: { scenarioRunId: validatedScenarioRunId } },
              { term: { type: ScenarioEventType.RUN_FINISHED } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    return response.hits.hits[0]?._source as ScenarioRunFinishedEvent;
  }

  async getAllScenarioRunsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          term: { projectId: validatedProjectId },
        },
        aggs: {
          unique_runs: {
            terms: {
              field: "scenarioRunId",
            },
          },
        },
        size: 0,
      },
    });

    return (
      (
        response.aggregations?.unique_runs as {
          buckets: Array<{ key: string }>;
        }
      )?.buckets?.map((bucket) => bucket.key) ?? []
    );
  }

  async getAllRunEventsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ScenarioEvent[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          term: { projectId: validatedProjectId },
        },
        sort: [{ timestamp: "desc" }],
      },
    });

    return response.hits.hits.map((hit) => hit._source as ScenarioEvent);
  }

  async deleteAllEvents({ projectId }: { projectId: string }): Promise<void> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    await client.deleteByQuery({
      index: this.indexName,
      body: {
        query: {
          term: { projectId: validatedProjectId },
        },
      },
    });
  }

  /**
   * Fetches all batch runs for a project, sorted by the most recent run time (descending).
   * Sorting is done at the aggregation level using order on the 'last_run' sub-aggregation.
   */
  async getAllBatchRunsForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<Array<ScenarioBatch>> {
    const validatedProjectId = projectIdSchema.parse(projectId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          term: { projectId: validatedProjectId },
        },
        aggs: {
          unique_batches: {
            terms: {
              field: "batchRunId",
              order: { last_run: "desc" }, // Sort by last_run (timestamp) descending
            },
            aggs: {
              scenario_count: {
                cardinality: {
                  field: "scenarioRunId",
                },
              },
              last_run: {
                max: {
                  field: "timestamp",
                },
              },
              success_count: {
                filter: {
                  term: { status: "SUCCESS" },
                },
              },
            },
          },
        },
        size: 0,
      },
    });

    // Map and return the results, already sorted by last_run descending
    return (
      (
        response.aggregations?.unique_batches as {
          buckets: Array<{
            key: string;
            scenario_count: { value: number };
            last_run: { value: number };
            success_count: { doc_count: number };
          }>;
        }
      )?.buckets?.map((bucket) => ({
        batchRunId: bucket.key,
        scenarioCount: bucket.scenario_count.value,
        lastRunAt: new Date(bucket.last_run.value),
        successRate:
          bucket.scenario_count.value > 0
            ? Math.round(
                (bucket.success_count.doc_count / bucket.scenario_count.value) *
                  100
              )
            : 0,
      })) ?? []
    );
  }

  async getScenarioRunIdsForBatch({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedBatchRunId = batchRunIdSchema.parse(batchRunId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { term: { batchRunId: validatedBatchRunId } },
            ],
          },
        },
        aggs: {
          unique_runs: {
            terms: {
              field: "scenarioRunId",
            },
          },
        },
        size: 0,
      },
    });

    return (
      (
        response.aggregations?.unique_runs as {
          buckets: Array<{ key: string }>;
        }
      )?.buckets?.map((bucket) => bucket.key) ?? []
    );
  }

  async getScenarioRunFinishedEventsByScenarioId({
    projectId,
    scenarioId,
  }: {
    projectId: string;
    scenarioId: string;
  }): Promise<ScenarioRunFinishedEvent[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioId = scenarioIdSchema.parse(scenarioId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { term: { scenarioId: validatedScenarioId } },
              { term: { type: ScenarioEventType.RUN_FINISHED } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 100,
      },
    });

    return response.hits.hits.map(
      (hit) => hit._source as ScenarioRunFinishedEvent
    );
  }

  async getScenarioRunIdsForScenario({
    projectId,
    scenarioId,
  }: {
    projectId: string;
    scenarioId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioId = scenarioIdSchema.parse(scenarioId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { term: { scenarioId: validatedScenarioId } },
            ],
          },
        },
        aggs: {
          unique_runs: {
            terms: {
              field: "scenarioRunId",
            },
          },
        },
        size: 0,
      },
    });

    return (
      (
        response.aggregations?.unique_runs as {
          buckets: Array<{ key: string }>;
        }
      )?.buckets?.map((bucket) => bucket.key) ?? []
    );
  }

  /**
   * Gets all scenario sets data for a project with aggregated metadata.
   *
   * Returns set information including:
   * - Unique scenario count per set (distinct scenarioId values)
   * - Latest run timestamp across all scenarios in each set
   * - Success rate calculated from finished scenario runs
   *
   * Optimized using Elasticsearch aggregations to minimize data transfer
   * and compute statistics server-side rather than in application memory.
   *
   * @param projectId - The project identifier to filter sets by
   * @returns Promise resolving to array of scenario set metadata objects
   */
  async getScenarioSetsDataForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<
    {
      batchRunId: string;
      scenarioCount: number;
      lastRunAt: number;
    }[]
  > {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { exists: { field: "scenarioSetId" } }, // Only events that are part of a scenario set
            ],
          },
        },
        aggs: {
          // Group by scenario set ID to get each unique set
          scenario_sets: {
            terms: {
              field: "scenarioSetId",
              size: 1000, // Reasonable limit for scenario sets per project
            },
            aggs: {
              // Count unique scenarios within each set
              unique_scenario_count: {
                cardinality: {
                  field: "scenarioId",
                },
              },
              // Get the latest timestamp across all events in this set
              latest_run_timestamp: {
                max: {
                  field: "timestamp",
                },
              },
              // Calculate success rate from finished runs only
              finished_runs: {
                filter: {
                  term: { type: "scenario_run_finished" },
                },
                aggs: {
                  total_runs: {
                    value_count: {
                      field: "scenarioRunId",
                    },
                  },
                  successful_runs: {
                    filter: {
                      term: { "results.success": true },
                    },
                  },
                },
              },
            },
          },
        },
        size: 0, // We only need aggregation results, not individual documents
      },
    });

    const setBuckets =
      (
        response.aggregations?.scenario_sets as {
          buckets: Array<{
            key: string;
            unique_scenario_count: { value: number };
            latest_run_timestamp: { value: number };
            finished_runs: {
              total_runs: { value: number };
              successful_runs: { doc_count: number };
            };
          }>;
        }
      )?.buckets ?? [];

    return setBuckets.map((bucket) => {
      return {
        batchRunId: bucket.key, // Using existing interface property name for scenarioSetId
        scenarioCount: bucket.unique_scenario_count.value,
        lastRunAt: bucket.latest_run_timestamp.value,
      };
    });
  }

  /**
   * Gets or creates a cached Elasticsearch client for test environment.
   * Avoids recreating the client on every operation for better performance.
   */
  private async getClient(): Promise<ElasticClient> {
    if (!this.client) {
      this.client = await esClient({ test: true });
    }

    return this.client;
  }
}
