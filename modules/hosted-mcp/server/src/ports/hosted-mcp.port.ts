import type { IncomingMessage } from "node:http";
import type { Cluster, Redis } from "ioredis";

/**
 * The Redis connection this endpoint is given.
 * A cluster is one of the two shapes a deployment configures (ADR-093), and
 */
export type HostedMcpRedis = Redis | Cluster;

/**
 * The project an MCP caller's API key belongs to.
 */
export abstract class McpProjectLookupPort {
  abstract tryFindLiveProjectByApiKey(input: {
    apiKey: string;
  }): Promise<{ id: string; teamId: string } | null>;
}

/**
 * Reversible encryption for the API key an OAuth session was minted from. The key is stored,
 * not hashed, because the MCP session has to present it again on every tool call.
 */
export abstract class McpApiKeyCipherPort {
  abstract encrypt(plaintext: string): string;
  abstract decrypt(ciphertext: string): string;
}

/**
 * Whether the grant an OAuth bearer was minted from still holds.
 */
export abstract class McpSessionGrantPort {
  abstract stillGranted(input: { userId: string; projectId: string }): Promise<boolean>;
}

/**
 * How the process identifies a caller for rate-limiting purposes. Injected so the endpoint
 * buckets on exactly the address the rest of the deployment rate-limits on, header priority
 * included.
 */
export abstract class McpClientAddressPort {
  abstract clientIp(request: IncomingMessage): string;
}

/**
 * The narrow shape of the MCP server object this endpoint registers tools on.
 */
export type McpToolServer = {
  tool(name: string, description: string, inputSchema: unknown, callback: unknown): unknown;
};

/**
 * Extra tools installed on each session, supplied by the composing process. This is what keeps
 * the governance tools out of this package.
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
   * The process's Redis connection, or nothing when it has none. Null is a supported deployment
   * rather than a failure, and the endpoint
   * branches on it in two different ways (ADR-093): session storage degrades
   */
  redis: HostedMcpRedis | null;
  projects: McpProjectLookupPort;
  /** Required, not optional: an unwired re-check is a token that never expires. */
  grants: McpSessionGrantPort;
  cipher: McpApiKeyCipherPort;
  address: McpClientAddressPort;
  /** Absent installs no extra tools; see {@link McpSessionToolRegistrarPort}. */
  sessionTools?: McpSessionToolRegistrarPort | undefined;
  /** The public origin the MCP client is told to come back to. */
  baseHost: string;
}>;
