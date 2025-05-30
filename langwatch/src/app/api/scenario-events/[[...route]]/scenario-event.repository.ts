import {
  type ScenarioEvent,
  type ScenarioRunFinishedEvent,
  type ScenarioMessageSnapshotEvent,
  ScenarioEventType,
  scenarioEventSchema,
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

    // Delete index if it exists to force mapping update
    const indexExists = await client.indices.exists({
      index: this.indexName,
    });

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
}
