/**
 * The `/api/organization` management family: the organization profile, its
 * members and its invites, all implied by the credential rather than addressed
 * by an id.
 *
 * CLI-only, like the other management services: it is deliberately not exported
 * from the client SDK's public index, because an application talking to
 * LangWatch instruments and reads data, it does not provision the organization
 * it runs inside.
 */
import { scopedApiKey } from "@/internal/credentialContext";
import { resolveEndpoint } from "@/internal/endpoint";
import {
  createManagementRequest,
  type ManagementRequest,
} from "../_shared/management-request";
import type {
  ManagementScopeType,
  OrganizationRole,
} from "../_shared/management-types";

export interface OrganizationSettings {
  id: string;
  name: string;
  slug: string;
  supportContact: string | null;
  presenceEnabled: boolean;
  traceSharingEnabled: boolean;
  primaryIntent: string | null;
  s3Endpoint: string | null;
  s3AccessKeyId: string | null;
  s3Bucket: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Partial: only the fields present are written. */
export interface UpdateOrganizationInput {
  name?: string;
  supportContact?: string | null;
  presenceEnabled?: boolean;
  traceSharingEnabled?: boolean;
  primaryIntent?: string | null;
  s3Endpoint?: string | null;
  s3AccessKeyId?: string | null;
  s3SecretAccessKey?: string | null;
  s3Bucket?: string | null;
}

export interface OrganizationMember {
  userId: string;
  role: OrganizationRole;
  disabled: boolean;
  disabledAt: string | null;
  createdAt: string;
  updatedAt: string;
  user: { id: string; name: string | null; email: string | null };
}

export interface OrganizationMemberTeam {
  teamId: string;
  teamName: string;
  role: string;
  customRoleId: string | null;
  customRoleName: string | null;
}

export interface OrganizationMemberDetail extends OrganizationMember {
  teams: OrganizationMemberTeam[];
}

export interface UpdatedOrganizationMember extends OrganizationMember {
  /** Teams the change left with no administrator. Informative, never blocking. */
  teamsLeftWithoutAdmin?: Array<{ id: string; name: string }>;
}

export interface ListMembersOptions {
  includeDisabled?: boolean;
  offset?: number;
  limit?: number;
}

export interface ListMembersResponse {
  members: OrganizationMember[];
  totalCount: number;
}

export interface MemberAccessBinding {
  id: string;
  role: string;
  customRoleName: string | null;
  scopeType: ManagementScopeType;
  scopeId: string;
  scopeName: string | null;
  permissions: string[];
}

export interface MemberAccessBreakdown {
  user: {
    id: string;
    name: string | null;
    email: string | null;
    orgRole: string;
    orgRolePermissions: string[];
  };
  groups: Array<{
    id: string;
    name: string;
    slug: string;
    scimSource: string | null;
    bindings: MemberAccessBinding[];
  }>;
  directBindings: MemberAccessBinding[];
}

export interface InviteTeamAssignment {
  teamId: string;
  role: string;
  customRoleId: string | null;
}

export interface OrganizationInvite {
  id: string;
  email: string;
  role: OrganizationRole;
  status: string;
  expiration: string | null;
  inviteCode: string;
  inviteUrl: string;
  teams: InviteTeamAssignment[];
  createdAt: string;
}

export interface CreatedOrganizationInvite extends OrganizationInvite {
  /** True when the invite exists but its email could not be delivered. */
  emailNotSent: boolean;
}

/** One invite in the batch, exactly as the wire takes it. */
export interface InviteInput {
  email: string;
  role: OrganizationRole;
  teams: Array<{ teamId: string; role: string; customRoleId?: string }>;
}

export interface CreateInvitesInput {
  invites: InviteInput[];
}

export class OrganizationApiError extends Error {
  constructor(
    message: string,
    public readonly operation: string,
    public readonly originalError?: unknown,
  ) {
    super(message);
    this.name = "OrganizationApiError";
  }
}

export class OrganizationApiService {
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
        new OrganizationApiError(message, operation, body),
    });
  }

  async get(): Promise<OrganizationSettings> {
    return this.#request({
      operation: "fetch the organization",
      path: "/api/organization",
    });
  }

  async update(input: UpdateOrganizationInput): Promise<OrganizationSettings> {
    return this.#request({
      operation: "update the organization",
      path: "/api/organization",
      method: "PATCH",
      body: input,
    });
  }

  async listMembers(
    options: ListMembersOptions = {},
  ): Promise<ListMembersResponse> {
    return this.#request({
      operation: "list organization members",
      path: "/api/organization/members",
      query: {
        ...(options.includeDisabled !== undefined
          ? { includeDisabled: options.includeDisabled }
          : {}),
        ...(options.offset !== undefined ? { offset: options.offset } : {}),
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      },
    });
  }

  async getMember(userId: string): Promise<OrganizationMemberDetail> {
    return this.#request({
      operation: `fetch member "${userId}"`,
      path: `/api/organization/members/${encodeURIComponent(userId)}`,
    });
  }

  async updateMember(
    userId: string,
    input: { role?: OrganizationRole; disabled?: boolean },
  ): Promise<UpdatedOrganizationMember> {
    return this.#request({
      operation: `update member "${userId}"`,
      path: `/api/organization/members/${encodeURIComponent(userId)}`,
      method: "PATCH",
      body: input,
    });
  }

  async removeMember(userId: string): Promise<{ success: true }> {
    return this.#request({
      operation: `remove member "${userId}"`,
      path: `/api/organization/members/${encodeURIComponent(userId)}`,
      method: "DELETE",
    });
  }

  async getMemberAccess(userId: string): Promise<MemberAccessBreakdown> {
    return this.#request({
      operation: `fetch the access of member "${userId}"`,
      path: `/api/organization/members/${encodeURIComponent(userId)}/access`,
    });
  }

  async listInvites(): Promise<{ invites: OrganizationInvite[] }> {
    return this.#request({
      operation: "list organization invites",
      path: "/api/organization/invites",
    });
  }

  async createInvites(
    input: CreateInvitesInput,
  ): Promise<{ invites: CreatedOrganizationInvite[] }> {
    return this.#request({
      operation: "create organization invites",
      path: "/api/organization/invites",
      method: "POST",
      body: input,
    });
  }

  async revokeInvite(inviteId: string): Promise<{ success: true }> {
    return this.#request({
      operation: `revoke invite "${inviteId}"`,
      path: `/api/organization/invites/${encodeURIComponent(inviteId)}`,
      method: "DELETE",
    });
  }
}
