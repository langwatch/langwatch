import type { Cluster, Redis } from "ioredis";

import {
  AgentSandboxKeyRepository,
  AgentSandboxKeyUnreadableError,
  type AgentSandboxKeyCipher,
} from "../agent-sandbox-key.repository.ts";

/** Main's TtlCache prefix and JSON encoding, so a token held before a deploy is still read. */
const KEY_PREFIX = "ttlcache:agent-sandbox-key:";

/** Only what the repository calls. */
export type AgentSandboxKeyRedis = Pick<Redis | Cluster, "get" | "set">;

/** The shared sandbox tokens in Redis, each sealed with the process's cipher and expiring. */
export class RedisAgentSandboxKeyRepository extends AgentSandboxKeyRepository {
  private constructor(
    private readonly redis: AgentSandboxKeyRedis,
    private readonly cipher: AgentSandboxKeyCipher,
  ) {
    super();
  }

  static create({
    redis,
    cipher,
  }: {
    redis: AgentSandboxKeyRedis;
    cipher: AgentSandboxKeyCipher;
  }): RedisAgentSandboxKeyRepository {
    return new RedisAgentSandboxKeyRepository(redis, cipher);
  }

  async findTokens({ projectId }: { projectId: string }): Promise<string[]> {
    const stored = await this.redis.get(`${KEY_PREFIX}${projectId}`);
    if (stored === null) return [];
    try {
      return [this.cipher.decrypt(JSON.parse(stored) as string)];
    } catch (error) {
      throw new AgentSandboxKeyUnreadableError({ cause: error });
    }
  }

  async hold({
    projectId,
    token,
    ttlMs,
  }: {
    projectId: string;
    token: string;
    ttlMs: number;
  }): Promise<void> {
    const sealed = JSON.stringify(this.cipher.encrypt(token));
    await this.redis.set(`${KEY_PREFIX}${projectId}`, sealed, "PX", Math.max(1, Math.floor(ttlMs)));
  }
}
