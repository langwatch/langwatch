import type { ProcessMembers } from "@langwatch/process-stores/members";

import { GithubInstallNonceRepository } from "../github-install-nonce.repository.ts";

/**
 * The Redis tier. A Redis that cannot answer reads as "replay cannot be
 * judged here" rather than refusing every install.
 */
export class GithubInstallNonceRedisRepository extends GithubInstallNonceRepository {
  static create(redis: ProcessMembers["redis"]): GithubInstallNonceRedisRepository {
    return new GithubInstallNonceRedisRepository(redis);
  }

  private constructor(private readonly redis: ProcessMembers["redis"]) {
    super();
  }

  async registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    try {
      await this.redis.set(nonceKey(input.nonce), "1", "EX", input.ttlSec);
      return true;
    } catch {
      return false;
    }
  }

  async consumeNonce(nonce: string): Promise<"consumed" | "spent" | "unavailable"> {
    try {
      const deleted = await this.redis.getdel(nonceKey(nonce));
      return deleted === null ? "spent" : "consumed";
    } catch {
      return "unavailable";
    }
  }
}

function nonceKey(nonce: string): string {
  return `langy:gh:nonce:${nonce}`;
}
