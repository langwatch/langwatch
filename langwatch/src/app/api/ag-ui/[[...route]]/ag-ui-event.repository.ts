import {
  type BaseEvent,
  type MessagesSnapshotEvent,
  type CustomEvent,
  EventType,
} from "@ag-ui/core";
import { eventMapping } from "./mappings";
import { esClient } from "~/server/elasticsearch";

export class AGUIEventRepository {
  private readonly indexName = "ag-ui-events";

  constructor() {
    // Initialize index if it doesn't exist
    this.initializeIndex();
  }

  private async initializeIndex() {
    const client = await esClient({ test: true });

    const indexExists = await client.indices.exists({
      index: this.indexName,
    });

    if (!indexExists) {
      await client.indices.create({
        index: this.indexName,
        body: {
          mappings: eventMapping,
        },
      });
    }
  }

  async saveEvent(event: BaseEvent & { projectId: string }) {
    const client = await esClient({ test: true });

    await client.index({
      index: this.indexName,
      body: {
        ...event,
        projectId: event.projectId,
        timestamp: event.timestamp || Date.now(),
      },
    });
  }

  async getEventsByThreadId({
    threadId,
    projectId,
  }: {
    threadId: string;
    projectId: string;
  }) {
    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { threadId: threadId } },
              { term: { projectId: projectId } },
            ],
          },
        },
        sort: [
          {
            timestamp: "asc",
          },
        ],
      },
    });

    return response.hits.hits.map((hit: any) => hit._source);
  }

  async getEventsByRunId({
    runId,
    projectId,
  }: {
    runId: string;
    projectId: string;
  }) {
    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { runId: runId } },
              { term: { projectId: projectId } },
            ],
          },
        },
        sort: [
          {
            timestamp: "asc",
          },
        ],
      },
    });

    return response.hits.hits.map((hit: any) => hit._source);
  }

  async getEventsByProjectId(projectId: string) {
    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          term: {
            projectId: projectId,
          },
        },
        sort: [
          {
            timestamp: "desc",
          },
        ],
      },
    });

    return response.hits.hits.map((hit: any) => hit._source);
  }

  async getLatestMessagesSnapshotEvent({
    projectId,
    threadId,
  }: {
    projectId: string;
    threadId: string;
  }): Promise<MessagesSnapshotEvent> {
    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId } },
              { term: { threadId } },
              { term: { type: EventType.MESSAGES_SNAPSHOT } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    return response.hits.hits[0]?._source as MessagesSnapshotEvent;
  }

  async getLatestCustomEventByName({
    projectId,
    threadId,
    name,
  }: {
    projectId: string;
    threadId: string;
    name: string;
  }): Promise<CustomEvent> {
    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          bool: {
            must: [
              { term: { projectId } },
              { term: { threadId } },
              { term: { type: EventType.CUSTOM } },
              { term: { name } },
            ],
          },
        },
        sort: [{ timestamp: "desc" }],
        size: 1,
      },
    });

    return response.hits.hits[0]?._source as CustomEvent;
  }

  async getAllThreadsForProject(projectId: string): Promise<string[]> {
    const client = await esClient({ test: true });

    const response = await client.search({
      index: this.indexName,
      body: {
        query: {
          term: { projectId },
        },
        aggs: {
          unique_threads: {
            terms: {
              field: "threadId",
              size: 1000,
            },
          },
        },
        size: 0,
      },
    });

    return (
      (
        response.aggregations?.unique_threads as {
          buckets: Array<{ key: string }>;
        }
      )?.buckets?.map((bucket) => bucket.key) ?? []
    );
  }
}
