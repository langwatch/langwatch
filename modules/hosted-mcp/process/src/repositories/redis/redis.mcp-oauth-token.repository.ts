import {
  mcpAuthorizationCodeRecordSchema,
  mcpOAuthTokenRecordSchema,
  type McpOAuthTokenRecord,
} from "@langwatch/hosted-mcp-contract";

import type { HostedMcpRedis } from "../../app/hosted-mcp-members.ts";
import { McpOAuthClientRegistryService } from "../../services/mcp-oauth-client-registry.service.ts";
import {
  McpOAuthTokenRepository,
  type McpAuthorizationCodeConsumption,
  type McpOAuthBearerLookup,
} from "../mcp-oauth-token.repository.ts";

const REDIS_TOKEN_PREFIX = "mcp:oauth:token:";
const REDIS_AUTH_CODE_PREFIX = "mcp:auth_code:";
const TOKEN_TTL_SECONDS = 30 * 24 * 3600;

/** Redis persistence for encrypted OAuth bearers and one-time codes. */
export class RedisMcpOAuthTokenRepository extends McpOAuthTokenRepository {
  readonly #redis: HostedMcpRedis | null;

  private constructor({ redis }: { redis: HostedMcpRedis | null }) {
    super();
    this.#redis = redis;
  }

  static create({ redis }: { redis: HostedMcpRedis | null }): RedisMcpOAuthTokenRepository {
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

  async hasRegisteredClient({ clientId }: { clientId: string }): Promise<boolean> {
    const lookup = await McpOAuthClientRegistryService.get({ redis: this.#redis, clientId });
    return lookup.kind === "registered";
  }

  async findBearer({ token }: { token: string }): Promise<McpOAuthBearerLookup> {
    const redis = this.#redis;
    if (!redis) return { kind: "missing" };

    const raw = await redis.get(`${REDIS_TOKEN_PREFIX}${token}`);
    if (!raw) return { kind: "missing" };

    try {
      const parsed = mcpOAuthTokenRecordSchema.safeParse(JSON.parse(raw));
      return parsed.success ? { kind: "found", record: parsed.data } : { kind: "corrupted" };
    } catch {
      return { kind: "corrupted" };
    }
  }

  async storeBearer({
    token,
    record,
  }: {
    token: string;
    record: McpOAuthTokenRecord;
  }): Promise<void> {
    const redis = this.#redis;
    if (!redis) return;
    await redis.set(
      `${REDIS_TOKEN_PREFIX}${token}`,
      JSON.stringify(record),
      "EX",
      TOKEN_TTL_SECONDS,
    );
  }

  async removeBearer({ token }: { token: string }): Promise<void> {
    const redis = this.#redis;
    if (!redis) return;
    await redis.del(`${REDIS_TOKEN_PREFIX}${token}`);
  }
}
