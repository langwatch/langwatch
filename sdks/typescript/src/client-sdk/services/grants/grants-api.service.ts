/**
 * The `/api/v1/grants` family, successor to `/api/v1/role-bindings`: who holds which
 * role, where. Built-in roles are `admin`, `member` and `viewer`. CLI-only, and
 * deliberately not exported from the client SDK's public index.
 */
import { resolveEndpoint } from "@/internal/endpoint";

import {
  createManagementRequest,
  managementPath,
  type ManagementRequest,
  resolveManagementToken,
} from "../_shared/management-request";

export const GRANT_PRINCIPAL_TYPES = ["user", "group", "apiKey"] as const;
export type GrantPrincipalType = (typeof GRANT_PRINCIPAL_TYPES)[number];

export const GRANT_SCOPE_TYPES = ["organization", "team", "project"] as const;
export type GrantScopeType = (typeof GRANT_SCOPE_TYPES)[number];

export const GRANT_STATUSES = ["active", "expired"] as const;
export type GrantStatus = (typeof GRANT_STATUSES)[number];

export interface Grant {
  id: string;
  principal: { type: GrantPrincipalType; id: string; name: string | null };
  role: { id: string; name: string | null; builtIn: boolean };
  scope: { type: GrantScopeType; id: string; name: string | null };
  status: GrantStatus;
  expiresAt: string | null;
  createdAt: string;
}

/** Every filter is optional; an omitted one is left off the request. */
export interface ListGrantsOptions {
  principalType?: GrantPrincipalType;
  principalId?: string;
  roleId?: string;
  scopeType?: GrantScopeType;
  scopeId?: string;
  status?: GrantStatus;
  limit?: number;
  cursor?: string;
}

export interface GrantPage {
  grants: Grant[];
  /** Null when the list is finished. */
  nextCursor: string | null;
}

export interface CreateGrantInput {
  principal: { type: GrantPrincipalType; id: string };
  roleId: string;
  scope: { type: GrantScopeType; id: string };
  /** ISO-8601, strictly in the future. */
  expiresAt?: string;
}

export class GrantsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "GrantsApiError";
  }
}

export class GrantsApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token: resolveManagementToken({ apiKey: config?.apiKey }),
      errorFactory: ({ message, operation, body }) => new GrantsApiError(message, operation, body),
    });
  }

  async list(options: ListGrantsOptions = {}): Promise<GrantPage> {
    return this.#request({
      operation: "list grants",
      path: managementPath("/api/v1/grants"),
      query: { ...options },
    });
  }

  async get(id: string): Promise<Grant> {
    return this.#request({
      operation: `fetch grant "${id}"`,
      path: managementPath(`/api/v1/grants/${encodeURIComponent(id)}`),
    });
  }

  /** A retry carrying the same `idempotencyKey` and body makes one grant. */
  async create({
    input,
    idempotencyKey,
  }: {
    input: CreateGrantInput;
    idempotencyKey?: string;
  }): Promise<Grant> {
    return this.#request({
      operation: "create grant",
      path: managementPath("/api/v1/grants"),
      method: "POST",
      body: input,
      ...(idempotencyKey !== undefined ? { headers: { "Idempotency-Key": idempotencyKey } } : {}),
    });
  }

  /** Only the role changes: the principal and scope are the grant's identity. */
  async changeRole({ id, roleId }: { id: string; roleId: string }): Promise<Grant> {
    return this.#request({
      operation: `change the role of grant "${id}"`,
      path: managementPath(`/api/v1/grants/${encodeURIComponent(id)}`),
      method: "PATCH",
      body: { roleId },
    });
  }

  async revoke(id: string): Promise<{ id: string; revoked: true }> {
    return this.#request({
      operation: `revoke grant "${id}"`,
      path: managementPath(`/api/v1/grants/${encodeURIComponent(id)}`),
      method: "DELETE",
    });
  }
}
