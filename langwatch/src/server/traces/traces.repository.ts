import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";

export class TracesRepository {
  private client: ElasticClient | null = null;

  /**
   * Retrieves traces for the given project and trace IDs.
   *
   * @param projectId - The project identifier
   * @param traceIds - Array of trace IDs
   * @returns Array of trace hits from Elasticsearch
   */
  async getTracesByIds({
    projectId,
    traceIds,
    includes,
  }: {
    projectId: string;
    traceIds: string[];
    includes: string[];
  }) {
    const client = await this.getClient();

    const traces = await client.search({
      index: TRACE_INDEX.all,
      size: traceIds.length,
      body: {
        query: {
          bool: {
            filter: [
              { terms: { trace_id: Array.from(traceIds) } },
              { term: { project_id: projectId } }
            ],
          },
        },
        _source: {
          includes,
        },
      },
    });

    return traces.hits.hits;
  }

  /**
   * Gets or creates a cached Elasticsearch client.
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
