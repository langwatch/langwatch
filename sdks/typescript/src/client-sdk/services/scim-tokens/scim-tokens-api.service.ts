/**
 * The `/api/scim-tokens` management family: the bearer tokens an identity
 * provider holds to reach `/api/scim/v2`.
 *
 * The token value exists in the create response and nowhere else; listing
 * describes tokens and never returns a value or a hash.
 *
 * CLI-only, and deliberately not exported from the client SDK's public index.
 */
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  resolveManagementToken,
  type ManagementRequest,
} from "../_shared/management-request";

export interface ScimTokenSummary {
  id: string;
  description: string | null;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface CreatedScimToken {
  id: string;
  /** Returned once, here. The platform cannot show it again. */
  token: string;
  description: string | null;
}

export class ScimTokensApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "ScimTokensApiError";
  }
}

export class ScimTokensApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token: resolveManagementToken({ apiKey: config?.apiKey }),
      errorFactory: ({ message, operation, body }) =>
        new ScimTokensApiError(message, operation, body),
    });
  }

  async list(): Promise<{ tokens: ScimTokenSummary[] }> {
    return this.#request({
      operation: "list SCIM tokens",
      path: "/api/scim-tokens",
    });
  }

  async create(input: { description?: string } = {}): Promise<CreatedScimToken> {
    return this.#request({
      operation: "create SCIM token",
      path: "/api/scim-tokens",
      method: "POST",
      body: input,
    });
  }

  async revoke(id: string): Promise<{ success: true }> {
    return this.#request({
      operation: `revoke SCIM token "${id}"`,
      path: `/api/scim-tokens/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
  }
}
