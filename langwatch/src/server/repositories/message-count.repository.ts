import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import type { PrismaClient } from "@prisma/client";
import { esClient, TRACE_INDEX } from "../elasticsearch";

interface CacheEntry {
  count: number;
  lastUpdated: number;
}

const FIVE_MINUTES = 5 * 60 * 1000;
const messageCountCache = new Map<string, CacheEntry>();

/**
 * Repository for message count queries across Elasticsearch
 * Single Responsibility: Query and cache message counts
 */
export class MessageCountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  /**
   * Get the start of the current calendar month
   */
  private getCurrentMonth(): Date {
    return new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  }

  /**
   * Get project IDs for an organization
   */
  private async getProjectIds(organizationId: string): Promise<string[]> {
    const projects = await this.prisma.project.findMany({
      where: {
        team: { organizationId },
      },
      select: { id: true },
    });
    return projects.map((p) => p.id);
  }

  /**
   * Get current month message count for projects with caching
   */
  async getCurrentMonthCount({
    projectIds,
    organizationId,
  }: {
    projectIds?: string[];
    organizationId?: string;
  }): Promise<number> {
    // Build cache key
    const cacheKey = organizationId
      ? `org:${organizationId}`
      : `projects:${projectIds?.sort().join(",")}`;

    // Check cache
    const now = Date.now();
    const cachedResult = messageCountCache.get(cacheKey);
    if (cachedResult && now - cachedResult.lastUpdated < FIVE_MINUTES) {
      return cachedResult.count;
    }

    // Get project IDs if organizationId provided
    let projectIdsToQuery = projectIds ?? [];
    if (organizationId) {
      projectIdsToQuery = await this.getProjectIds(organizationId);
    }

    if (projectIdsToQuery.length === 0) {
      return 0;
    }

    // Query ES
    const client = await esClient({ projectId: projectIdsToQuery[0] });
    const result = await client.count({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          bool: {
            must: [
              {
                terms: {
                  project_id: projectIdsToQuery,
                },
              },
              {
                range: {
                  "timestamps.inserted_at": {
                    gte: this.getCurrentMonth().getTime(),
                  },
                },
              },
            ] as QueryDslBoolQuery["filter"],
          } as QueryDslBoolQuery,
        },
      },
    });

    // Cache result
    messageCountCache.set(cacheKey, {
      count: result.count,
      lastUpdated: now,
    });

    return result.count;
  }

  /**
   * Get message count for a single project in current month (no cache)
   */
  async getProjectCurrentMonthCount({
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

