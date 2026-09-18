import { nowInstant } from "@langwatch/time";

import { GithubPullRequestStatusCacheRepository } from "../github-pull-request-status-cache.repository.ts";
import type {
  GithubPullRequestRef,
  GithubPullRequestStatus,
} from "../../services/github-pull-request-status.service.ts";
import type { MemoryGithubDatabase } from "./memory.github.database.ts";

const STATUS_CACHE_TTL_SEC = 60;
const STATUSES: readonly GithubPullRequestStatus[] = ["open", "draft", "merged", "closed"];

/** The memory twin of the live status cache, over the same expiring rows. */
export class MemoryGithubPullRequestStatusCacheRepository extends GithubPullRequestStatusCacheRepository {
  static create(parts: {
    memory: MemoryGithubDatabase;
  }): MemoryGithubPullRequestStatusCacheRepository {
    return new MemoryGithubPullRequestStatusCacheRepository(parts.memory);
  }

  private constructor(private readonly memory: MemoryGithubDatabase) {
    super();
  }

  async findStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestStatus | null> {
    const row = this.memory.expiring.get(statusKey(input));
    if (!row || row.expiresAt <= nowInstant().epochMilliseconds) {
      return null;
    }

    return STATUSES.find((status) => status === row.value) ?? null;
  }

  async storeStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
    status: GithubPullRequestStatus;
  }): Promise<void> {
    this.memory.expiring.set(statusKey(input), {
      value: input.status,
      expiresAt: nowInstant().epochMilliseconds + STATUS_CACHE_TTL_SEC * 1000,
    });
  }
}

function statusKey(input: { organizationId: string; ref: GithubPullRequestRef }): string {
  const host = input.ref.repositoryHost.toLowerCase();
  const fullName = input.ref.repositoryFullName.toLowerCase();

  return `status:${input.organizationId}:${host}:${fullName}:${input.ref.prNumber}`;
}
