import {
  McpOAuthClientRepository,
  type RegisteredOAuthClient,
  type RegisteredOAuthClientLookup,
} from "../mcp-oauth-client.repository.ts";

/** Registrations held in this process, for a deployment or suite with no Redis to share. */
export class MemoryMcpOAuthClientRepository extends McpOAuthClientRepository {
  readonly #clients = new Map<string, RegisteredOAuthClient>();

  private constructor() {
    super();
  }

  static create(): MemoryMcpOAuthClientRepository {
    return new MemoryMcpOAuthClientRepository();
  }

  register({
    clientId,
    client,
  }: {
    clientId: string;
    client: RegisteredOAuthClient;
  }): Promise<void> {
    this.#clients.set(clientId, client);
    return Promise.resolve();
  }

  getByClientId({ clientId }: { clientId: string }): Promise<RegisteredOAuthClientLookup> {
    const client = this.#clients.get(clientId);
    return Promise.resolve(client ? { kind: "registered", client } : { kind: "unregistered" });
  }
}
