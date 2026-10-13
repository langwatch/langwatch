import type { Cluster, Redis } from "ioredis";

import type { HostedMcpRepositories } from "../hosted-mcp.repositories.ts";
import type { McpSessionCipher } from "../mcp-session.repository.ts";
import { RedisMcpOAuthClientRepository } from "../redis/redis.mcp-oauth-client.repository.ts";
import { RedisMcpOAuthTokenRepository } from "../redis/redis.mcp-oauth-token.repository.ts";
import { RedisMcpSessionRelayRepository } from "../redis/redis.mcp-session-relay.repository.ts";
import { RedisMcpSessionRepository } from "../redis/redis.mcp-session.repository.ts";

/**
 * Hosted MCP's live stores, all in the process's Redis (ADR-093), where every replica reads
 * the same sessions, codes and clients. A session record seals its credential with the
 * process's cipher; a process with no Redis or no key refuses at boot, naming it.
 */
export class LiveHostedMcpRepositories {
  static readonly requires = ["encryption", "redis"] as const;

  static create({
    encryption,
    redis,
  }: Readonly<{ encryption: McpSessionCipher; redis: Redis | Cluster }>): HostedMcpRepositories {
    return {
      sessions: RedisMcpSessionRepository.create({ redis, cipher: encryption }),
      relay: RedisMcpSessionRelayRepository.create({ redis }),
      oauthTokens: RedisMcpOAuthTokenRepository.create({ redis }),
      oauthClients: RedisMcpOAuthClientRepository.create({ redis }),
    };
  }
}
