import { GithubInstallNonceRepository } from "../github-install-nonce.repository.ts";
import type { GithubRedis } from "./github-redis.connection.ts";

/**
 * The Redis tier. The connection is nullable because this module's Redis
 * member is optional: a process with none answers null, and the installation
 * flow reads that as "replay cannot be judged here" rather than refusing every install.
 */
export class GithubInstallNonceRedisRepository extends GithubInstallNonceRepository {
  static create(parts: { redis: GithubRedis | null }): GithubInstallNonceRedisRepository {
    return new GithubInstallNonceRedisRepository(parts.redis);
  }

  private constructor(private readonly redis: GithubRedis | null) {
    super();
  }

  async registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    if (!this.redis) {
      return false;
    }

    try {
      await this.redis.set(nonceKey(input.nonce), "1", "EX", input.ttlSec);
      return true;
    } catch {
      return false;
    }
  }

  async consumeNonce(nonce: string): Promise<boolean | null> {
    if (!this.redis) {
      return null;
    }

    try {
      const key = nonceKey(nonce);
      const deleted = await this.redis.getDelete(key);
      if (deleted !== null) {
        return true;
      }

      const result = await this.redis.evaluate(
        "local v = redis.call('GET', KEYS[1])\nif v then redis.call('DEL', KEYS[1]) return 1 else return 0 end",
        1,
        key,
      );
      if (result !== null) {
        return result === 1 || result === "1";
      }

      const value = await this.redis.get(key);
      if (value === null) {
        return false;
      }

      await this.redis.delete(key);
      return true;
    } catch {
      return null;
    }
  }
}

function nonceKey(nonce: string): string {
  return `langy:gh:nonce:${nonce}`;
}
