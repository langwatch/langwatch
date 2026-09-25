/**
 * The MCP OAuth client registry: binds a `client_id` (RFC 7591 dynamic client
 * registration) to the `redirect_uris` it registered with, over the Redis
 * handle the caller already holds.
 */
import type { HostedMcpRedis } from "../app/hosted-mcp-members.ts";

const REDIS_CLIENT_PREFIX = "mcp:oauth:client:";

// Long enough that a real integration (Claude Desktop, Cursor, …) never sees
// its registration expire between ordinary uses. Bounded rather than
// unbounded so an abandoned registration eventually falls out of Redis
// instead of accumulating forever; a client that outlives this window is
// expected to re-register (that's what dynamic client registration is for).
const CLIENT_TTL_SECONDS = 180 * 24 * 60 * 60;

export interface RegisteredOAuthClient {
  redirectUris: string[];
  clientName: string;
}

/** A registry read: the client's registration, or none this server can honour. */
export type RegisteredOAuthClientLookup =
  | { kind: "registered"; client: RegisteredOAuthClient }
  | { kind: "unregistered" };

/**
 * Static members: a registration is addressed by the Redis handle the caller
 * already holds, so there is no per-instance state.
 */
export class McpOAuthClientRegistryService {
  private constructor() {}

  static create(): McpOAuthClientRegistryService {
    return new McpOAuthClientRegistryService();
  }

  static async register({
    redis,
    clientId,
    client,
  }: {
    redis: HostedMcpRedis | null;
    clientId: string;
    client: RegisteredOAuthClient;
  }): Promise<void> {
    if (!redis) {
      throw new Error("Redis is not available");
    }

    await redis.set(
      `${REDIS_CLIENT_PREFIX}${clientId}`,
      JSON.stringify(client),
      "EX",
      CLIENT_TTL_SECONDS,
    );
  }

  static async get({
    redis,
    clientId,
  }: {
    redis: HostedMcpRedis | null;
    clientId: string;
  }): Promise<RegisteredOAuthClientLookup> {
    if (!redis) {
      return { kind: "unregistered" };
    }

    const raw = await redis.get(`${REDIS_CLIENT_PREFIX}${clientId}`);

    if (!raw) {
      return { kind: "unregistered" };
    }

    // A registration we wrote that no longer decodes should be named, not
    // swallowed — but this package has no handled-error dependency to name it
    // with, and a bare SyntaxError would reach the client as an unknown 500.
    // Until it does, the caller's own "unregistered client" refusal is the
    // actionable answer, in the protocol the client already speaks.
    try {
      const parsed = JSON.parse(raw) as RegisteredOAuthClient;

      if (!Array.isArray(parsed.redirectUris)) {
        return { kind: "unregistered" };
      }

      return { kind: "registered", client: parsed };
    } catch {
      return { kind: "unregistered" };
    }
  }
}
