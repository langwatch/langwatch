import type { GithubRedisPort } from "../ports/github-app-token.port";
import type {
  GithubPullRequestRef,
  GithubPullRequestStatus,
} from "./github-pull-request-status.service";

const STATUS_CACHE_TTL_SEC = 60;
const STATUSES: readonly string[] = ["open", "draft", "merged", "closed"];

function cacheKey(input: { organizationId: string; ref: GithubPullRequestRef }): string {
  const host = input.ref.repositoryHost.toLowerCase();
  const fullName = input.ref.repositoryFullName.toLowerCase();
  return `gh:prstatus:${input.organizationId}:${host}:${fullName}:${input.ref.prNumber}`;
}

function isStatus(value: unknown): value is GithubPullRequestStatus {
  return typeof value === "string" && STATUSES.includes(value);
}

export class GithubPullRequestStatusCacheService {
  static create(redis: GithubRedisPort | null): GithubPullRequestStatusCacheService {
    return new GithubPullRequestStatusCacheService(redis);
  }

  private constructor(private readonly redis: GithubRedisPort | null) {}

  async tryRead(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
  }): Promise<GithubPullRequestStatus | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const value = await this.redis.tryGet(cacheKey(input));
      return isStatus(value) ? value : null;
    } catch {
      return null;
    }
  }

  async write(input: {
    organizationId: string;
    ref: GithubPullRequestRef;
    status: GithubPullRequestStatus;
  }): Promise<void> {
    if (!this.redis) {
      return;
    }

    try {
      await this.redis.trySet(cacheKey(input), input.status, "EX", STATUS_CACHE_TTL_SEC);
    } catch {
      // A status read remains valid if its cache write fails.
    }
  }
}
