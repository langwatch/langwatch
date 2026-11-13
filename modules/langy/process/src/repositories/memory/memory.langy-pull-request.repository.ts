import { DispatchError, type ProjectionStoreContext } from "@langwatch/eventing";

import type { LangyPullRequestsOpenedRecord } from "../../rules/langy-ci-follow-up.rules.ts";
import {
  type LangyOpenedPullRequest,
  LangyPullRequestRepository,
} from "../langy-pull-request.repository.ts";
import type { LangyMemoryStore } from "./langy-memory.store.ts";

function keyOf(repositoryFullName: string, prNumber: number): string {
  return `${repositoryFullName.toLowerCase()}#${prNumber}`;
}

/** The memory twin of `PrismaLangyPullRequestRepository`: one entry per pull request. */
export class MemoryLangyPullRequestRepository extends LangyPullRequestRepository {
  static create(store: LangyMemoryStore): MemoryLangyPullRequestRepository {
    return new MemoryLangyPullRequestRepository(store);
  }

  private constructor(private readonly memory: LangyMemoryStore) {
    super();
  }

  async append(
    record: LangyPullRequestsOpenedRecord,
    context: ProjectionStoreContext,
  ): Promise<void> {
    if (record.PullRequests.length === 0) return;
    const projectId = String(context.tenantId);
    const conversation = this.memory.conversations.get(`${projectId}:${record.ConversationId}`);
    if (!conversation) {
      throw new DispatchError({
        message: `Langy conversation ${record.ConversationId} is not folded yet; retrying`,
        retryable: true,
      });
    }
    for (const pull of record.PullRequests) {
      const key = keyOf(pull.repositoryFullName, pull.prNumber);
      if (this.memory.pullRequests.has(key)) continue;
      this.memory.pullRequests.set(key, {
        projectId,
        conversationId: record.ConversationId,
        userId: conversation.projection.state.UserId,
        openedAt: record.OpenedAt,
      });
    }
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
    const row = this.memory.pullRequests.get(keyOf(repositoryFullName, prNumber));
    return row && projectIds.includes(row.projectId) ? [{ ...row }] : [];
  }

  async countOpenedSince({ userId, since }: { userId: string; since: number }): Promise<number> {
    return [...this.memory.pullRequests.values()].filter(
      (row) => row.userId === userId && row.openedAt >= since,
    ).length;
  }
}
