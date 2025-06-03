import {
  type ScenarioEvent,
  type ScenarioRunFinishedEvent,
  type ScenarioMessageSnapshotEvent,
  ScenarioEventType,
  scenarioEventSchema,
  type ScenarioBatch,
} from "./schemas";
import { eventMapping } from "./mappings";
import { esClient } from "~/server/elasticsearch";
import { z } from "zod";

const projectIdSchema = z.string();
const scenarioRunIdSchema = z.string();

export class ScenarioEventRepository {
  private readonly indexName = "scenario-events";

  constructor() {
    // Initialize index if it doesn't exist
    this.initializeIndex();
  }

  private async initializeIndex() {
    const client = await esClient({ test: true });

    const indexExists = await client.indices.exists({
      index: this.indexName,
    });

    // Delete index if it exists to force mapping update
    // If the index already exists, delete it to ensure the mapping is always up to date.
    // WARNING: This will remove all existing scenario event data.
    // This is only appropriate for test/dev environments, not production.
    // if (indexExists) {
    //   await client.indices.delete({
    //     index: this.indexName,
    //   });
    // }

    if (!indexExists) {
      // Create new index with updated mappings
      await client.indices.create({
        index: this.indexName,
        body: {
          mappings: eventMapping,
        },
      });
    }
  }

  async saveEvent({
    projectId,
    ...event
  }: ScenarioEvent & { projectId: string }) {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const validatedEvent = scenarioEventSchema.parse(event);

    const client = await esClient({ test: true });

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

    const client = await esClient({ test: true });

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

    const client = await esClient({ test: true });

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

    const client = await esClient({ test: true });

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
              size: 1000,
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

    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          term: { projectId: validatedProjectId },
        },
        sort: [{ timestamp: "desc" }],
        size: 1000,
      },
    });

    return response.hits.hits.map((hit) => hit._source as ScenarioEvent);
  }

  async deleteAllEvents({ projectId }: { projectId: string }): Promise<void> {
    const validatedProjectId = projectIdSchema.parse(projectId);
    const client = await esClient({ test: true });

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

    const client = await esClient({ test: true });

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
              size: 1000,
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

  async getScenarioRunsForBatch({
    projectId,
    batchRunId,
  }: {
    projectId: string;
    batchRunId: string;
  }): Promise<string[]> {
    const validatedProjectId = projectIdSchema.parse(projectId);

    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId: validatedProjectId } },
              { term: { batchRunId: batchRunId } },
            ],
          },
        },
        aggs: {
          unique_runs: {
            terms: {
              field: "scenarioRunId",
              size: 1000,
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
}
