import { scenarioEventSchema } from "./schemas";
import { ScenarioEventType, Verdict } from "./enums";
import type {
  ScenarioEvent,
  ScenarioMessageSnapshotEvent,
  ScenarioRunFinishedEvent,
  ScenarioSetData,
  ScenarioRunStartedEvent,
} from "./types";
import { Client as ElasticClient } from "@elastic/elasticsearch";
import { z } from "zod";
import { esClient } from "~/server/elasticsearch";
import {
  transformToElasticsearch,
  transformFromElasticsearch,
  ES_FIELDS,
} from "./utils/elastic-search-transformers";

const projectIdSchema = z.string();
const scenarioRunIdSchema = z.string();
const scenarioIdSchema = z.string();

/**
 * Repository class for managing scenario events in Elasticsearch.
 * Handles CRUD operations and complex queries for scenario events, including:
 * - Individual scenario events
 * - Scenario runs
 * - Scenario sets
 * - Batch runs
 *
 * All operations are scoped to a specific project for data isolation.
 * Uses Elasticsearch for efficient querying and aggregation of event data.
 */
export class ScenarioEventRepository {
  private readonly indexName = "scenario-events";
  private client: ElasticClient | null = null;

  /**
   * Saves a scenario event to Elasticsearch.
   * Validates the project ID and event data before saving.
   * Automatically adds timestamp if not provided.
   *
   * @param event - The scenario event to save, including project ID
   * @throws {z.ZodError} If validation fails for projectId or event data
   */
  async saveEvent({
    projectId,
    ...event
  }: ScenarioEvent & { projectId: string }) {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedEvent = scenarioEventSchema.parse(event);

    const client = await this.getClient();

    // Transform to Elasticsearch format before saving
    const elasticsearchEvent = transformToElasticsearch({
      ...validatedEvent,
      projectId: validatedProjectId,
      timestamp: validatedEvent.timestamp || Date.now(),
    });

    await client.index({
      index: this.indexName,
      body: elasticsearchEvent,
    });
  }

  /**
   * Retrieves the most recent message snapshot event for a specific scenario run.
   * Used to get the latest state of a conversation in a scenario run.
   *
   * @param projectId - The project identifier
   * @param scenarioRunId - The scenario run identifier
   * @returns The latest message snapshot event or undefined if none exists
   * @throws {z.ZodError} If validation fails for projectId or scenarioRunId
   */
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
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunId } },
              { term: { type: ScenarioEventType.MESSAGE_SNAPSHOT } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    const rawResult = response.hits.hits[0]?._source as
      | Record<string, unknown>
      | undefined;

    return rawResult
      ? (transformFromElasticsearch(rawResult) as ScenarioMessageSnapshotEvent)
      : undefined;
  }

  /**
   * Retrieves the most recent run finished event for a specific scenario run.
   * Used to determine if and how a scenario run completed.
   *
   * @param projectId - The project identifier
   * @param scenarioRunId - The scenario run identifier
   * @returns The latest run finished event or undefined if the run hasn't finished
   * @throws {z.ZodError} If validation fails for projectId or scenarioRunId
   */
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
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunId } },
              { term: { type: ScenarioEventType.RUN_FINISHED } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    const rawResult = response.hits.hits[0]?._source;
    return rawResult
      ? (transformFromElasticsearch(rawResult) as ScenarioRunFinishedEvent)
      : undefined;
  }

  /**
   * Deletes all events associated with a project.
   * This is a destructive operation that cannot be undone.
   *
   * @param projectId - The project identifier
   * @throws {z.ZodError} If validation fails for projectId
   */
  async deleteAllEvents({ projectId }: { projectId: string }): Promise<void> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    await client.deleteByQuery({
      index: this.indexName,
      body: {
        query: {
          term: { [ES_FIELDS.projectId]: validatedProjectId },
        },
      },
    });
  }

  /**
   * Retrieves all scenario run IDs associated with a specific scenario.
   * Used to track the history of runs for a particular scenario.
   *
   * @param projectId - The project identifier
   * @param scenarioId - The scenario identifier
   * @returns Array of scenario run IDs, ordered by most recent first
   * @throws {z.ZodError} If validation fails for projectId or scenarioId
   */
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
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioId]: validatedScenarioId } },
            ],
          },
        },
        aggs: {
          unique_runs: {
            terms: {
              field: ES_FIELDS.scenarioRunId,
              size: 10000,
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
   * Example response:
   * ```typescript
   * [
   *   {
   *     scenarioSetId: "set-123",
   *     scenarioCount: 5,
   *     lastRunAt: 1678901234567
   *   }
   * ]
   * ```
   *
   * Optimized using Elasticsearch aggregations to minimize data transfer
   * and compute statistics server-side rather than in application memory.
   *
   * @param projectId - The project identifier to filter sets by
   * @returns Promise resolving to array of scenario set metadata objects
   * @throws {z.ZodError} If validation fails for projectId
   */
  async getScenarioSetsDataForProject({
    projectId,
  }: {
    projectId: string;
  }): Promise<ScenarioSetData[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { exists: { field: ES_FIELDS.scenarioSetId } }, // Only events that are part of a scenario set
            ],
          },
        },
        aggs: {
          // Group by scenario set ID to get each unique set
          scenario_sets: {
            terms: {
              field: ES_FIELDS.scenarioSetId,
              size: 1000, // Reasonable limit for scenario sets per project
            },
            aggs: {
              // Count unique scenarios within each set
              unique_scenario_count: {
                cardinality: {
                  field: ES_FIELDS.scenarioId,
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
                      field: ES_FIELDS.scenarioRunId,
                    },
                  },
                  successful_runs: {
                    filter: {
                      term: { "results.verdict": Verdict.SUCCESS },
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
        scenarioSetId: bucket.key,
        scenarioCount: bucket.unique_scenario_count.value,
        lastRunAt: bucket.latest_run_timestamp.value,
      };
    });
  }

  /**
   * Retrieves all batch run IDs associated with a scenario set.
   * Results are sorted by latest timestamp in descending order.
   *
   * @param projectId - The project identifier
   * @param scenarioSetId - The scenario set identifier
   * @returns Array of batch run IDs, ordered by most recent first
   * @throws {z.ZodError} If validation fails for projectId or scenarioSetId
   */
  async getBatchRunIdsForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioSetId = scenarioIdSchema.parse(scenarioSetId);
    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioSetId]: validatedScenarioSetId } },
              { exists: { field: ES_FIELDS.batchRunId } },
            ],
          },
        },
        aggs: {
          unique_batch_runs: {
            terms: {
              field: ES_FIELDS.batchRunId,
              size: 10000,
              // Sort by latest timestamp to get most recent batch runs first
              order: {
                latest_timestamp: "desc",
              },
            },
            aggs: {
              latest_timestamp: {
                max: {
                  field: "timestamp",
                },
              },
            },
          },
        },
        size: 0,
      },
    });

    return (
      (
        response.aggregations?.unique_batch_runs as {
          buckets: Array<{ key: string }>;
        }
      )?.buckets ?? []
    ).map((bucket) => bucket.key);
  }

  /**
   * Retrieves all scenario run IDs associated with a list of batch runs.
   * Used to find all scenario runs that were part of specific batch executions.
   *
   * @param projectId - The project identifier
   * @param batchRunIds - Array of batch run IDs to search for
   * @returns Array of scenario run IDs
   * @throws {z.ZodError} If validation fails for projectId
   */
  async getScenarioRunIdsForBatchRuns({
    projectId,
    batchRunIds,
  }: {
    projectId: string;
    batchRunIds: string[];
  }): Promise<string[]> {
    if (batchRunIds.length === 0) {
      return [];
    }

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { [ES_FIELDS.projectId]: projectId } },
              { terms: { [ES_FIELDS.batchRunId]: batchRunIds } },
              { exists: { field: ES_FIELDS.scenarioRunId } },
            ],
          },
        },
        aggs: {
          unique_scenario_runs: {
            terms: {
              field: ES_FIELDS.scenarioRunId,
              size: 10000,
            },
          },
        },
        size: 0,
      },
    });

    return (
      (
        response.aggregations?.unique_scenario_runs as {
          buckets: Array<{ key: string }>;
        }
      )?.buckets ?? []
    ).map((bucket) => bucket.key);
  }

  /**
   * Retrieves the run started event for a specific scenario run.
   * Used to get the initial state and configuration of a scenario run.
   *
   * @param projectId - The project identifier
   * @param scenarioRunId - The scenario run identifier
   * @returns The run started event or undefined if not found
   * @throws {z.ZodError} If validation fails for projectId or scenarioRunId
   */
  async getRunStartedEventByScenarioRunId({
    projectId,
    scenarioRunId,
  }: {
    projectId: string;
    scenarioRunId: string;
  }): Promise<ScenarioRunStartedEvent | undefined> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioRunId = scenarioRunIdSchema.parse(scenarioRunId);

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunId } },
              { term: { type: ScenarioEventType.RUN_STARTED } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    const rawResult = response.hits.hits[0]?._source as
      | Record<string, unknown>
      | undefined;

    return rawResult
      ? (transformFromElasticsearch(rawResult) as ScenarioRunStartedEvent)
      : undefined;
  }

  /**
   * Gets or creates a cached Elasticsearch client for test environment.
   * Avoids recreating the client on every operation for better performance.
   *
   * @returns Promise resolving to an Elasticsearch client instance
   * @private
   */
  private async getClient(): Promise<ElasticClient> {
    if (!this.client) {
      this.client = await esClient({ test: true });
    }

    return this.client;
  }
}
