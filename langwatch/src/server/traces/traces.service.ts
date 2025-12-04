import type { Client as ElasticClient } from "@elastic/elasticsearch";
import type { QueryDslBoolQuery } from "@elastic/elasticsearch/lib/api/types";
import type { PrismaClient } from "@prisma/client";
import { esClient as defaultEsClient, TRACE_INDEX } from "~/server/elasticsearch";
import { prisma } from "~/server/db";
import { OrganizationRepository } from "~/server/repositories/organization.repository";
import { dependencies } from "~/injection/dependencies.server";

type EsClientFactory = typeof defaultEsClient;

/**
 * Service for trace-related operations
 */
export class TracesService {
  constructor(
    private readonly organizationRepository: OrganizationRepository,
    private readonly esClientFactory: EsClientFactory,
    private readonly subscriptionHandler: typeof dependencies.subscriptionHandler
  ) {}

  /**
   * Static factory method for creating TracesService with proper DI
   */
  static create(db: PrismaClient = prisma): TracesService {
    return new TracesService(
      new OrganizationRepository(db),
      defaultEsClient,
      dependencies.subscriptionHandler
    );
  }

  /**
   * Checks if team's organization has exceeded trace limit
   */
  async checkLimit({
    teamId,
  }: {
    teamId: string;
  }): Promise<{ exceeded: boolean; message?: string }> {
    const organizationId =
      await this.organizationRepository.getOrganizationIdByTeamId(teamId);
    if (!organizationId) {
      throw new Error(`Team ${teamId} has no organization`);
    }

    const [count, plan] = await Promise.all([
      this.getCurrentMonthCount({ organizationId }),
      this.subscriptionHandler.getActivePlan(organizationId),
    ]);

    if (count >= plan.maxMessagesPerMonth) {
      return {
        exceeded: true,
        message: `Monthly limit of ${plan.maxMessagesPerMonth} traces reached`,
      };
    }
    return { exceeded: false };
  }

  /**
   * Gets current month trace count for an organization
   */
  async getCurrentMonthCount({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    const projectIds =
      await this.organizationRepository.getProjectIds(organizationId);
    if (projectIds.length === 0) {
      return 0;
    }

    const esClient = await this.esClientFactory({ organizationId });

    const result = await esClient.count({
      index: TRACE_INDEX.alias,
      body: {
        query: {
          bool: {
            must: [
              { terms: { project_id: projectIds } },
              {
                range: {
                  "timestamps.inserted_at": { gte: this.getCurrentMonthStart() },
                },
              },
            ] as QueryDslBoolQuery["filter"],
          } as QueryDslBoolQuery,
        },
      },
    });

    return result.count;
  }

  private getCurrentMonthStart(): number {
    const now = new Date();
    return new Date(now.getFullYear(), now.getMonth(), 1).getTime();
  }
}

