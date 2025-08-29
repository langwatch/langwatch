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
import * as Sentry from "@sentry/nextjs";

const projectIdSchema = z.string();
const scenarioRunIdSchema = z.string();
const scenarioIdSchema = z.string();
const batchRunIdSchema = z.string();

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

    const rawResult = response.hits.hits[0]?._source as
      | Record<string, unknown>
      | undefined;

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
   * Retrieves batch run IDs associated with a scenario set with cursor-based pagination.
   * Results are sorted by latest timestamp in descending order (most recent first).
   *
   * @param projectId - The project identifier
   * @param scenarioSetId - The scenario set identifier
   * @param limit - Maximum number of batch run IDs to return
   * @param cursor - Cursor for pagination (search_after value)
   * @returns Object containing batch run IDs and pagination info
   * @throws {z.ZodError} If validation fails for projectId or scenarioSetId
   */
  async getBatchRunIdsForScenarioSet({
    projectId,
    scenarioSetId,
    limit,
    cursor,
  }: {
    projectId: string;
    scenarioSetId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    batchRunIds: string[];
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioSetId = scenarioIdSchema.parse(scenarioSetId);
    const client = await this.getClient();

    // Validate and clamp the limit to prevent ES result window issues
    const actualLimit = Math.min(limit, 20); // Increased from 20 to 100

    // Parse cursor to get search_after values
    let searchAfter: any[] | undefined;
    if (cursor) {
      try {
        // Try to decode base64 cursor first (new stable format)
        const decodedCursor = Buffer.from(cursor, "base64").toString("utf-8");
        const cursorData = JSON.parse(decodedCursor);

        // Validate cursor shape - expected: sort values from search results
        // These come from Elasticsearch's sort values for the documents
        if (Array.isArray(cursorData) && cursorData.length > 0) {
          searchAfter = cursorData;
        }
      } catch (e) {
        Sentry.captureException({
          message: "Malformed cursor",
          cursor,
          error: e,
        });
        throw new Error(`Malformed cursor: ${cursor}`);
      }
    }

    // Request more items to account for potential deduplication
    // We need to ensure we get enough unique batch runs after deduplication
    const requestSize = Math.max(actualLimit * 5, 1000); // Request 5x the limit or at least 300

    // Use search_after with manual deduplication for reliable pagination
    // This approach is more reliable than collapse with search_after
    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioSetId]: validatedScenarioSetId } },
              { exists: { field: ES_FIELDS.batchRunId } },
            ],
          },
        },
        sort: [
          { timestamp: { order: "desc" } },
          { [ES_FIELDS.batchRunId]: { order: "asc" } }, // Tiebreaker for stable sorting
        ],
        size: requestSize,
        ...(searchAfter && { search_after: searchAfter }),
      },
    });

    const hits = response.hits?.hits ?? [];

    // Manual deduplication by batch run ID, keeping the latest timestamp for each
    const batchRunMap = new Map<
      string,
      { timestamp: number; sort: any[]; hit: any }
    >();

    for (const hit of hits) {
      const source = hit._source as Record<string, any>;
      const batchRunId = source?.batch_run_id as string;
      const timestamp = source?.timestamp as number;

      if (batchRunId && timestamp !== undefined) {
        const existing = batchRunMap.get(batchRunId);
        if (!existing || timestamp > existing.timestamp) {
          // Ensure we have valid sort values for pagination
          const sortValues = hit.sort;
          if (Array.isArray(sortValues) && sortValues.length > 0) {
            batchRunMap.set(batchRunId, {
              timestamp,
              sort: sortValues,
              hit: hit,
            });
          }
        }
      }
    }

    // Convert to array and sort by timestamp descending, then by batch run ID
    const sortedBatchRuns = Array.from(batchRunMap.entries()).sort(
      ([keyA, a], [keyB, b]) => {
        if (b.timestamp !== a.timestamp) {
          return b.timestamp - a.timestamp;
        }
        return String(keyA) < String(keyB)
          ? -1
          : String(keyA) > String(keyB)
          ? 1
          : 0;
      }
    );

    // Determine if there are more results
    // We have more if we got the full requested size from the aggregation
    // OR if we have more unique batch runs than requested
    const hasMore =
      hits.length >= requestSize || sortedBatchRuns.length > actualLimit;

    let nextCursor: string | undefined;

    if (hasMore && sortedBatchRuns.length > actualLimit) {
      // Get the sort values from the extra item in the deduplicated results
      const extraItem = sortedBatchRuns[actualLimit];
      if (extraItem) {
        // Use the sort values from the hit for search_after pagination
        const searchAfterValues = extraItem[1].sort;

        if (
          Array.isArray(searchAfterValues) &&
          searchAfterValues.length > 0 &&
          searchAfterValues.every((val: any) => val !== undefined)
        ) {
          // Encode cursor as base64 for stability and compactness
          nextCursor = Buffer.from(JSON.stringify(searchAfterValues)).toString(
            "base64"
          );
        }
      }
    }

    // Slice to actualLimit before returning
    const batchRunIds = sortedBatchRuns
      .slice(0, actualLimit)
      .map((item: any) => item[0]); // item[0] is the batchRunId key from the Map entry

    return {
      batchRunIds,
      nextCursor,
      hasMore,
    };
  }

  /**
   * Gets the total count of batch runs for a scenario set.
   * Used for pagination calculations.
   *
   * @param projectId - The project identifier
   * @param scenarioSetId - The scenario set identifier
   * @returns Total count of batch runs
   * @throws {z.ZodError} If validation fails for projectId or scenarioSetId
   */
  async getBatchRunCountForScenarioSet({
    projectId,
    scenarioSetId,
  }: {
    projectId: string;
    scenarioSetId: string;
  }): Promise<number> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioSetId = scenarioIdSchema.parse(scenarioSetId);
    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioSetId]: validatedScenarioSetId } },
              { exists: { field: ES_FIELDS.batchRunId } },
            ],
          },
        },
        aggs: {
          unique_batch_run_count: {
            cardinality: {
              field: ES_FIELDS.batchRunId,
            },
          },
        },
        size: 0,
      },
    });

    const count =
      (response.aggregations as any)?.unique_batch_run_count?.value ?? 0;
    return count;
  }

  /**
   * Retrieves all scenario run IDs associated with a specific batch run.
   * Used to find all scenario runs that were part of a specific batch execution.
   *
   * @param projectId - The project identifier
   * @param scenarioSetId - The scenario set identifier
   * @param batchRunId - The specific batch run ID to search for
   * @returns Array of scenario run IDs
   * @throws {z.ZodError} If validation fails for projectId
   */
  async getScenarioRunIdsForBatchRun({
    projectId,
    scenarioSetId,
    batchRunId,
  }: {
    projectId: string;
    scenarioSetId: string;
    batchRunId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioSetId = scenarioIdSchema.parse(scenarioSetId);
    const validatedBatchRunId = batchRunIdSchema.parse(batchRunId);
    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { [ES_FIELDS.scenarioSetId]: validatedScenarioSetId } },
              { term: { [ES_FIELDS.batchRunId]: validatedBatchRunId } },
            ],
          },
        },
        size: 10000, // Large size to get all scenario runs for this batch
        sort: [{ timestamp: { order: "desc" } }],
      },
    });

    const hits = response.hits?.hits ?? [];
    return hits
      .map((hit) => {
        const source = hit._source as Record<string, any>;
        return source?.scenario_run_id as string;
      })
      .filter(Boolean);
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

    // Validate that all batchRunIds are valid strings
    const validBatchRunIds = batchRunIds.filter(
      (id) => typeof id === "string" && id.length > 0
    );
    if (validBatchRunIds.length !== batchRunIds.length) {
      Sentry.captureException({
        message: "Invalid batchRunIds",
        batchRunIds,
      });
    }

    if (validBatchRunIds.length === 0) {
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
              { terms: { [ES_FIELDS.batchRunId]: validBatchRunIds } },
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
   * Retrieves run started events for multiple scenario runs in a single query.
   * Eliminates N+1 query problem by batching multiple scenario run lookups.
   *
   * @param projectId - The project identifier
   * @param scenarioRunIds - Array of scenario run identifiers
   * @returns Map of scenario run ID to run started event
   * @throws {z.ZodError} If validation fails for projectId or scenarioRunIds
   */
  async getRunStartedEventsByScenarioRunIds({
    projectId,
    scenarioRunIds,
  }: {
    projectId: string;
    scenarioRunIds: string[];
  }): Promise<Map<string, ScenarioRunStartedEvent>> {
    if (scenarioRunIds.length === 0) {
      return new Map();
    }

    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioRunIds = Array.from(
      new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id)))
    );

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        track_total_hits: false,
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { terms: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunIds } },
              { term: { type: ScenarioEventType.RUN_STARTED } },
            ],
          },
        },
        aggs: {
          by_scenario_run: {
            terms: {
              field: ES_FIELDS.scenarioRunId,
              size: 1000, // Limit to prevent timeouts
            },
            aggs: {
              latest_event: {
                top_hits: {
                  size: 1,
                  sort: [{ timestamp: "desc" }],
                },
              },
            },
          },
        },
        size: 0, // We only need aggregation results
      },
    });

    const results = new Map<string, ScenarioRunStartedEvent>();

    const buckets =
      (response.aggregations as any)?.by_scenario_run?.buckets ?? [];
    for (const bucket of buckets) {
      const hit = bucket.latest_event.hits.hits[0];
      if (hit) {
        const rawResult = hit._source as Record<string, unknown>;
        if (rawResult) {
          const event = transformFromElasticsearch(
            rawResult
          ) as ScenarioRunStartedEvent;
          const scenarioRunId = event.scenarioRunId;
          results.set(scenarioRunId, event);
        }
      }
    }
    return results;
  }

  /**
   * Retrieves latest message snapshot events for multiple scenario runs in a single query.
   * Eliminates N+1 query problem by batching multiple scenario run lookups.
   *
   * @param projectId - The project identifier
   * @param scenarioRunIds - Array of scenario run identifiers
   * @returns Map of scenario run ID to latest message snapshot event
   * @throws {z.ZodError} If validation fails for projectId or scenarioRunIds
   */
  async getLatestMessageSnapshotEventsByScenarioRunIds({
    projectId,
    scenarioRunIds,
  }: {
    projectId: string;
    scenarioRunIds: string[];
  }): Promise<Map<string, ScenarioMessageSnapshotEvent>> {
    if (scenarioRunIds.length === 0) {
      return new Map();
    }

    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioRunIds = Array.from(
      new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id)))
    );

    const client = await this.getClient();

    const response = await client.search({
      index: this.indexName,
      body: {
        track_total_hits: false,
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { terms: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunIds } },
              { term: { type: ScenarioEventType.MESSAGE_SNAPSHOT } },
            ],
          },
        },
        aggs: {
          by_scenario_run: {
            terms: {
              field: ES_FIELDS.scenarioRunId,
              size: 1000, // Limit to prevent timeouts
            },
            aggs: {
              latest_event: {
                top_hits: {
                  size: 1,
                  sort: [{ timestamp: "desc" }],
                },
              },
            },
          },
        },
        size: 0, // We only need aggregation results
      },
    });

    const results = new Map<string, ScenarioMessageSnapshotEvent>();

    const buckets =
      (response.aggregations as any)?.by_scenario_run?.buckets ?? [];
    for (const bucket of buckets) {
      const hit = bucket.latest_event.hits.hits[0];
      if (hit) {
        const rawResult = hit._source as Record<string, unknown>;
        if (rawResult) {
          const event = transformFromElasticsearch(
            rawResult
          ) as ScenarioMessageSnapshotEvent;
          const scenarioRunId = event.scenarioRunId;
          results.set(scenarioRunId, event);
        }
      }
    }
    return results;
  }

  /**
   * Retrieves latest run finished events for multiple scenario runs in a single query.
   * Eliminates N+1 query problem by batching multiple scenario run lookups.
   *
   * @param projectId - The project identifier
   * @param scenarioRunIds - Array of scenario run identifiers
   * @returns Map of scenario run ID to latest run finished event
   * @throws {z.ZodError} If validation fails for projectId or scenarioRunIds
   */
  async getLatestRunFinishedEventsByScenarioRunIds({
    projectId,
    scenarioRunIds,
  }: {
    projectId: string;
    scenarioRunIds: string[];
  }): Promise<Map<string, ScenarioRunFinishedEvent>> {
    if (scenarioRunIds.length === 0) {
      return new Map();
    }

    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedScenarioRunIds = Array.from(
      new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id)))
    );

    const client = await this.getClient();

    console.log(
      `[DEBUG] Getting latest run finished events for ${validatedScenarioRunIds.length} scenario runs`
    );

    const response = await client.search({
      index: this.indexName,
      body: {
        track_total_hits: false,
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { terms: { [ES_FIELDS.scenarioRunId]: validatedScenarioRunIds } },
              { term: { type: ScenarioEventType.RUN_FINISHED } },
            ],
          },
        },
        aggs: {
          by_scenario_run: {
            terms: {
              field: ES_FIELDS.scenarioRunId,
              size: 1000, // Limit to prevent timeouts
            },
            aggs: {
              latest_event: {
                top_hits: {
                  size: 1,
                  sort: [{ timestamp: "desc" }],
                },
              },
            },
          },
        },
        size: 0, // We only need aggregation results
      },
    });

    const results = new Map<string, ScenarioRunFinishedEvent>();

    const buckets =
      (response.aggregations as any)?.by_scenario_run?.buckets ?? [];
    for (const bucket of buckets) {
      const hit = bucket.latest_event.hits.hits[0];
      if (hit) {
        const rawResult = hit._source as Record<string, unknown>;
        if (rawResult) {
          const event = transformFromElasticsearch(
            rawResult
          ) as ScenarioRunFinishedEvent;
          const scenarioRunId = event.scenarioRunId;
          results.set(scenarioRunId, event);
        }
      }
    }
    return results;
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
