import {
  mcpAuthorizationCodeRecordSchema,
  type McpAuthorizationCodeRecord,
} from "@langwatch/hosted-mcp-contract";
import type { Cluster, Redis } from "ioredis";

import {
  McpOAuthTokenRepository,
  type McpAuthorizationCodeConsumption,
} from "../mcp-oauth-token.repository.ts";
import { RedisMcpOAuthClientRepository } from "./redis.mcp-oauth-client.repository.ts";

const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";

/** Redis persistence for one-time OAuth authorization codes. */
export class RedisMcpOAuthTokenRepository extends McpOAuthTokenRepository {
  readonly #redis: Redis | Cluster | null;
  readonly #clients: RedisMcpOAuthClientRepository;

  private constructor({ redis }: { redis: Redis | Cluster | null }) {
    super();
    this.#redis = redis;
    this.#clients = RedisMcpOAuthClientRepository.create({ redis });
  }

  static create({ redis }: { redis: Redis | Cluster | null }): RedisMcpOAuthTokenRepository {
    return new RedisMcpOAuthTokenRepository({ redis });
  }

  isAvailable(): boolean {
    return this.#redis !== null;
  }

  async consumeAuthorizationCode({
    code,
  }: {
    code: string;
  }): Promise<McpAuthorizationCodeConsumption> {
    const redis = this.#redis;
    if (!redis) return { kind: "missing" };

    const raw = await redis.call("GETDEL", `${REDIS_AUTH_CODE_PREFIX}${code}`);
    if (typeof raw !== "string") return { kind: "missing" };

    try {
      const parsed = mcpAuthorizationCodeRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? { kind: "found", record: parsed.data } : { kind: "corrupted" };
    } catch {
      return { kind: "corrupted" };
    }
  }

  async storeAuthorizationCode({
    code,
    record,
    ttlSeconds,
  }: {
    code: string;
    record: McpAuthorizationCodeRecord;
    ttlSeconds: number;
  }): Promise<void> {
    if (!this.#redis) throw new Error("Redis is not available");
    await this.#redis.set(
      `${REDIS_AUTH_CODE_PREFIX}${code}`,
      JSON.stringify(record),
      "EX",
      ttlSeconds,
    );
  }

  async hasRegisteredClient({ clientId }: { clientId: string }): Promise<boolean> {
    const lookup = await this.#clients.getByClientId({ clientId });
    return lookup.kind === "registered";
  }
}
