import type { GithubRedis } from "./github-redis.connection.ts";
import { GithubPullRequestStatusCacheRepository } from "../github-pull-request-status-cache.repository.ts";
import type {
  GithubPullRequestRef,
  GithubPullRequestStatus,
} from "../../services/github-pull-request-status.service.ts";

const STATUS_CACHE_TTL_SEC = 60;
const STATUSES: readonly string[] = ["open", "draft", "merged", "closed"];

/**
 * The Redis tier. The connection is nullable because this module's Redis is
 * optional infrastructure: a process that opened none misses every read, which
 * is what a cold cache does anyway.
 */
export class GithubPullRequestStatusCacheRedisRepository extends GithubPullRequestStatusCacheRepository {
  static create(parts: {
    redis: GithubRedis | null;
  }): GithubPullRequestStatusCacheRedisRepository {
    return new GithubPullRequestStatusCacheRedisRepository(parts.redis);
  }

  private constructor(private readonly redis: GithubRedis | null) {
    super();
  }

  async findStatus(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestStatus | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const value = await this.redis.tryGet(statusKey(input));

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
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.trySet(statusKey(input), input.status, "EX", STATUS_CACHE_TTL_SEC);
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
