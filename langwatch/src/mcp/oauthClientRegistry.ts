/**
 * Redis-backed registry binding an MCP OAuth `client_id` (RFC 7591 dynamic
 * client registration) to the `redirect_uris` it registered with.
 *
 * `/mcp/authorize` must validate the caller's `redirect_uri` against this
 * registry with an exact string match before it ever issues an authorization
 * code — an authorization server that accepts any `redirect_uri` lets an
 * attacker who controls the authorization request (and its own PKCE
 * `code_challenge`) redirect a victim's approved code to a domain they
 * control (RFC 6749 §10.6). PKCE does not defend against this: PKCE proves
 * the token-exchanger holds the verifier for the challenge in the code, and
 * an attacker who authored the request holds both.
 */
import { connection as redis } from "~/server/redis";

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

export async function registerOAuthClient(
  clientId: string,
  client: RegisteredOAuthClient,
): Promise<void> {
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

export async function getOAuthClient(
  clientId: string,
): Promise<RegisteredOAuthClient | null> {
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
