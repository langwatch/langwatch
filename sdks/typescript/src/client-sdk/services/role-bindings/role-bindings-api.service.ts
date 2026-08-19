/**
 * The `/api/role-bindings` management family: who holds which role, where.
 *
 * CLI-only, and deliberately not exported from the client SDK's public index.
 */
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  type ManagementRequest,
  resolveManagementToken,
} from "../_shared/management-request";
import type {
  ManagementRole,
  ManagementScopeType,
} from "../_shared/management-types";

/** The three kinds of principal a binding can name. */
export const ROLE_BINDING_PRINCIPAL_TYPES = [
  "user",
  "group",
  "apiKey",
] as const;

export type RoleBindingPrincipalType =
  (typeof ROLE_BINDING_PRINCIPAL_TYPES)[number];

export interface RoleBindingPrincipal {
  type: RoleBindingPrincipalType;
  id: string;
  name: string | null;
}

export interface RoleBinding {
  id: string;
  principal: RoleBindingPrincipal;
  role: ManagementRole;
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: ManagementScopeType;
  scopeId: string;
  scopeName: string | null;
  createdAt: string;
}

export interface CreatedRoleBinding extends RoleBinding {
  /**
   * Present only when this is the user's first explicit binding and their
   * access so far derived from legacy team membership, which this write
   * switches off.
   */
  hasLegacyAccessNotice?: boolean;
}

/** Every filter is optional; an omitted one is left off the request. */
export interface ListRoleBindingsOptions {
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
  scopeType?: ManagementScopeType;
  scopeId?: string;
  offset?: number;
  limit?: number;
}

export interface ListRoleBindingsResponse {
  bindings: RoleBinding[];
  totalCount: number;
}

/** Exactly one of userId, groupId or apiKeyId. */
export interface CreateRoleBindingInput {
  userId?: string;
  groupId?: string;
  apiKeyId?: string;
  role: ManagementRole;
  customRoleId?: string;
  scopeType: ManagementScopeType;
  scopeId: string;
}

/** Only the role can change; principal and scope are the binding's identity. */
export interface UpdateRoleBindingInput {
  role: ManagementRole;
  customRoleId?: string;
}

export class RoleBindingsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "RoleBindingsApiError";
  }
}

export class RoleBindingsApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token: resolveManagementToken({ apiKey: config?.apiKey }),
      errorFactory: ({ message, operation, body }) =>
        new RoleBindingsApiError(message, operation, body),
    });
  }

  async list(
    options: ListRoleBindingsOptions = {},
  ): Promise<ListRoleBindingsResponse> {
    return this.#request({
      operation: "list role bindings",
      path: "/api/role-bindings",
      query: { ...options },
    });
  }

  async create(input: CreateRoleBindingInput): Promise<CreatedRoleBinding> {
    return this.#request({
      operation: "create role binding",
      path: "/api/role-bindings",
      method: "POST",
      body: input,
    });
  }

  async update({
    id,
    input,
  }: {
    id: string;
    input: UpdateRoleBindingInput;
  }): Promise<RoleBinding> {
    return this.#request({
      operation: `update role binding "${id}"`,
      path: `/api/role-bindings/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: input,
    });
  }

  async delete(id: string): Promise<{ success: true }> {
    return this.#request({
      operation: `delete role binding "${id}"`,
      path: `/api/role-bindings/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
  }
}
