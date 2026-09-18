import type {
  McpAuthorizationCodeRecord,
  McpOAuthTokenRecord,
} from "@langwatch/hosted-mcp-contract";

export type McpAuthorizationCodeConsumption =
  | Readonly<{ kind: "found"; record: McpAuthorizationCodeRecord }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "corrupted" }>;

export type McpOAuthBearerLookup =
  | Readonly<{ kind: "found"; record: McpOAuthTokenRecord }>
  | Readonly<{ kind: "missing" }>
  | Readonly<{ kind: "corrupted" }>;

/** Durable OAuth records used by the hosted MCP token exchange. */
export abstract class McpOAuthTokenRepository {
  abstract isAvailable(): boolean;

  abstract consumeAuthorizationCode(input: {
    code: string;
  }): Promise<McpAuthorizationCodeConsumption>;

  abstract hasRegisteredClient(input: { clientId: string }): Promise<boolean>;

  abstract findBearer(input: { token: string }): Promise<McpOAuthBearerLookup>;

  abstract storeBearer(input: { token: string; record: McpOAuthTokenRecord }): Promise<void>;

  abstract removeBearer(input: { token: string }): Promise<void>;
}
