import type { McpAuthorizationCodeRecord } from "@langwatch/hosted-mcp-contract";
import { nowInstant } from "@langwatch/time";

import type { McpOAuthClientRepository } from "../mcp-oauth-client.repository.ts";
import {
  type McpAuthorizationCodeConsumption,
  McpOAuthTokenRepository,
} from "../mcp-oauth-token.repository.ts";

/** One-time codes held in this process, each read once and gone after its TTL as Redis's are. */
export class MemoryMcpOAuthTokenRepository extends McpOAuthTokenRepository {
  readonly #codes = new Map<string, { record: McpAuthorizationCodeRecord; expiresAt: number }>();
  readonly #clients: McpOAuthClientRepository;

  private constructor({ clients }: { clients: McpOAuthClientRepository }) {
    super();
    this.#clients = clients;
  }

  /** Reads registrations from the same client records the registration route writes. */
  static create({ clients }: { clients: McpOAuthClientRepository }): MemoryMcpOAuthTokenRepository {
    return new MemoryMcpOAuthTokenRepository({ clients });
  }

  isAvailable(): boolean {
    return true;
  }

  consumeAuthorizationCode({ code }: { code: string }): Promise<McpAuthorizationCodeConsumption> {
    const held = this.#codes.get(code);
    this.#codes.delete(code);
    if (!held || held.expiresAt <= nowInstant().epochMilliseconds) {
      return Promise.resolve({ kind: "missing" });
    }
    return Promise.resolve({ kind: "found", record: held.record });
  }

  storeAuthorizationCode({
    code,
    record,
    ttlSeconds,
  }: {
    code: string;
    record: McpAuthorizationCodeRecord;
    ttlSeconds: number;
  }): Promise<void> {
    this.#codes.set(code, {
      record,
      expiresAt: nowInstant().epochMilliseconds + ttlSeconds * 1_000,
    });
    return Promise.resolve();
  }

  async hasRegisteredClient({ clientId }: { clientId: string }): Promise<boolean> {
    const lookup = await this.#clients.getByClientId({ clientId });
    return lookup.kind === "registered";
  }
}
