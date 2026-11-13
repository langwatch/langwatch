import { DispatchError, type ProjectionStoreContext } from "@langwatch/eventing";
import { skipTenantCheck } from "@langwatch/prisma-client";

import type { LangyPullRequestsOpenedRecord } from "../../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyOpenedPullRequest,
  LangyPullRequestRepository,
} from "../langy-pull-request.repository.ts";
import type { LangyDatabase } from "./langy-database.mapper.ts";

/** Postgres rows of the pull requests Langy opened, keyed by repository and number. */
export class PrismaLangyPullRequestRepository extends LangyPullRequestRepository {
  private constructor(private readonly prisma: LangyDatabase) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangyPullRequestRepository {
    return new PrismaLangyPullRequestRepository(database);
  }

  async append(
    record: LangyPullRequestsOpenedRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (record.PullRequests.length === 0) return;
    const projectId = String(context.tenantId);
    const conversation = await this.prisma.langyConversationProjection.findUnique({
      where: {
        projectId,
        projectId_ConversationId: { projectId, ConversationId: record.ConversationId },
      },
      select: { UserId: true },
    });
    if (!conversation) {
      throw new DispatchError({
        message: `Langy conversation ${record.ConversationId} is not folded yet; retrying`,
        retryable: true,
      });
    }
    await this.prisma.langyPullRequest.createMany({
      data: record.PullRequests.map((pull) => ({
        projectId,
        RepositoryFullName: pull.repositoryFullName.toLowerCase(),
        PrNumber: pull.prNumber,
        ConversationId: record.ConversationId,
        UserId: conversation.UserId,
        OpenedAt: record.OpenedAt,
        SourceEventId: record.SourceEventId,
      })),
      skipDuplicates: true,
    });
  }

  async findByPullRequest({
    projectIds,
    repositoryFullName,
    prNumber,
  }: {
    projectIds: readonly string[];
    repositoryFullName: string;
    prNumber: number;
  }): Promise<LangyOpenedPullRequest[]> {
    if (projectIds.length === 0) return [];
    const row = await this.prisma.langyPullRequest.findFirst({
      where: {
        projectId: { in: [...projectIds] },
        RepositoryFullName: repositoryFullName.toLowerCase(),
        PrNumber: prNumber,
      },
      select: { projectId: true, ConversationId: true, UserId: true, OpenedAt: true },
    });
    if (!row) return [];
    return [
      {
        projectId: row.projectId,
        conversationId: row.ConversationId,
        userId: row.UserId,
        openedAt: row.OpenedAt,
      },
    ];
  }

  async countOpenedSince({ userId, since }: { userId: string; since: number }): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ opened: bigint }[]>`
      SELECT count(*) AS "opened" FROM "LangyPullRequest"
      WHERE "userId" = ${userId} AND "openedAt" >= ${since}
      ${skipTenantCheck({
        // The daily cap is the person's, across every project they open pull requests in
        SKIP_TENANT_CHECK: true,
      })}
    `;
    return Number(row?.opened ?? 0);
  }
}
