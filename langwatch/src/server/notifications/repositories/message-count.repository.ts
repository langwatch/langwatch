import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import { esClient, TRACE_INDEX } from "../../elasticsearch";

/**
 * Repository for message count data access via Elasticsearch
 * Single Responsibility: Query message counts from ES
 */
export class MessageCountRepository {
  /**
   * Get the start of the current calendar month
   */
  private getCurrentMonth(): Date {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }

  /**
   * Get message count for a single project in the current month
   */
  async getProjectMessageCount({
    projectId,
    organizationId,
  }: {
    projectId: string;
    organizationId: string;
  }): Promise<number> {
    const client = await esClient({ organizationId });
    const currentMonthStart = this.getCurrentMonth().getTime();

    const result = await client.count({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          bool: {
            must: [
              {
                term: {
                  project_id: projectId,
                },
              },
              {
                range: {
                  "timestamps.inserted_at": {
                    gte: currentMonthStart,
                  },
                },
              },
            ] as QueryDslBoolQuery["filter"],
          } as QueryDslBoolQuery,
        },
      },
    });

    return result.count;
  }
}

