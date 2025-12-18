import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { z } from "zod";
import { esClient, SCENARIO_EVENTS_INDEX, TRACE_INDEX } from "~/server/elasticsearch";
import { captureException } from "~/utils/posthogErrorCapture";
import { ScenarioEventType, Verdict } from "./enums";
import { scenarioEventSchema } from "./schemas";
import { batchRunIdSchema, scenarioRunIdSchema } from "./schemas/event-schemas";
import type {
  ScenarioEvent,
  ScenarioMessageSnapshotEvent,
  ScenarioRunFinishedEvent,
  ScenarioRunStartedEvent,
  ScenarioSetData,
} from "./types";
import {
  ES_FIELDS,
  transformFromElasticsearch,
  transformToElasticsearch,
} from "./utils/elastic-search-transformers";

const projectIdSchema = z.string();
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
    const actualLimit = Math.min(limit, 20);

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
        captureException({
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      },
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
            "base64",
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      (id) => typeof id === "string" && id.length > 0,
    );
    if (validBatchRunIds.length !== batchRunIds.length) {
      captureException({
        message: "Invalid batchRunIds",
        batchRunIds,
      });
    }

    if (validBatchRunIds.length === 0) {
      return [];
    }

    const client = await this.getClient();

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
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
      index: SCENARIO_EVENTS_INDEX.alias,
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
      new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id))),
    );

    const client = await this.getClient();

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
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
            rawResult,
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
      new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id))),
    );

    const client = await this.getClient();

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
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
            rawResult,
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
      new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id))),
    );

    const client = await this.getClient();

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
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
            rawResult,
          ) as ScenarioRunFinishedEvent;
          const scenarioRunId = event.scenarioRunId;
          results.set(scenarioRunId, event);
        }
      }
    }
    return results;
  }

  /**
   * Searches scenario runs with filtering, sorting, and pagination.
   * All operations are performed server-side in Elasticsearch for efficiency.
   *
   * Status filtering requires special handling:
   * - IN_PROGRESS: RUN_STARTED events without a matching RUN_FINISHED event
   * - Other statuses: Query RUN_FINISHED events directly
   *
   * @param projectId - The project identifier
   * @param filters - Array of filter conditions
   * @param sorting - Sort configuration
   * @param pagination - Page and pageSize
   * @param search - Global search query
   * @returns Paginated scenario run data with total count
   */
  async searchScenarioRuns({
    projectId,
    filters,
    sorting,
    pagination,
    search,
  }: {
    projectId: string;
    filters?: Array<{
      columnId: string;
      operator: "eq" | "contains" | "between";
      value?: unknown;
    }>;
    sorting?: { columnId: string; order: "asc" | "desc" };
    pagination?: { page: number; pageSize: number };
    search?: string;
  }): Promise<{
    scenarioRunIds: string[];
    totalCount: number;
  }> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 20;
    const from = (page - 1) * pageSize;

    // Check if we have a status filter
    const statusFilter = filters?.find((f) => f.columnId === "status");
    const nonStatusFilters = filters?.filter((f) => f.columnId !== "status") ?? [];

    // Build sort
    const sortField = sorting
      ? this.mapColumnToField(sorting.columnId) ?? "timestamp"
      : "timestamp";
    const sortOrder = sorting?.order ?? "desc";

    // Status filtering requires different query strategies
    if (statusFilter && statusFilter.value === "IN_PROGRESS") {
      // IN_PROGRESS: Find RUN_STARTED events without a matching RUN_FINISHED event
      return this.searchInProgressRuns({
        projectId: validatedProjectId,
        filters: nonStatusFilters,
        sorting: { field: sortField, order: sortOrder },
        pagination: { from, size: pageSize },
        search,
      });
    } else if (statusFilter) {
      // Other statuses: Query RUN_FINISHED events directly
      return this.searchFinishedRunsByStatus({
        projectId: validatedProjectId,
        status: statusFilter.value as string,
        filters: nonStatusFilters,
        sorting: { field: sortField, order: sortOrder },
        pagination: { from, size: pageSize },
        search,
      });
    }

    // No status filter: Query RUN_STARTED events (default behavior)
    const mustClauses: any[] = [
      { term: { [ES_FIELDS.projectId]: validatedProjectId } },
      { term: { type: ScenarioEventType.RUN_STARTED } },
    ];

    // Add non-status filter clauses
    for (const filter of nonStatusFilters) {
      const fieldMapping = this.mapColumnToField(filter.columnId);
      if (!fieldMapping) continue;

      if (filter.operator === "eq") {
        mustClauses.push({ term: { [fieldMapping]: filter.value } });
      } else if (filter.operator === "contains") {
        mustClauses.push({
          wildcard: {
            [fieldMapping]: `*${String(filter.value).toLowerCase()}*`,
          },
        });
      } else if (filter.operator === "between") {
        // Handle date range filter - value can be:
        // 1. JSON string with { start: ISO string, end: ISO string } (from frontend)
        // 2. Object with { gte: number, lte: number }
        let gte: number | undefined;
        let lte: number | undefined;

        if (typeof filter.value === "string") {
          try {
            const parsed = JSON.parse(filter.value);
            if (parsed.start) gte = new Date(parsed.start).getTime();
            if (parsed.end) lte = new Date(parsed.end).getTime();
          } catch {
            // Invalid JSON, skip filter
          }
        } else {
          const rangeValue = filter.value as { gte?: number; lte?: number };
          gte = rangeValue?.gte;
          lte = rangeValue?.lte;
        }

        if (gte !== undefined || lte !== undefined) {
          mustClauses.push({
            range: {
              [fieldMapping]: {
                ...(gte !== undefined && { gte }),
                ...(lte !== undefined && { lte }),
              },
            },
          });
        }
      }
    }

    // Add global search - includes cross-index trace metadata search
    if (search) {
      // Search trace metadata for matching trace IDs
      const matchingTraceIds = await this.searchTraceMetadataForTraceIds({
        projectId: validatedProjectId,
        search,
      });

      const shouldClauses: any[] = [
        { wildcard: { [ES_FIELDS.scenarioId]: `*${search.toLowerCase()}*` } },
        { wildcard: { "metadata.name": `*${search.toLowerCase()}*` } },
        { wildcard: { [ES_FIELDS.scenarioSetId]: `*${search.toLowerCase()}*` } },
        { wildcard: { [ES_FIELDS.batchRunId]: `*${search.toLowerCase()}*` } },
      ];

      // If we found matching traces, add them to the search
      if (matchingTraceIds.length > 0) {
        // Find scenarioRunIds that have these trace IDs in their messages
        const scenarioRunIdsFromTraces = await this.getScenarioRunIdsFromTraceIds({
          projectId: validatedProjectId,
          traceIds: matchingTraceIds,
        });

        if (scenarioRunIdsFromTraces.length > 0) {
          shouldClauses.push({
            terms: { [ES_FIELDS.scenarioRunId]: scenarioRunIdsFromTraces },
          });
        }
      }

      mustClauses.push({
        bool: {
          should: shouldClauses,
          minimum_should_match: 1,
        },
      });
    }

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            must: mustClauses,
          },
        },
        sort: [{ [sortField]: { order: sortOrder, unmapped_type: "keyword" } }],
        from,
        size: pageSize,
        track_total_hits: true,
      },
    });

    const hits = response.hits?.hits ?? [];
    const totalCount =
      typeof response.hits?.total === "number"
        ? response.hits.total
        : response.hits?.total?.value ?? 0;

    const scenarioRunIds = hits
      .map((hit) => {
        const source = hit._source as Record<string, any>;
        return source?.scenario_run_id as string;
      })
      .filter(Boolean);

    return {
      scenarioRunIds,
      totalCount,
    };
  }

  /**
   * Searches for IN_PROGRESS runs (RUN_STARTED without matching RUN_FINISHED).
   * Uses a terms aggregation to find all finished run IDs, then excludes them.
   */
  private async searchInProgressRuns({
    projectId,
    filters,
    sorting,
    pagination,
    search,
  }: {
    projectId: string;
    filters: Array<{ columnId: string; operator: "eq" | "contains" | "between"; value?: unknown }>;
    sorting: { field: string; order: "asc" | "desc" };
    pagination: { from: number; size: number };
    search?: string;
  }): Promise<{ scenarioRunIds: string[]; totalCount: number }> {
    const client = await this.getClient();

    // First, get all scenarioRunIds that have a RUN_FINISHED event
    const finishedResponse = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: projectId } },
              { term: { type: ScenarioEventType.RUN_FINISHED } },
            ],
          },
        },
        aggs: {
          finished_runs: {
            terms: {
              field: ES_FIELDS.scenarioRunId,
              size: 10000,
            },
          },
        },
        size: 0,
      },
    });

    const finishedRunIds = (
      (finishedResponse.aggregations?.finished_runs as { buckets: Array<{ key: string }> })
        ?.buckets ?? []
    ).map((b) => b.key);

    // Now query RUN_STARTED events, excluding those that have finished
    const mustClauses: any[] = [
      { term: { [ES_FIELDS.projectId]: projectId } },
      { term: { type: ScenarioEventType.RUN_STARTED } },
    ];

    const mustNotClauses: any[] = [];
    if (finishedRunIds.length > 0) {
      mustNotClauses.push({
        terms: { [ES_FIELDS.scenarioRunId]: finishedRunIds },
      });
    }

    // Add other filters
    for (const filter of filters) {
      const fieldMapping = this.mapColumnToField(filter.columnId);
      if (!fieldMapping) continue;

      if (filter.operator === "eq") {
        mustClauses.push({ term: { [fieldMapping]: filter.value } });
      } else if (filter.operator === "contains") {
        mustClauses.push({
          wildcard: { [fieldMapping]: `*${String(filter.value).toLowerCase()}*` },
        });
      } else if (filter.operator === "between") {
        let gte: number | undefined;
        let lte: number | undefined;

        if (typeof filter.value === "string") {
          try {
            const parsed = JSON.parse(filter.value);
            if (parsed.start) gte = new Date(parsed.start).getTime();
            if (parsed.end) lte = new Date(parsed.end).getTime();
          } catch {
            // Invalid JSON, skip filter
          }
        } else {
          const rangeValue = filter.value as { gte?: number; lte?: number };
          gte = rangeValue?.gte;
          lte = rangeValue?.lte;
        }

        if (gte !== undefined || lte !== undefined) {
          mustClauses.push({
            range: {
              [fieldMapping]: {
                ...(gte !== undefined && { gte }),
                ...(lte !== undefined && { lte }),
              },
            },
          });
        }
      }
    }

    // Add global search
    if (search) {
      mustClauses.push({
        bool: {
          should: [
            { wildcard: { [ES_FIELDS.scenarioId]: `*${search.toLowerCase()}*` } },
            { wildcard: { "metadata.name": `*${search.toLowerCase()}*` } },
            { wildcard: { [ES_FIELDS.scenarioSetId]: `*${search.toLowerCase()}*` } },
            { wildcard: { [ES_FIELDS.batchRunId]: `*${search.toLowerCase()}*` } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            must: mustClauses,
            must_not: mustNotClauses,
          },
        },
        sort: [{ [sorting.field]: { order: sorting.order } }],
        from: pagination.from,
        size: pagination.size,
        track_total_hits: true,
      },
    });

    const hits = response.hits?.hits ?? [];
    const totalCount =
      typeof response.hits?.total === "number"
        ? response.hits.total
        : response.hits?.total?.value ?? 0;

    const scenarioRunIds = hits
      .map((hit) => {
        const source = hit._source as Record<string, any>;
        return source?.scenario_run_id as string;
      })
      .filter(Boolean);

    return { scenarioRunIds, totalCount };
  }

  /**
   * Searches for runs with a specific finished status (SUCCESS, ERROR, FAILED, CANCELLED).
   * Queries RUN_FINISHED events directly.
   */
  private async searchFinishedRunsByStatus({
    projectId,
    status,
    filters,
    sorting,
    pagination,
    search,
  }: {
    projectId: string;
    status: string;
    filters: Array<{ columnId: string; operator: "eq" | "contains" | "between"; value?: unknown }>;
    sorting: { field: string; order: "asc" | "desc" };
    pagination: { from: number; size: number };
    search?: string;
  }): Promise<{ scenarioRunIds: string[]; totalCount: number }> {
    const client = await this.getClient();

    const mustClauses: any[] = [
      { term: { [ES_FIELDS.projectId]: projectId } },
      { term: { type: ScenarioEventType.RUN_FINISHED } },
      { term: { status: status } },
    ];

    // Add other filters (note: some filters like "name" are on RUN_STARTED, not RUN_FINISHED)
    // For now, we'll add filters that exist on RUN_FINISHED
    for (const filter of filters) {
      // Skip filters that don't exist on RUN_FINISHED events
      if (filter.columnId === "name" || filter.columnId === "description") {
        continue; // These are on RUN_STARTED metadata, not RUN_FINISHED
      }

      const fieldMapping = this.mapColumnToField(filter.columnId);
      if (!fieldMapping) continue;

      if (filter.operator === "eq") {
        mustClauses.push({ term: { [fieldMapping]: filter.value } });
      } else if (filter.operator === "contains") {
        mustClauses.push({
          wildcard: { [fieldMapping]: `*${String(filter.value).toLowerCase()}*` },
        });
      } else if (filter.operator === "between") {
        let gte: number | undefined;
        let lte: number | undefined;

        if (typeof filter.value === "string") {
          try {
            const parsed = JSON.parse(filter.value);
            if (parsed.start) gte = new Date(parsed.start).getTime();
            if (parsed.end) lte = new Date(parsed.end).getTime();
          } catch {
            // Invalid JSON, skip filter
          }
        } else {
          const rangeValue = filter.value as { gte?: number; lte?: number };
          gte = rangeValue?.gte;
          lte = rangeValue?.lte;
        }

        if (gte !== undefined || lte !== undefined) {
          mustClauses.push({
            range: {
              [fieldMapping]: {
                ...(gte !== undefined && { gte }),
                ...(lte !== undefined && { lte }),
              },
            },
          });
        }
      }
    }

    // Add global search (limited to fields on RUN_FINISHED)
    if (search) {
      mustClauses.push({
        bool: {
          should: [
            { wildcard: { [ES_FIELDS.scenarioId]: `*${search.toLowerCase()}*` } },
            { wildcard: { [ES_FIELDS.scenarioSetId]: `*${search.toLowerCase()}*` } },
            { wildcard: { [ES_FIELDS.batchRunId]: `*${search.toLowerCase()}*` } },
          ],
          minimum_should_match: 1,
        },
      });
    }

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            must: mustClauses,
          },
        },
        sort: [{ [sorting.field]: { order: sorting.order } }],
        from: pagination.from,
        size: pagination.size,
        track_total_hits: true,
      },
    });

    const hits = response.hits?.hits ?? [];
    const totalCount =
      typeof response.hits?.total === "number"
        ? response.hits.total
        : response.hits?.total?.value ?? 0;

    const scenarioRunIds = hits
      .map((hit) => {
        const source = hit._source as Record<string, any>;
        return source?.scenario_run_id as string;
      })
      .filter(Boolean);

    return { scenarioRunIds, totalCount };
  }

  /**
   * Maps column IDs to Elasticsearch field names.
   * Note: Some fields like durationInMs don't exist directly in ES and cannot be sorted server-side.
   */
  private mapColumnToField(columnId: string): string | null {
    const fieldMap: Record<string, string> = {
      scenarioId: ES_FIELDS.scenarioId,
      scenarioSetId: ES_FIELDS.scenarioSetId,
      batchRunId: ES_FIELDS.batchRunId,
      scenarioRunId: ES_FIELDS.scenarioRunId,
      name: "metadata.name.keyword", // Use keyword subfield for sorting/aggregations
      status: "status",
      timestamp: "timestamp",
      verdict: "results.verdict",
      // Note: durationInMs is computed from RUN_STARTED and RUN_FINISHED timestamps,
      // so it cannot be sorted server-side in ES. Falls back to timestamp sort.
    };

    // Handle metadata.* columns
    if (columnId.startsWith("metadata.")) {
      return columnId;
    }

    return fieldMap[columnId] ?? null;
  }

  /**
   * Gets unique metadata keys from scenario events.
   * Scans the metadata field to find all unique keys.
   *
   * @param projectId - The project identifier
   * @returns Array of unique metadata keys
   */
  async getUniqueMetadataKeys({
    projectId,
  }: {
    projectId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    // Use a scripted aggregation to get unique metadata keys
    // This queries run_started events which contain metadata
    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { type: ScenarioEventType.RUN_STARTED } },
              { exists: { field: "metadata" } },
            ],
          },
        },
        aggs: {
          metadata_keys: {
            scripted_metric: {
              init_script: "state.keys = new HashSet()",
              map_script: `
                if (doc.containsKey('metadata') && params._source != null && params._source.metadata != null) {
                  for (key in params._source.metadata.keySet()) {
                    state.keys.add(key);
                  }
                }
              `,
              combine_script: "return state.keys",
              reduce_script: `
                def allKeys = new HashSet();
                for (state in states) {
                  if (state != null) {
                    allKeys.addAll(state);
                  }
                }
                return allKeys.toArray();
              `,
            },
          },
        },
        size: 0,
      },
    });

    const keys =
      (response.aggregations as any)?.metadata_keys?.value ?? [];
    return Array.isArray(keys) ? keys.filter((k: any) => typeof k === "string") : [];
  }

  /**
   * Gets filter options (unique values) for a specific column.
   * Used to populate dropdown filters in the UI.
   *
   * @param projectId - The project identifier
   * @param columnId - The column to get options for
   * @returns Array of unique values for the column
   */
  async getFilterOptions({
    projectId,
    columnId,
  }: {
    projectId: string;
    columnId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    const fieldMapping = this.mapColumnToField(columnId);
    if (!fieldMapping) {
      return [];
    }

    // For status and verdict fields, we need to query run_finished events
    const eventType =
      columnId === "status" || columnId === "verdict"
        ? ScenarioEventType.RUN_FINISHED
        : ScenarioEventType.RUN_STARTED;

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              { term: { type: eventType } },
              { exists: { field: fieldMapping } },
            ],
          },
        },
        aggs: {
          unique_values: {
            terms: {
              field: fieldMapping,
              size: 1000,
            },
          },
        },
        size: 0,
      },
    });

    const buckets =
      (response.aggregations as any)?.unique_values?.buckets ?? [];
    return buckets.map((bucket: { key: string }) => String(bucket.key));
  }

  /**
   * Searches trace metadata for matching trace IDs.
   * Used by global search to find scenario runs via their associated traces.
   *
   * @param projectId - The project identifier
   * @param search - Search query to match against trace metadata
   * @returns Array of trace IDs that match the search
   */
  private async searchTraceMetadataForTraceIds({
    projectId,
    search,
  }: {
    projectId: string;
    search: string;
  }): Promise<string[]> {
    const client = await this.getClient();
    const searchLower = search.toLowerCase();

    try {
      const response = await client.search({
        index: TRACE_INDEX.alias,
        body: {
          query: {
            bool: {
              filter: [{ term: { project_id: projectId } }],
              should: [
                // Search in reserved metadata fields (keyword types - use wildcard)
                { wildcard: { "metadata.user_id": `*${searchLower}*` } },
                { wildcard: { "metadata.thread_id": `*${searchLower}*` } },
                { wildcard: { "metadata.customer_id": `*${searchLower}*` } },
                { wildcard: { "metadata.labels": `*${searchLower}*` } },
                { wildcard: { "metadata.topic_id": `*${searchLower}*` } },
                { wildcard: { "metadata.subtopic_id": `*${searchLower}*` } },
                // Search in SDK metadata fields
                { wildcard: { "metadata.sdk_version": `*${searchLower}*` } },
                { wildcard: { "metadata.sdk_language": `*${searchLower}*` } },
                { wildcard: { "metadata.sdk_name": `*${searchLower}*` } },
                { wildcard: { "metadata.telemetry_sdk_version": `*${searchLower}*` } },
                { wildcard: { "metadata.telemetry_sdk_language": `*${searchLower}*` } },
                { wildcard: { "metadata.telemetry_sdk_name": `*${searchLower}*` } },
                // Search in prompt_ids arrays (keyword type)
                { wildcard: { "metadata.prompt_ids": `*${searchLower}*` } },
                { wildcard: { "metadata.prompt_version_ids": `*${searchLower}*` } },
                // Search in custom metadata (flattened type - use wildcard query)
                // Flattened fields store values as keywords, so we need wildcard matching
                { wildcard: { "metadata.custom": { value: `*${searchLower}*`, case_insensitive: true } } },
                // Search trace input/output (text fields - use match for tokenized search)
                { match_phrase: { "input.value": { query: search, slop: 2 } } },
                { match_phrase: { "output.value": { query: search, slop: 2 } } },
                // Also search individual words
                { match: { "input.value": { query: search, operator: "and" } } },
                { match: { "output.value": { query: search, operator: "and" } } },
              ],
              minimum_should_match: 1,
            },
          },
          _source: ["trace_id"],
          size: 100, // Limit to prevent excessive cross-index joins
        },
      });

      const hits = response.hits?.hits ?? [];
      return hits
        .map((hit) => {
          const source = hit._source as Record<string, any>;
          return source?.trace_id as string;
        })
        .filter(Boolean);
    } catch (error) {
      // If trace index doesn't exist or query fails, return empty array
      // This allows the search to continue with just scenario event fields
      captureException({
        message: "Failed to search trace metadata",
        error,
        projectId,
        search,
      });
      return [];
    }
  }

  /**
   * Gets scenario run IDs that have messages referencing the given trace IDs.
   * Used to link traces back to their scenario runs.
   *
   * @param projectId - The project identifier
   * @param traceIds - Array of trace IDs to search for
   * @returns Array of scenario run IDs
   */
  private async getScenarioRunIdsFromTraceIds({
    projectId,
    traceIds,
  }: {
    projectId: string;
    traceIds: string[];
  }): Promise<string[]> {
    if (traceIds.length === 0) {
      return [];
    }

    const client = await this.getClient();

    try {
      const response = await client.search({
        index: SCENARIO_EVENTS_INDEX.alias,
        body: {
          query: {
            bool: {
              filter: [
                { term: { [ES_FIELDS.projectId]: projectId } },
                { term: { type: ScenarioEventType.MESSAGE_SNAPSHOT } },
                // messages is an object array (not nested), so we query directly
                { terms: { "messages.trace_id": traceIds } },
              ],
            },
          },
          aggs: {
            unique_scenario_runs: {
              terms: {
                field: ES_FIELDS.scenarioRunId,
                size: 100,
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
    } catch (error) {
      captureException({
        message: "Failed to get scenario run IDs from trace IDs",
        error,
        projectId,
        traceIds,
      });
      return [];
    }
  }

  /**
   * Searches scenario runs with grouping by a specified field.
   * Returns aggregated groups with counts and top hits for preview.
   *
   * @param projectId - The project identifier
   * @param groupBy - Field to group by
   * @param filters - Array of filter conditions
   * @param sorting - Sort configuration
   * @param pagination - Page and pageSize for groups
   * @returns Grouped scenario run data with counts
   */
  async searchGroupedScenarioRuns({
    projectId,
    groupBy,
    filters,
    sorting,
    pagination,
  }: {
    projectId: string;
    groupBy: string;
    filters?: Array<{
      columnId: string;
      operator: "eq" | "contains" | "between";
      value?: unknown;
    }>;
    sorting?: { columnId: string; order: "asc" | "desc" };
    pagination?: { page: number; pageSize: number };
  }): Promise<{
    groups: Array<{
      groupValue: string;
      count: number;
      scenarioRunIds: string[];
    }>;
    totalGroups: number;
  }> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    const page = pagination?.page ?? 1;
    const pageSize = pagination?.pageSize ?? 20;

    // Map groupBy column to ES field
    const groupField = this.mapColumnToField(groupBy);
    if (!groupField) {
      return { groups: [], totalGroups: 0 };
    }

    // Build filter clauses
    const filterClauses: any[] = [
      { term: { [ES_FIELDS.projectId]: validatedProjectId } },
      { term: { type: ScenarioEventType.RUN_STARTED } },
    ];

    for (const filter of filters ?? []) {
      const fieldMapping = this.mapColumnToField(filter.columnId);
      if (!fieldMapping) continue;

      if (filter.operator === "eq") {
        filterClauses.push({ term: { [fieldMapping]: filter.value } });
      } else if (filter.operator === "contains") {
        filterClauses.push({
          wildcard: { [fieldMapping]: `*${String(filter.value).toLowerCase()}*` },
        });
      } else if (filter.operator === "between") {
        let gte: number | undefined;
        let lte: number | undefined;

        if (typeof filter.value === "string") {
          try {
            const parsed = JSON.parse(filter.value);
            if (parsed.start) gte = new Date(parsed.start).getTime();
            if (parsed.end) lte = new Date(parsed.end).getTime();
          } catch {
            // Invalid JSON, skip filter
          }
        } else {
          const rangeValue = filter.value as { gte?: number; lte?: number };
          gte = rangeValue?.gte;
          lte = rangeValue?.lte;
        }

        if (gte !== undefined || lte !== undefined) {
          filterClauses.push({
            range: {
              [fieldMapping]: {
                ...(gte !== undefined && { gte }),
                ...(lte !== undefined && { lte }),
              },
            },
          });
        }
      }
    }

    // Get grouped results using composite aggregation for pagination
    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            filter: filterClauses,
          },
        },
        aggs: {
          total_groups: {
            cardinality: {
              field: groupField,
            },
          },
          grouped: {
            terms: {
              field: groupField,
              size: page * pageSize, // Get enough groups for current page
              order: { _key: sorting?.order ?? "asc" }, // Sort by group value (name) alphabetically
            },
            aggs: {
              // Get top scenario run IDs for each group
              top_runs: {
                top_hits: {
                  size: 100, // Max runs per group that will be fetched
                  sort: [{ timestamp: { order: "desc" } }],
                  _source: [ES_FIELDS.scenarioRunId],
                },
              },
            },
          },
        },
        size: 0,
      },
    });

    const totalGroups =
      (response.aggregations as any)?.total_groups?.value ?? 0;

    const buckets =
      (response.aggregations as any)?.grouped?.buckets ?? [];

    // Extract groups for current page
    const startIdx = (page - 1) * pageSize;
    const endIdx = page * pageSize;
    const pageBuckets = buckets.slice(startIdx, endIdx);

    const groups = pageBuckets.map((bucket: any) => ({
      groupValue: String(bucket.key),
      count: bucket.doc_count,
      scenarioRunIds: (bucket.top_runs?.hits?.hits ?? [])
        .map((hit: any) => hit._source?.scenario_run_id)
        .filter(Boolean),
    }));

    return { groups, totalGroups };
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
