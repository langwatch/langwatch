import { nowInstant } from "@langwatch/time";

import { GithubInstallNonceRepository } from "../github-install-nonce.repository.ts";
import type { MemoryGithubDatabase } from "./memory.github.database.ts";

/**
 * The memory twin of the installation nonces, over the same expiring rows the
 * token cache twin writes. A nonce is taken once: the second consume answers
 * false, the way a deleted key does.
 */
export class MemoryGithubInstallNonceRepository extends GithubInstallNonceRepository {
  static create(parts: { memory: MemoryGithubDatabase }): MemoryGithubInstallNonceRepository {
    return new MemoryGithubInstallNonceRepository(parts.memory);
  }

  private constructor(private readonly memory: MemoryGithubDatabase) {
    super();
  }

  async registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean> {
    this.memory.expiring.set(key(input.nonce), {
      value: "1",
      expiresAt: nowInstant().epochMilliseconds + input.ttlSec * 1000,
    });

    return true;
  }

  async consumeNonce(nonce: string): Promise<boolean | null> {
    const row = this.memory.expiring.get(key(nonce));
    if (!row) {
      return false;
    }

    this.memory.expiring.delete(key(nonce));

    return row.expiresAt > nowInstant().epochMilliseconds;
  }
}

function key(nonce: string): string {
  return `nonce:${nonce}`;
}
