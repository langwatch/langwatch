import type { Instant } from "@langwatch/time";

import type {
  ScimRequestLogEntry,
  ScimRequestLogQuery,
  ScimRequestRecord,
} from "./scim-request-log.ts";
import type { ScimTokenEntitlement, ScimTokenSummary } from "./scim-token.ts";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type {
  ScimCreateGroupRequest,
  ScimCreateUserRequest,
  ScimGroup,
  ScimListResponse,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
  ScimUser,
} from "./scim.contract.ts";

/** The portable provisioning capability used by every SCIM transport. */
export abstract class ScimService {
  /** Resolve an Auth0 SCIM webhook's verified e-mail domain to its tenant. */
  abstract findOrganizationBySsoDomain(input: { domain: string }): Promise<{ id: string } | null>;
  abstract generateToken(input: {
    organizationId: string;
    connectionId?: string | null;
    description?: string;
  }): Promise<{ token: string; tokenId: string; connectionId: string }>;
  abstract listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]>;
  abstract revokeToken(input: {
    organizationId: string;
    tokenId: string;
  }): Promise<{ success: true }>;
  abstract revokeTokensForConnection(input: {
    organizationId: string;
    connectionId: string;
  }): Promise<{ revoked: number }>;
  abstract verifyToken(input: { token: string }): Promise<ScimTokenEntitlement>;

  // ── What the directory asked, and what we answered (ADR-126) ─────────────

  /** Files one served request. Never throws: the request was already answered. */
  abstract recordRequest(request: ScimRequestRecord): Promise<void>;
  /** What this connection has served, newest first. */
  abstract findRequestLog(query: ScimRequestLogQuery): Promise<ScimRequestLogEntry[]>;
  /** Drops what has aged out, answering how many rows went. */
  abstract sweepExpiredRequests(input: { now: Instant }): Promise<number>;
  abstract createUser(input: {
    organizationId: string;
    connectionId?: string | null;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser>;
  abstract getUser(input: { organizationId: string; id: string }): Promise<ScimUser>;
  abstract listUsers(input: {
    organizationId: string;
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
  }): Promise<ScimListResponse<ScimUser>>;
  abstract replaceUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser>;
  abstract updateUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimUser>;
  abstract deleteUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null;
  }): Promise<void>;

  abstract listGroups(input: {
    organizationId: string;
    connectionId?: string | null;
    filter?: string;
    startIndex?: number;
    count?: number;
    excludeMembers?: boolean;
  }): Promise<ScimListResponse<ScimGroup>>;
  abstract getGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
    excludeMembers?: boolean;
  }): Promise<ScimGroup>;
  abstract createGroup(input: {
    organizationId: string;
    connectionId?: string | null;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup>;
  abstract replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup>;
  abstract updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup>;
  abstract deleteGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null;
  }): Promise<void>;
}
