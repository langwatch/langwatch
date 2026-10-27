import type { McpAuthorizationCodeRecord } from "@langwatch/hosted-mcp-contract";

export type McpAuthorizationCodeConsumption =
  | Readonly<{ kind: "found"; record: McpAuthorizationCodeRecord }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "corrupted" }>;

/** Durable one-time authorization codes for the hosted MCP token exchange. */
export abstract class McpOAuthTokenRepository {
  abstract isAvailable(): boolean;

  abstract consumeAuthorizationCode(input: {
    code: string;
  }): Promise<McpAuthorizationCodeConsumption>;

  abstract storeAuthorizationCode(input: {
    code: string;
    record: McpAuthorizationCodeRecord;
    ttlSeconds: number;
  }): Promise<void>;

  abstract hasRegisteredClient(input: { clientId: string }): Promise<boolean>;
}
