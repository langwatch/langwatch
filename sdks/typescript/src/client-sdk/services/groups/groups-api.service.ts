/**
 * The `/api/groups` REST family, which shipped without a CLI.
 *
 * A group is a container of members that carries role bindings, so granting a
 * group access grants every member it. Groups are an Enterprise capability:
 * every route answers 402 `enterprise_plan_required` below that plan, which
 * the CLI renders with upgrade guidance.
 *
 * CLI-only, and deliberately not exported from the client SDK's public index.
 */
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  resolveManagementToken,
  type ManagementRequest,
} from "../_shared/management-request";
import type {
  ManagementBindingInput,
  ManagementRole,
  ManagementScopeType,
} from "../_shared/management-types";

export interface GroupBinding {
  id: string;
  role: ManagementRole;
  customRoleId: string | null;
  customRoleName: string | null;
  scopeType: ManagementScopeType;
  scopeId: string;
}

export interface GroupSummary {
  id: string;
  name: string;
  slug: string;
  externalId: string | null;
  scimSource: string | null;
  memberCount: number;
  bindings: GroupBinding[];
  createdAt: string;
}

export interface GroupPagination {
  page: number;
  limit: number;
  total: number;
}

export interface ListGroupsResponse {
  data: GroupSummary[];
  pagination: GroupPagination;
}

export interface GroupMember {
  userId: string;
  name: string | null;
  email: string | null;
}

export interface GroupDetail {
  id: string;
  name: string;
  slug: string;
  externalId: string | null;
  scimSource: string | null;
  members: GroupMember[];
  bindings: GroupBinding[];
}

export interface CreatedGroup {
  id: string;
  name: string;
  slug: string;
  organizationId: string;
  createdAt: string;
}

export interface CreateGroupInput {
  name: string;
  bindings?: ManagementBindingInput[];
  memberIds?: string[];
}

export interface CreatedGroupBinding {
  id: string;
  role: ManagementRole;
  scopeType: ManagementScopeType;
  scopeId: string;
}

export class GroupsApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "GroupsApiError";
  }
}

export class GroupsApiService {
  readonly #request: ManagementRequest;

  constructor(config?: { endpoint?: string; apiKey?: string }) {
    this.#request = createManagementRequest({
      endpoint: resolveEndpoint(config?.endpoint),
      token: resolveManagementToken({ apiKey: config?.apiKey }),
      errorFactory: ({ message, operation, body }) =>
        new GroupsApiError(message, operation, body),
    });
  }

  async list(
    options: { page?: number; limit?: number } = {},
  ): Promise<ListGroupsResponse> {
    return this.#request({
      operation: "list groups",
      path: "/api/groups",
      query: { ...options },
    });
  }

  async get(id: string): Promise<GroupDetail> {
    return this.#request({
      operation: `fetch group "${id}"`,
      path: `/api/groups/${encodeURIComponent(id)}`,
    });
  }

  async create(input: CreateGroupInput): Promise<CreatedGroup> {
    return this.#request({
      operation: "create group",
      path: "/api/groups",
      method: "POST",
      body: input,
    });
  }

  async rename({
    id,
    input,
  }: {
    id: string;
    input: { name: string };
  }): Promise<{ id: string; name: string; slug: string }> {
    return this.#request({
      operation: `rename group "${id}"`,
      path: `/api/groups/${encodeURIComponent(id)}`,
      method: "PATCH",
      body: input,
    });
  }

  async delete(id: string): Promise<{ success: boolean }> {
    return this.#request({
      operation: `delete group "${id}"`,
      path: `/api/groups/${encodeURIComponent(id)}`,
      method: "DELETE",
    });
  }

  async listMembers(groupId: string): Promise<{ data: GroupMember[] }> {
    return this.#request({
      operation: `list members of group "${groupId}"`,
      path: `/api/groups/${encodeURIComponent(groupId)}/members`,
    });
  }

  async addMember({
    groupId,
    input,
  }: {
    groupId: string;
    input: { userId: string };
  }): Promise<{ success: boolean }> {
    return this.#request({
      operation: `add a member to group "${groupId}"`,
      path: `/api/groups/${encodeURIComponent(groupId)}/members`,
      method: "POST",
      body: input,
    });
  }

  async removeMember({
    groupId,
    userId,
  }: {
    groupId: string;
    userId: string;
  }): Promise<{ success: boolean }> {
    return this.#request({
      operation: `remove member "${userId}" from group "${groupId}"`,
      path: `/api/groups/${encodeURIComponent(groupId)}/members/${encodeURIComponent(userId)}`,
      method: "DELETE",
    });
  }

  async listBindings(groupId: string): Promise<{ data: GroupBinding[] }> {
    return this.#request({
      operation: `list bindings of group "${groupId}"`,
      path: `/api/groups/${encodeURIComponent(groupId)}/bindings`,
    });
  }

  async addBinding({
    groupId,
    input,
  }: {
    groupId: string;
    input: ManagementBindingInput;
  }): Promise<CreatedGroupBinding> {
    return this.#request({
      operation: `add a binding to group "${groupId}"`,
      path: `/api/groups/${encodeURIComponent(groupId)}/bindings`,
      method: "POST",
      body: input,
    });
  }

  async removeBinding({
    groupId,
    bindingId,
  }: {
    groupId: string;
    bindingId: string;
  }): Promise<{ success: boolean }> {
    return this.#request({
      operation: `remove binding "${bindingId}" from group "${groupId}"`,
      path: `/api/groups/${encodeURIComponent(groupId)}/bindings/${encodeURIComponent(bindingId)}`,
      method: "DELETE",
    });
  }
}
