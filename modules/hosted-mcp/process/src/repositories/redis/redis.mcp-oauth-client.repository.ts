import type { Cluster, Redis } from "ioredis";
import { z } from "zod";

import {
  McpOAuthClientRepository,
  type RegisteredOAuthClient,
  type RegisteredOAuthClientLookup,
} from "../mcp-oauth-client.repository.ts";

const REDIS_CLIENT_PREFIX = "mcp:oauth:client:";

/**
 * Long enough that a real integration never sees its registration expire between uses, bounded
 * so an abandoned one eventually falls out of Redis; a client outliving it re-registers.
 */
const CLIENT_TTL_SECONDS = 180 * 24 * 60 * 60;

const storedClientSchema = z.object({
  redirectUris: z.array(z.string()),
  clientName: z.string(),
});

/** Registrations in Redis. With no Redis nothing registers and every client reads unregistered. */
export class RedisMcpOAuthClientRepository extends McpOAuthClientRepository {
  readonly #redis: Redis | Cluster | null;

  private constructor({ redis }: { redis: Redis | Cluster | null }) {
    super();
    this.#redis = redis;
  }

  static create({ redis }: { redis: Redis | Cluster | null }): RedisMcpOAuthClientRepository {
    return new RedisMcpOAuthClientRepository({ redis });
  }

  async register({
    clientId,
    client,
  }: {
    clientId: string;
    client: RegisteredOAuthClient;
  }): Promise<void> {
    if (!this.#redis) throw new Error("Redis is not available");

    await this.#redis.set(
      `${REDIS_CLIENT_PREFIX}${clientId}`,
      JSON.stringify(client),
      "EX",
      CLIENT_TTL_SECONDS,
    );
  }

  /** A registration that no longer decodes reads as unregistered, which the client acts on. */
  async getByClientId({ clientId }: { clientId: string }): Promise<RegisteredOAuthClientLookup> {
    if (!this.#redis) return { kind: "unregistered" };

    const raw = await this.#redis.get(`${REDIS_CLIENT_PREFIX}${clientId}`);
    if (!raw) return { kind: "unregistered" };

    try {
      const parsed = storedClientSchema.safeParse(JSON.parse(raw));
      return parsed.success
        ? { kind: "registered", client: parsed.data }
        : { kind: "unregistered" };
    } catch {
      return { kind: "unregistered" };
    }
  }
}
