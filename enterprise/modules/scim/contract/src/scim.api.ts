// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The one callable thing every SCIM door reaches: the settings page over tRPC,
 * the management REST family an identity team scripts against, the SCIM 2.0
 * protocol an identity provider speaks, and the Auth0 log-stream intake.
 *
 * Before this each door described the capability for itself — a resolver here,
 * a service argument there, a context slice in the third — so a rule about
 * what minting a token means, or which tenant a directory push provisions, had
 * three places to live. It has one.
 */
import { featureApi } from "@langwatch/runtime-composition";

import type {
  ScimCreateGroupRequest,
  ScimCreateUserRequest,
  ScimGroup,
  ScimListResponse,
  ScimPatchRequest,
  ScimReplaceGroupRequest,
  ScimUser,
} from "./scim.contract.ts";
import type { IssuedScimToken, ScimTokenEntitlement, ScimTokenSummary } from "./scim-token.ts";

/** The organization a directory credential resolved to. */
export type ScimDirectoryScope = Readonly<{ organizationId: string }>;

/** What one directory delivery is answered with, before anything is provisioned. */
export type ScimDeliveryAdmission =
  | Readonly<{ status: "not-configured" }>
  | Readonly<{ status: "unauthorized" }>
  | Readonly<{ status: "forbidden" }>
  | Readonly<{ status: "invalid-json" }>
  | Readonly<{ status: "admitted"; organizationId: string; events: unknown[] }>;

/** One management-API write on a token, as the organization's audit reads it. */
export type ScimTokenAuditEntry = Readonly<{
  organizationId: string;
  /** The member the credential acts as, or the credential itself. */
  actorId: string;
  action: "management.scimToken.create" | "management.scimToken.delete";
  args: Readonly<Record<string, unknown>>;
}>;

export interface ScimApi {
  // ── The organization's provisioning tokens ───────────────────────────────

  /** The organization's tokens, described. Never a value or a hash. */
  listTokens(input: { organizationId: string }): Promise<ScimTokenSummary[]>;
  /**
   * Mints a token for one directory connection. `connectionId` is the whole of
   * the token's write authority, so it is named rather than defaulted.
   */
  generateToken(input: {
    organizationId: string;
    connectionId?: string | undefined;
    description?: string | undefined;
  }): Promise<IssuedScimToken>;
  /** Retires one token. Idempotent from the caller's side. */
  revokeToken(input: { organizationId: string; tokenId: string }): Promise<{ success: true }>;
  /**
   * Whether the organization's plan includes directory sync. The plan source is
   * the process's; this answers the one question every Enterprise gate on this
   * feature asks of it.
   */
  isEnterpriseEntitled(input: { organizationId: string }): Promise<boolean>;
  /**
   * Records a management-API write on a token. The ledger is the deployment's,
   * composed in: only the door that has always written to it calls this, so
   * the settings page does not start filing rows the audit never had.
   */
  recordTokenAudit(entry: ScimTokenAuditEntry): void;

  // ── The directory credential ─────────────────────────────────────────────

  /**
   * The tenant behind a SCIM bearer, or the protocol's own refusal.
   *
   * @throws {ScimProtocolError} 401 for a missing, malformed or unknown
   * bearer, 403 for one whose organization no longer holds the plan.
   */
  authenticateDirectory(input: {
    authorization: string | null;
  }): Promise<ScimDirectoryScope>;
  /**
   * The same verification, answered rather than thrown, for the intake that
   * owns its own refusal bodies.
   */
  verifyToken(input: { token: string }): Promise<ScimTokenEntitlement>;

  // ── SCIM 2.0 users ───────────────────────────────────────────────────────

  listUsers(input: {
    organizationId: string;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
  }): Promise<ScimListResponse<ScimUser>>;
  createUser(input: {
    organizationId: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser>;
  getUser(input: { organizationId: string; id: string }): Promise<ScimUser>;
  replaceUser(input: {
    organizationId: string;
    id: string;
    request: ScimCreateUserRequest;
  }): Promise<ScimUser>;
  updateUser(input: {
    organizationId: string;
    id: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimUser>;
  deleteUser(input: { organizationId: string; id: string }): Promise<void>;

  // ── SCIM 2.0 groups ──────────────────────────────────────────────────────

  listGroups(input: {
    organizationId: string;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimListResponse<ScimGroup>>;
  createGroup(input: {
    organizationId: string;
    request: ScimCreateGroupRequest;
  }): Promise<ScimGroup>;
  getGroup(input: {
    organizationId: string;
    externalScimId: string;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimGroup>;
  replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    request: ScimReplaceGroupRequest;
  }): Promise<ScimGroup>;
  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    patchRequest: ScimPatchRequest;
  }): Promise<ScimGroup>;
  deleteGroup(input: { organizationId: string; externalScimId: string }): Promise<void>;

  // ── The directory's log stream ───────────────────────────────────────────

  /**
   * Whether one Auth0 delivery provisions anything, and whose directory it
   * provisions. Answered rather than thrown: the intake owns its own bodies,
   * including the 404 an install that configured no secret gives so that a
   * probe cannot learn the path is served here.
   */
  admitDirectoryDelivery(delivery: {
    body: string;
    signature: string | null;
    authorization: string | null;
  }): Promise<ScimDeliveryAdmission>;
  /**
   * Walks one admitted delivery's events into provisioning calls. The tenant is
   * the one the credential named, never one the payload implies.
   */
  relayDirectoryEvents(input: { organizationId: string; events: unknown[] }): Promise<void>;
}

export const ScimApi = featureApi<ScimApi>("scim");
