import type { McpOAuthClientRepository } from "./mcp-oauth-client.repository.ts";
import type { McpOAuthTokenRepository } from "./mcp-oauth-token.repository.ts";
import type { McpSessionRelayRepository } from "./mcp-session-relay.repository.ts";
import type { McpSessionRepository } from "./mcp-session.repository.ts";

export interface HostedMcpRepositories {
  /** The record every replica reads to recover a session it did not open. */
  readonly sessions: McpSessionRepository;
  /** Carries a client message to the replica holding that session's SSE stream. */
  readonly relay: McpSessionRelayRepository;
  readonly oauthTokens: McpOAuthTokenRepository;
  readonly oauthClients: McpOAuthClientRepository;
}
