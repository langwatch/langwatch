import type { BaseEvent } from "@ag-ui/core";
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
}
