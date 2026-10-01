import type { ProcessMembers } from "@langwatch/process-stores/members";

import type {
  GithubPullRequestRef,
  GithubPullRequestStatus,
} from "../../services/github-pull-request-status.service.ts";
import { GithubPullRequestStatusCacheRepository } from "../github-pull-request-status-cache.repository.ts";

const STATUS_CACHE_TTL_SEC = 60;
const STATUSES: readonly string[] = ["open", "draft", "merged", "closed"];

/** The Redis tier. A Redis that cannot answer misses, which is what a cold cache does anyway. */
export class GithubPullRequestStatusCacheRedisRepository extends GithubPullRequestStatusCacheRepository {
  static create(redis: ProcessMembers["redis"]): GithubPullRequestStatusCacheRedisRepository {
    return new GithubPullRequestStatusCacheRedisRepository(redis);
  }

  private constructor(private readonly redis: ProcessMembers["redis"]) {
    super();
  }

  async findStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestStatus | null> {
    try {
      const value = await this.redis.get(statusKey(input));

      return isStatus(value) ? value : null;
    } catch {
      return null;
    }
  }

  async storeStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
    status: GithubPullRequestStatus;
  }): Promise<void> {
    try {
      await this.redis.set(statusKey(input), input.status, "EX", STATUS_CACHE_TTL_SEC);
    } catch {
      // A status read remains valid if its cache write fails.
    }
  }
}

function statusKey(input: { organizationId: string; ref: GithubPullRequestRef }): string {
  const host = input.ref.repositoryHost.toLowerCase();
  const fullName = input.ref.repositoryFullName.toLowerCase();

  return `gh:prstatus:${input.organizationId}:${host}:${fullName}:${input.ref.prNumber}`;
}

function isStatus(value: unknown): value is GithubPullRequestStatus {
  return typeof value === "string" && STATUSES.includes(value);
}
