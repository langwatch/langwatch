import type {
  ProjectionStoreContext,
  StoredProjection,
  StoredProjectionRead,
} from "@langwatch/eventing";

import {
  type LangyConversationPullRequestsData,
  pullRequestKeyOf,
} from "../../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyConversationPullRequestMatch,
  LangyConversationPullRequestsRepository,
} from "../langy-conversation-pull-requests.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

/** The memory twin of `PrismaLangyConversationPullRequestsRepository`: one row per conversation. */
export class MemoryLangyConversationPullRequestsRepository extends LangyConversationPullRequestsRepository {
  static create(store: LangyMemoryStore): MemoryLangyConversationPullRequestsRepository {
    return new MemoryLangyConversationPullRequestsRepository(store);
  }

  private constructor(private readonly memory: LangyMemoryStore) {
    super();
  }

  async get(
    conversationId: string,
    context: ProjectionStoreContext,
  ): Promise<StoredProjectionRead<LangyConversationPullRequestsData>> {
    const row = this.memory.conversationPullRequests.get(
      `${String(context.tenantId)}:${conversationId}`,
    );
    return row ? { kind: "folded", projection: row.projection } : { kind: "empty" };
  }

  async store(
    projection: StoredProjection<LangyConversationPullRequestsData>,
    context: ProjectionStoreContext,
  ): Promise<void> {
    const projectId = String(context.tenantId);
    const conversationId = context.aggregateId;
    this.memory.conversationPullRequests.set(`${projectId}:${conversationId}`, {
      projectId,
      conversationId,
      projection: {
        ...projection,
        state: { ...projection.state, LastEventOccurredAt: projection.occurredAt },
      },
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
    const key = pullRequestKeyOf({ repositoryFullName, prNumber });
    const inProjects = new Set(projectIds);
    return [...this.memory.conversationPullRequests.values()]
      .filter(
        (row) =>
          inProjects.has(row.projectId) &&
          row.projection.state.PullRequests.some((pull) => pullRequestKeyOf(pull) === key),
      )
      .map((row) => ({
        projectId: row.projectId,
        conversationId: row.conversationId,
        followUpsInARow: row.projection.state.FollowUpsInARow,
      }));
  }
}
