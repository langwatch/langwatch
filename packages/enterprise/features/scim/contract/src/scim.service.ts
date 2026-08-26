// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ScimCreateGroupRequest,
  ScimCreateUserRequest,
  ScimError,
  ScimGroup,
  ScimListResponse,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
  ScimUser,
} from "./scim.contract";
import type { ScimTokenEntitlement, ScimTokenSummary } from "./scim-token";

/** The portable provisioning capability used by every SCIM transport. */
export abstract class ScimService {
  /** Resolve an Auth0 SCIM webhook's verified e-mail domain to its tenant. */
  abstract tryFindOrganizationBySsoDomain(input: {
    domain: string;
  }): Promise<{ id: string } | null>;
  abstract generateToken(input: {
    organizationId: string;
    description?: string;
  }): Promise<{ token: string; tokenId: string }>;
  abstract listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]>;
  abstract revokeToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }>;
  abstract verifyToken(input: { token: string }): Promise<ScimTokenEntitlement>;
  abstract createUser(input: {
    organizationId: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser>;
  abstract getUser(input: { organizationId: string; id: string }): Promise<ScimUser>;
  abstract listUsers(input: {
    organizationId: string;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser>>;
  abstract replaceUser(input: {
    organizationId: string;
    id: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser>;
  abstract updateUser(input: {
    organizationId: string;
    id: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimUser>;
  abstract deleteUser(input: { organizationId: string; id: string }): Promise<void>;

  abstract listGroups(input: {
    organizationId: string;
    filter?: string;
    startIndex?: number;
    count?: number;
    excludeMembers?: boolean;
  }): Promise<ScimListResponse<ScimGroup>>;
  abstract getGroup(input: {
    organizationId: string;
    externalScimId: string;
    excludeMembers?: boolean;
  }): Promise<ScimGroup>;
  abstract createGroup(input: {
    organizationId: string;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup>;
  abstract replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup>;
  abstract updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup>;
  abstract deleteGroup(input: {
    organizationId: string;
    externalScimId: string;
  }): Promise<void>;
}
