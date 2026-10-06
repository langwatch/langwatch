import type { HostedMcpRepositories } from "../hosted-mcp.repositories.ts";
import { MemoryMcpOAuthClientRepository } from "./memory.mcp-oauth-client.repository.ts";
import { MemoryMcpOAuthTokenRepository } from "./memory.mcp-oauth-token.repository.ts";
import { MemoryMcpSessionRelayRepository } from "./memory.mcp-session-relay.repository.ts";
import { MemoryMcpSessionRepository } from "./memory.mcp-session.repository.ts";

/** One process is one replica; the token store reads the clients this bundle registers. */
export class MemoryHostedMcpRepositories {
  static readonly requires = [] as const;

  static create(): HostedMcpRepositories {
    const oauthClients = MemoryMcpOAuthClientRepository.create();
    return {
      sessions: MemoryMcpSessionRepository.create(),
      relay: MemoryMcpSessionRelayRepository.create(),
      oauthTokens: MemoryMcpOAuthTokenRepository.create({ clients: oauthClients }),
      oauthClients,
    };
  }
}
