/**
 * Redis-backed registry binding an MCP OAuth `client_id` (RFC 7591 dynamic client registration)
 * to the `redirect_uris` it registered with.
 */
import type { HostedMcpRedis } from "../../ports/hosted-mcp.port";

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

/**
 * The registry itself. Static members: a registration is addressed by the
 * Redis handle the caller already holds, so there is no per-instance state.
 */
export class RedisOAuthClientRepository {
  private constructor() {}

  static create(): RedisOAuthClientRepository {
    return new RedisOAuthClientRepository();
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

  static async tryGet({
    redis,
    clientId,
  }: {
    redis: HostedMcpRedis | null;
    clientId: string;
  }): Promise<RegisteredOAuthClient | null> {
    if (!redis) return null;
    const raw = await redis.get(`${REDIS_CLIENT_PREFIX}${clientId}`);
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw) as RegisteredOAuthClient;
      if (!Array.isArray(parsed.redirectUris)) return null;
      return parsed;
    } catch {
      return null;
    }
  }
}
