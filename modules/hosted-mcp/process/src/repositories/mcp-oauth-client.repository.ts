export interface RegisteredOAuthClient {
  redirectUris: string[];
  clientName: string;
}

/** A registry read: the client's registration, or none this server can honour. */
export type RegisteredOAuthClientLookup =
  | { kind: "registered"; client: RegisteredOAuthClient }
  | { kind: "unregistered" };

/**
 * The MCP OAuth client registry: binds a `client_id` (RFC 7591 dynamic client
 * registration) to the `redirect_uris` it registered with.
 */
export abstract class McpOAuthClientRepository {
  abstract register(input: { clientId: string; client: RegisteredOAuthClient }): Promise<void>;

  abstract getByClientId(input: { clientId: string }): Promise<RegisteredOAuthClientLookup>;
}
