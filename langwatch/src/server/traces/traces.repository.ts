import type { Client as ElasticClient } from "@elastic/elasticsearch";
import { esClient, TRACE_INDEX } from "~/server/elasticsearch";
import type { ElasticSearchTrace } from "~/server/tracer/types";

export class TracesRepository {

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
    includes?: string[];
  }) {
    const client = await this.getClient(projectId);

    const traces = await client.search<ElasticSearchTrace>({
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
        ...(includes && includes.length > 0 ? { _source: { includes } } : {}),
      },
    });

    return traces.hits.hits;
  }

  /**
   * Gets tenant-specific Elasticsearch client.
   *
   * @param projectId - The project identifier
   * @returns Promise resolving to an Elasticsearch client instance
   * @private
   */
  private async getClient(projectId: string): Promise<ElasticClient> {
    return await esClient({ projectId });
  }
}
