import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";
import type { Prisma } from "@langwatch/prisma-client/generated";
import { z } from "zod";

import {
  type LangyConversationPullRequestsData,
  langyOpenedPullRequestSchema,
  pullRequestKeyOf,
} from "../../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyConversationPullRequestMatch,
  LangyConversationPullRequestsRepository,
} from "../langy-conversation-pull-requests.repository.ts";
import type { LangyDatabase } from "./langy-database.mapper.ts";

const openedPullRequestsSchema = z.array(langyOpenedPullRequestSchema);

type Row = Prisma.LangyConversationPullRequestsProjectionGetPayload<object>;

function fromRow(row: Row): StoredProjection<LangyConversationPullRequestsData> {
  return {
    state: {
      PullRequests: openedPullRequestsSchema.parse(row.PullRequests),
      FollowUpsInARow: row.FollowUpsInARow,
      CreatedAt: row.CreatedAt,
      UpdatedAt: row.UpdatedAt,
      LastEventOccurredAt: row.OccurredAt,
    },
    cursor: { acceptedAt: row.AcceptedAt, eventId: row.LastEventId },
    occurredAt: row.OccurredAt,
    createdAt: row.CreatedAt,
    updatedAt: row.UpdatedAt,
    version: row.ProjectionVersion,
  };
}

/** Postgres row I/O for the conversation pull requests fold, and CI's lookup by pull request. */
export class PrismaLangyConversationPullRequestsRepository extends LangyConversationPullRequestsRepository {
  private constructor(private readonly prisma: LangyDatabase) {
    super();
  }

  static create(database: LangyDatabase): PrismaLangyConversationPullRequestsRepository {
    return new PrismaLangyConversationPullRequestsRepository(database);
  }

  async get(
    ConversationId: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<LangyConversationPullRequestsData>> {
    const projectId = String(context.tenantId);
    const row = await this.prisma.langyConversationPullRequestsProjection.findUnique({
      where: { projectId, projectId_ConversationId: { projectId, ConversationId } },
    });
    return row ? { kind: "folded", projection: fromRow(row) } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<LangyConversationPullRequestsData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const ConversationId = context.aggregateId;
    const { PullRequests, FollowUpsInARow } = projection.state;
    const data = {
      ConversationId,
      PullRequestKeys: PullRequests.map(pullRequestKeyOf),
      PullRequests,
      FollowUpsInARow,
      CreatedAt: projection.createdAt,
      UpdatedAt: projection.updatedAt,
      OccurredAt: projection.occurredAt,
      AcceptedAt: projection.cursor.acceptedAt,
      LastEventId: projection.cursor.eventId,
      ProjectionVersion: projection.version,
    } satisfies Omit<
      Prisma.LangyConversationPullRequestsProjectionUncheckedCreateInput,
      "id" | "projectId"
    >;
    await this.prisma.langyConversationPullRequestsProjection.upsert({
      where: { projectId, projectId_ConversationId: { projectId, ConversationId } },
      create: { projectId, ...data },
      update: data,
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
  }): Promise<LangyConversationPullRequestMatch[]> {
    if (projectIds.length === 0) return [];
    const rows = await this.prisma.langyConversationPullRequestsProjection.findMany({
      where: {
        projectId: { in: [...projectIds] },
        PullRequestKeys: { has: pullRequestKeyOf({ repositoryFullName, prNumber }) },
      },
      select: { projectId: true, ConversationId: true, FollowUpsInARow: true },
    });
    return rows.map((row) => ({
      projectId: row.projectId,
      conversationId: row.ConversationId,
      followUpsInARow: row.FollowUpsInARow,
    }));
  }
}
