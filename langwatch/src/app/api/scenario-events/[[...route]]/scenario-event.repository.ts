import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { SpanKind } from "@opentelemetry/api";
import { getLangWatchTracer } from "langwatch";
import { z } from "zod";
import { esClient, SCENARIO_EVENTS_INDEX } from "~/server/elasticsearch";
import { createLogger } from "~/utils/logger/server";
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

const tracer = getLangWatchTracer("langwatch.scenario-events.repository");
const logger = createLogger("langwatch:scenario-events:repository");

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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.saveEvent",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "INDEX",
          "tenant.id": projectId,
          "event.type": event.type,
        },
      },
      async () => {
        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedEvent = scenarioEventSchema.parse(event);

        logger.debug(
          { projectId, scenarioId: event.scenarioId, scenarioRunId: event.scenarioRunId, type: event.type },
          "Indexing scenario event",
        );

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
          // Wait for the next ES refresh cycle (up to 1s) before returning.
          // This ensures the event is searchable immediately after the API returns,
          // which is required for polling to find newly created scenario runs.
          // Using "wait_for" instead of "true" avoids blocking other indexing operations.
          refresh: "wait_for",
        });
      },
    );
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getLatestMessageSnapshotEventByScenarioRunId",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH",
          "tenant.id": projectId,
          "scenario.run.id": scenarioRunId,
        },
      },
      async (span) => {
        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioRunId = scenarioRunIdSchema.parse(scenarioRunId);

        logger.debug({ projectId, scenarioRunId }, "Querying latest message snapshot event");

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
            sort: [
              { timestamp: "desc" },
              {
                _script: {
                  type: "number",
                  script: {
                    source:
                      "params._source.messages != null ? params._source.messages.length : 0",
                  },
                  order: "desc",
                },
              },
            ],
            size: 1,
          },
        });

        const rawResult = response.hits.hits[0]?._source as
          | Record<string, unknown>
          | undefined;

        span.setAttribute("result.found", rawResult !== undefined);

        return rawResult
          ? (transformFromElasticsearch(rawResult) as ScenarioMessageSnapshotEvent)
          : undefined;
      },
    );
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getLatestRunFinishedEventByScenarioRunId",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH",
          "tenant.id": projectId,
          "scenario.run.id": scenarioRunId,
        },
      },
      async (span) => {
        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioRunId = scenarioRunIdSchema.parse(scenarioRunId);

        logger.debug({ projectId, scenarioRunId }, "Querying latest run finished event");

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

        span.setAttribute("result.found", rawResult !== undefined);

        return rawResult
          ? (transformFromElasticsearch(rawResult) as ScenarioRunFinishedEvent)
          : undefined;
      },
    );
  }

  /**
   * Deletes all events associated with a project.
   * This is a destructive operation that cannot be undone.
   *
   * @param projectId - The project identifier
   * @throws {z.ZodError} If validation fails for projectId
   */
  async deleteAllEvents({ projectId }: { projectId: string }): Promise<void> {
    return tracer.withActiveSpan(
      "ScenarioEventRepository.deleteAllEvents",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "DELETE_BY_QUERY",
          "tenant.id": projectId,
        },
      },
      async () => {
        const validatedProjectId = projectIdSchema.parse(projectId);

        logger.debug({ projectId }, "Deleting all events for project");

        const client = await this.getClient();

        await client.deleteByQuery({
          index: SCENARIO_EVENTS_INDEX.alias,
          body: {
            query: {
              term: { [ES_FIELDS.projectId]: validatedProjectId },
            },
          },
        });
      },
    );
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getScenarioRunIdsForScenario",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH_AGGREGATION",
          "tenant.id": projectId,
          "scenario.id": scenarioId,
        },
      },
      async (span) => {
        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioId = scenarioIdSchema.parse(scenarioId);

        logger.debug({ projectId, scenarioId }, "Querying scenario run ids for scenario");

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

        const result =
          (
            response.aggregations?.unique_runs as {
              buckets: Array<{ key: string }>;
            }
          )?.buckets?.map((bucket) => bucket.key) ?? [];

        span.setAttribute("result.count", result.length);

        return result;
      },
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getScenarioSetsDataForProject",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH_AGGREGATION",
          "tenant.id": projectId,
        },
      },
      async (span) => {
        const validatedProjectId = projectIdSchema.parse(projectId);

        logger.debug({ projectId }, "Querying scenario sets data for project");

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

        span.setAttribute("result.count", setBuckets.length);

        return setBuckets.map((bucket) => {
          return {
            scenarioSetId: bucket.key,
            scenarioCount: bucket.unique_scenario_count.value,
            lastRunAt: bucket.latest_run_timestamp.value,
          };
        });
      },
    );
  }

  /**
   * Retrieves batch run IDs associated with a scenario set with cursor-based pagination.
   * Results are sorted by latest timestamp in descending order (most recent first).
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
    const validatedScenarioSetId = scenarioIdSchema.parse(scenarioSetId);

    return this.queryBatchRunIds({
      projectId,
      limit,
      cursor,
      setFilter: { term: { [ES_FIELDS.scenarioSetId]: validatedScenarioSetId } },
    });
  }

  /**
   * Retrieves batch run IDs across all suites with cursor-based pagination.
   * Uses a wildcard query on scenario_set_id to match all suite sets.
   * Returns scenarioSetIds map (batchRunId → scenarioSetId) for suite name resolution.
   */
  async getBatchRunIdsForAllSuites({
    projectId,
    limit,
    cursor,
  }: {
    projectId: string;
    limit: number;
    cursor?: string;
  }): Promise<{
    batchRunIds: string[];
    scenarioSetIds: Record<string, string>;
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const result = await this.queryBatchRunIds({
      projectId,
      limit,
      cursor,
      setFilter: { wildcard: { [ES_FIELDS.scenarioSetId]: "__internal__*__suite" } },
      trackScenarioSetIds: true,
    });

    return result;
  }

  /**
   * Shared implementation for paginated batch run ID queries.
   * Handles cursor parsing, ES search, deduplication, sorting, and pagination.
   */
  private async queryBatchRunIds({
    projectId,
    limit,
    cursor,
    setFilter,
    trackScenarioSetIds = false,
  }: {
    projectId: string;
    limit: number;
    cursor?: string;
    setFilter: Record<string, any>;
    trackScenarioSetIds?: boolean;
  }): Promise<{
    batchRunIds: string[];
    scenarioSetIds: Record<string, string>;
    nextCursor?: string;
    hasMore: boolean;
  }> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await this.getClient();

    const maxLimit = 20;
    const actualLimit = Math.min(limit, maxLimit);

    const searchAfter = cursor ? this.decodeCursor(cursor) : undefined;

    // Request 5x the limit (min 1000) to account for deduplication
    const oversampleFactor = 5;
    const minRequestSize = 1000;
    const requestSize = Math.max(actualLimit * oversampleFactor, minRequestSize);

    const response = await client.search({
      index: SCENARIO_EVENTS_INDEX.alias,
      body: {
        query: {
          bool: {
            filter: [
              { term: { [ES_FIELDS.projectId]: validatedProjectId } },
              setFilter,
              { exists: { field: ES_FIELDS.batchRunId } },
            ],
          },
        },
        sort: [
          { timestamp: { order: "desc" } },
          { [ES_FIELDS.batchRunId]: { order: "asc" } },
        ],
        size: requestSize,
        ...(searchAfter && { search_after: searchAfter }),
      },
    });

    const hits = response.hits?.hits ?? [];

    // Deduplicate by batch run ID, keeping the latest timestamp for each
    const batchRunMap = new Map<
      string,
      { timestamp: number; sort: any[]; scenarioSetId: string }
    >();

    for (const hit of hits) {
      const source = hit._source as Record<string, any>;
      const batchRunId = source?.batch_run_id as string;
      const timestamp = source?.timestamp as number;
      const scenarioSetId = trackScenarioSetIds
        ? (source?.scenario_set_id as string)
        : "";

      if (batchRunId && timestamp !== undefined) {
        if (trackScenarioSetIds && !scenarioSetId) continue;

        const existing = batchRunMap.get(batchRunId);
        if (!existing || timestamp > existing.timestamp) {
          const sortValues = hit.sort;
          if (Array.isArray(sortValues) && sortValues.length > 0) {
            batchRunMap.set(batchRunId, {
              timestamp,
              sort: sortValues,
              scenarioSetId,
            });
          }
        }
      }
    }

    // Sort by timestamp descending, then by batch run ID for stability
    const sortedBatchRuns = Array.from(batchRunMap.entries()).sort(
      ([keyA, a], [keyB, b]) => {
        if (b.timestamp !== a.timestamp) return b.timestamp - a.timestamp;
        return keyA < keyB ? -1 : keyA > keyB ? 1 : 0;
      },
    );

    const hasMore =
      hits.length >= requestSize || sortedBatchRuns.length > actualLimit;

    const nextCursor =
      hasMore && sortedBatchRuns.length > actualLimit
        ? this.encodeCursor(sortedBatchRuns[actualLimit]?.[1].sort)
        : undefined;

    const limitedBatchRuns = sortedBatchRuns.slice(0, actualLimit);
    const batchRunIds = limitedBatchRuns.map(([id]) => id);

    const scenarioSetIds: Record<string, string> = {};
    if (trackScenarioSetIds) {
      for (const [batchRunId, data] of limitedBatchRuns) {
        scenarioSetIds[batchRunId] = data.scenarioSetId;
      }
    }

    return { batchRunIds, scenarioSetIds, nextCursor, hasMore };
  }

  /** Decodes a base64-encoded cursor into search_after values. */
  private decodeCursor(cursor: string): any[] {
    try {
      const decoded = Buffer.from(cursor, "base64").toString("utf-8");
      const parsed = JSON.parse(decoded);
      if (Array.isArray(parsed) && parsed.length > 0) {
        return parsed;
      }
      throw new Error("Cursor must be a non-empty array");
    } catch (e) {
      captureException({ message: "Malformed cursor", cursor, error: e });
      throw new Error(`Malformed cursor: ${cursor}`);
    }
  }

  /** Encodes search_after sort values into a base64 cursor string. */
  private encodeCursor(sortValues: any[] | undefined): string | undefined {
    if (
      !Array.isArray(sortValues) ||
      sortValues.length === 0 ||
      sortValues.some((val) => val === undefined)
    ) {
      return undefined;
    }
    return Buffer.from(JSON.stringify(sortValues)).toString("base64");
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getRunStartedEventByScenarioRunId",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH",
          "tenant.id": projectId,
          "scenario.run.id": scenarioRunId,
        },
      },
      async (span) => {
        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioRunId = scenarioRunIdSchema.parse(scenarioRunId);

        logger.debug({ projectId, scenarioRunId }, "Querying run started event");

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

        span.setAttribute("result.found", rawResult !== undefined);

        return rawResult
          ? (transformFromElasticsearch(rawResult) as ScenarioRunStartedEvent)
          : undefined;
      },
    );
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getRunStartedEventsByScenarioRunIds",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH_AGGREGATION",
          "tenant.id": projectId,
          "scenario_run_ids.count": scenarioRunIds.length,
        },
      },
      async (span) => {
        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return new Map();
        }

        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioRunIds = Array.from(
          new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id))),
        );

        logger.debug({ projectId, scenarioRunIdsCount: validatedScenarioRunIds.length }, "Batch querying run started events");

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

        span.setAttribute("result.count", results.size);

        return results;
      },
    );
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getLatestMessageSnapshotEventsByScenarioRunIds",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH_AGGREGATION",
          "tenant.id": projectId,
          "scenario_run_ids.count": scenarioRunIds.length,
        },
      },
      async (span) => {
        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return new Map();
        }

        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioRunIds = Array.from(
          new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id))),
        );

        logger.debug({ projectId, scenarioRunIdsCount: validatedScenarioRunIds.length }, "Batch querying message snapshot events");

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
                      sort: [
                        { timestamp: "desc" },
                        {
                          _script: {
                            type: "number",
                            script: {
                              source:
                                "params._source.messages != null ? params._source.messages.length : 0",
                            },
                            order: "desc",
                          },
                        },
                      ],
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

        span.setAttribute("result.count", results.size);

        return results;
      },
    );
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
    return tracer.withActiveSpan(
      "ScenarioEventRepository.getLatestRunFinishedEventsByScenarioRunIds",
      {
        kind: SpanKind.CLIENT,
        attributes: {
          "db.system": "elasticsearch",
          "db.operation": "SEARCH_AGGREGATION",
          "tenant.id": projectId,
          "scenario_run_ids.count": scenarioRunIds.length,
        },
      },
      async (span) => {
        if (scenarioRunIds.length === 0) {
          span.setAttribute("result.count", 0);
          return new Map();
        }

        const validatedProjectId = projectIdSchema.parse(projectId);
        const validatedScenarioRunIds = Array.from(
          new Set(scenarioRunIds.map((id) => scenarioRunIdSchema.parse(id))),
        );

        logger.debug({ projectId, scenarioRunIdsCount: validatedScenarioRunIds.length }, "Batch querying run finished events");

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

        span.setAttribute("result.count", results.size);

        return results;
      },
    );
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
