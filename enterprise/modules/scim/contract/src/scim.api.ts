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
import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  DirectoryIdentityRow,
  ListOversightSyncsInput,
  OversightConnectionInput,
  OversightSync,
  OversightSyncList,
  RedriveRetiredApplyInput,
  RedriveRetiredApplyResult,
  ScimOperator,
} from "./scim-oversight.ts";
import type {
  ConnectionReconciliation,
  OrganizationReconciliation,
  ScimReconciliationScope,
} from "./scim-reconciliation.ts";
import type { ScimConnectionRequestsInput, ScimRequestEntry } from "./scim-request-log.ts";
import type {
  IssuedScimToken,
  ScimDirectoryConnection,
  ScimTokenEntitlement,
  ScimTokenSummary,
} from "./scim-token.ts";
import type { ScimGroup, ScimListResponse, ScimUser } from "./scim.contract.ts";

/** The organization a directory credential resolved to. */
export type ScimDirectoryScope = Readonly<{
  id: string;
  organizationId: string;
  connectionId: string | null;
}>;

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
   * The organization's directory connections, as identity answers them. A
   * token's whole write authority is the connection it names, so the page that
   * mints one reads the choices from the module that owns them.
   */
  findConnections(input: { organizationId: string }): Promise<ScimDirectoryConnection[]>;
  /** The identity provider's own id for each member, across every connection the organization holds. */
  findDirectoryExternalIds(input: {
    organizationId: string;
  }): Promise<{ userId: string; externalId: string }[]>;
  /**
   * Mints a token for one directory connection. `connectionId` is the whole of
   * the token's write authority, so it is named rather than defaulted.
   */
  generateToken(input: {
    organizationId: string;
    connectionId?: string | undefined;
    description?: string | undefined;
    secret?: string | undefined;
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
   * Re-homes one connection's directory sync onto the connection that replaced it: the tokens,
   * people and external ids follow. Recorded on scim's own pipeline and moved by its worker.
   */
  moveToConnection(input: {
    organizationId: string;
    fromConnectionId: string;
    toConnectionId: string;
  }): Promise<void>;
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
   * bearer, 403 for one whose organization no longer holds the plan or whose
   * connection can no longer write through single sign-on.
   */
  authenticateDirectory(input: {
    authorization: string | null;
    /** What the provider asked for, so an attributable refusal can be filed
     *  against the connection it was meant for (ADR-126). A door that does
     *  not supply them refuses exactly as before and records nothing. */
    method?: string | undefined;
    path?: string | undefined;
  }): Promise<ScimDirectoryScope>;
  /**
   * The same verification, answered rather than thrown, for the intake that
   * owns its own refusal bodies.
   */
  verifyToken(input: { token: string }): Promise<ScimTokenEntitlement>;

  /**
   * Every request one connection's directory made, newest first (ADR-126) —
   * including the ones refused before a handler saw them, which appear in no
   * activity feed because they decided nothing.
   */
  findDirectoryRequests(input: ScimConnectionRequestsInput): Promise<ScimRequestEntry[]>;

  /**
   * Where every one of this organization's directory syncs stands, in words
   * (ADR-122): what each connection is waiting for, when it last heard from
   * the directory, how many people that directory manages, what it asked for
   * that has not been applied, and the access it changed lately.
   *
   * The organization is what the read is BUILT from rather than a filter
   * beside a connection id, so another organization's connection is not
   * excluded — it was never in the answer to be excluded from.
   */
  getDirectoryReconciliation(input: ScimReconciliationScope): Promise<OrganizationReconciliation>;

  /** One connection's sync in the same words, empty for a connection this
   *  organization does not have — another's included, which reads the same. */
  findConnectionReconciliation(
    input: ScimConnectionRequestsInput,
  ): Promise<ConnectionReconciliation[]>;

  // ── The platform operator's oversight (ADR-122) ─────────────────────────
  // Staff-list gated: anyone else is answered as if the surface did not exist.

  listOversightSyncs(input: ListOversightSyncsInput, by: ScimOperator): Promise<OversightSyncList>;
  findOversightSync(input: OversightConnectionInput, by: ScimOperator): Promise<OversightSync[]>;
  findDirectoryIdentities(
    input: OversightConnectionInput,
    by: ScimOperator,
  ): Promise<DirectoryIdentityRow[]>;
  redriveRetiredApply(
    input: RedriveRetiredApplyInput,
    by: ScimOperator,
  ): Promise<RedriveRetiredApplyResult>;

  // ── SCIM 2.0 users ───────────────────────────────────────────────────────

  listUsers(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
  }): Promise<ScimListResponse<ScimUser>>;
  /**
   * `body` is the posted text, read here: one that is not JSON, or not a
   * resource we accept, is filed on the request log (ADR-126) and refused as
   * the protocol's 400 naming only the fields.
   */
  createUser(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimUser>;
  getUser(input: { organizationId: string; id: string }): Promise<ScimUser>;
  replaceUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimUser>;
  updateUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimUser>;
  deleteUser(input: {
    organizationId: string;
    id: string;
    connectionId?: string | null | undefined;
  }): Promise<void>;

  // ── SCIM 2.0 groups ──────────────────────────────────────────────────────

  listGroups(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    filter?: string | undefined;
    startIndex?: number | undefined;
    count?: number | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimListResponse<ScimGroup>>;
  createGroup(input: {
    organizationId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimGroup>;
  getGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    excludeMembers?: boolean | undefined;
  }): Promise<ScimGroup>;
  replaceGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimGroup>;
  updateGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
    body: string;
  }): Promise<ScimGroup>;
  deleteGroup(input: {
    organizationId: string;
    externalScimId: string;
    connectionId?: string | null | undefined;
  }): Promise<void>;

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

export const ScimApi = moduleApi<ScimApi>()("scim");
