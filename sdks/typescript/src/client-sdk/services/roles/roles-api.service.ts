/**
 * The `/api/roles` management family: the organization's custom RBAC roles and
 * the permission catalog they are built from.
 *
 * CLI-only, and deliberately not exported from the client SDK's public index.
 */
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  type ManagementRequest,
} from "../_shared/management-request";

export interface CustomRole {
  id: string;
  name: string;
  description: string | null;
  permissions: string[];
  createdAt: string;
  updatedAt: string;
}

export interface CreateRoleInput {
  name: string;
  description?: string;
  /** `resource:action` keys; at least one. */
  permissions: string[];
}

/** Partial. A permissions list replaces the set outright. */
export interface UpdateRoleInput {
  name?: string;
  description?: string | null;
  permissions?: string[];
}

export interface PermissionCatalog {
  resources: Array<{
    resource: string;
    /** True when the resource only takes effect at organization scope. */
    organizationExclusive: boolean;
    actions: string[];
    permissions: string[];
  }>;
  actions: string[];
}

export class RolesApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "RolesApiError";
  }
}

export class RolesApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token:
        config?.apiKey ??
        scopedApiKey() ??
        process.env.LANGWATCH_API_KEY ??
        "",
      errorFactory: ({ message, operation, body }) =>
        new RolesApiError(message, operation, body),
    });
  }

  async list(): Promise<{ roles: CustomRole[] }> {
    return this.#request({
      operation: "list custom roles",
      path: "/api/roles",
    });
  }

  async get(id: string): Promise<CustomRole> {
    return this.#request({
      operation: `fetch custom role "${id}"`,
      path: `/api/roles/${encodeURIComponent(id)}`,
    });
  }

  async create(input: CreateRoleInput): Promise<CustomRole> {
    return this.#request({
      operation: "create custom role",
      path: "/api/roles",
      method: "POST",
      body: input,
    });
  }

  async update(id: string, input: UpdateRoleInput): Promise<CustomRole> {
    return this.#request({
      operation: `update custom role "${id}"`,
      path: `/api/roles/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: input,
    });
  }

  async delete(id: string): Promise<{ success: true }> {
    return this.#request({
      operation: `delete custom role "${id}"`,
      path: `/api/roles/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
  }

  async permissions(): Promise<PermissionCatalog> {
    return this.#request({
      operation: "fetch the permission catalog",
      path: "/api/roles/permissions",
    });
  }
}
