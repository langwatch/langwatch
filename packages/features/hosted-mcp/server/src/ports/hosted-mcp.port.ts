import type { IncomingMessage } from "node:http";
import type { Cluster, Redis } from "ioredis";

/**
 * The Redis connection this endpoint is given.
 *
 * A cluster is one of the two shapes a deployment configures (ADR-093), and
 * naming it here rather than the single-node client is what stops the
 * composition root from having to narrow — every command this endpoint issues
 * is keyed, so both shapes serve them.
 */
export type HostedMcpRedis = Redis | Cluster;

/**
 * The project an MCP caller's API key belongs to.
 *
 * A lookup rather than a database client: the endpoint asks one question of
 * the project catalogue — "whose key is this, and is it still live" — and a
 * client handed in instead would let the answer widen without anyone deciding
 * it should.
 */
export abstract class McpProjectLookupPort {
  abstract findLiveProjectByApiKey(input: {
    apiKey: string;
  }): Promise<{ id: string; teamId: string } | null>;
}

/**
 * Reversible encryption for the API key an OAuth session was minted from.
 *
 * The key is stored, not hashed, because the MCP session has to present it
 * again on every tool call. That makes the cipher a collaborator the process
 * supplies from its own configured secret rather than something this package
 * derives — nothing here should be able to read a customer's key without the
 * process having handed it the means.
 */
export abstract class McpApiKeyCipherPort {
  abstract encrypt(plaintext: string): string;
  abstract decrypt(ciphertext: string): string;
}

/**
 * How the process identifies a caller for rate-limiting purposes.
 *
 * Injected so the endpoint buckets on exactly the address the rest of the
 * deployment rate-limits on, header priority included. Re-deriving it here
 * would be a second policy that agrees today and drifts the first time either
 * side gains an edge in front of it.
 */
export abstract class McpClientAddressPort {
  abstract clientIp(request: IncomingMessage): string;
}

/**
 * The narrow shape of the MCP server object this endpoint registers tools on.
 *
 * `@langwatch/mcp-server` deliberately publishes a narrowed declaration so
 * consumers do not typecheck its dependency tree; this mirrors that narrowing
 * so a caller can pass the same value verbatim without a cast.
 */
export type McpToolServer = {
  tool(name: string, description: string, inputSchema: unknown, callback: unknown): unknown;
};

/**
 * Extra tools installed on each session, supplied by the composing process.
 *
 * This is what keeps the governance tools out of this package. They need an
 * Enterprise service and an organization permission probe, and a core package
 * that named either would be a core package depending on Enterprise. The
 * process that has both registers them through this seam instead; a
 * deployment without them installs nothing and the session still serves every
 * other tool.
 */
export abstract class McpSessionToolRegistrarPort {
  abstract register(input: {
    server: McpToolServer;
    apiKey: string;
    callerUserId: string | undefined;
  }): void;
}

/** Everything the hosted MCP endpoint needs from the process that mounts it. */
export type HostedMcpDependencies = Readonly<{
  /**
   * The process's Redis connection, or nothing when it has none.
   *
   * Null is a supported deployment rather than a failure, and the endpoint
   * branches on it in two different ways (ADR-093): session storage degrades
   * to an in-memory map so a single process keeps working, while the OAuth
   * authorization-code exchange cannot, because the code is written by
   * whichever process served the authorize request.
   */
  redis: HostedMcpRedis | null;
  projects: McpProjectLookupPort;
  cipher: McpApiKeyCipherPort;
  address: McpClientAddressPort;
  /** Absent installs no extra tools; see {@link McpSessionToolRegistrarPort}. */
  sessionTools?: McpSessionToolRegistrarPort | undefined;
  /** The public origin the MCP client is told to come back to. */
  baseHost: string;
}>;
