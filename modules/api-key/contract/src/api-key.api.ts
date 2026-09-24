import { moduleApi } from "@langwatch/kernel/module-api";
import type { Instant } from "@langwatch/time";

import type { ApiKeyListEntry, NamedApiKeyBinding } from "./api-key.list.ts";
import type {
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  OrganizationApiKeyResolutionInput,
  ResolvedApiKeyCredential,
} from "./api-key.tokens.ts";
import type {
  ApiKey,
  ApiKeyAdminKeyInput,
  ApiKeyBinding,
  ApiKeyBindingNames,
  ApiKeyCallerReadInput,
  ApiKeyDetail,
  ApiKeyIdInput,
  ApiKeyListAllInput,
  ApiKeyListEnrichment,
  ApiKeyListInput,
  ApiKeyMembershipInput,
  ApiKeyName,
  ApiKeyOrgIdInput,
  ApiKeyOrgInput,
  ApiKeyProject,
  ApiKeySelectionInput,
  ApiKeyTeam,
  ApiKeyUser,
  ApiKeyVerification,
  ApiKeyVerifyInput,
  CliKeyScopeSummary,
  CliKeySelection,
  CreateApiKeyInput,
  RevokeApiKeyInput,
  UpdateApiKeyInput,
} from "./api-key.ts";
import type { ApiKeyVisibleProjects, ApiKeyVisibleProjectsInput } from "./api-key.visibility.ts";

export type ApiKeyManagementCaller = Readonly<{ id: string }>;
/**
 * The credential an organization door resolved: the key itself, and the member
 * it acts as — null for a service key, which acts as nobody.
 */
export type ApiKeyCredentialCheck = Readonly<{
  apiKeyId: string;
  userId: string | null;
  organizationId: string;
}>;
export type CreateApiKeyManagementInput = Readonly<{
  organizationId: string;
  name: string;
  description?: string | undefined;
  expiresAt?: CreateApiKeyInput["expiresAt"];
  permissionMode: string;
  keyType: "personal" | "service";
  assignedToUserId?: string | undefined;
  permissions?: CreateApiKeyInput["permissions"];
  bindings: CreateApiKeyInput["bindings"];
}>;
export type UpdateApiKeyManagementInput = Readonly<{
  organizationId: string;
  apiKeyId: string;
  name?: string | undefined;
  description?: string | null | undefined;
  permissionMode?: UpdateApiKeyInput["permissionMode"];
  permissions?: UpdateApiKeyInput["permissions"];
  bindings?: UpdateApiKeyInput["bindings"];
}>;

/**
 * What revoking one CLI session's login key retired: the key itself, and the
 * ingest keys minted under it.
 */
export type CliSessionKeyRevocation = Readonly<{
  loginKeyRevoked: boolean;
  ingestKeysRevoked: number;
}>;

export interface ApiKeyApi {
  create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }>;
  update(input: UpdateApiKeyInput): Promise<ApiKey>;
  /** `update`, answering somebody else's key as not found so the id confirms nothing. */
  updateAsCaller(input: UpdateApiKeyInput): Promise<ApiKey>;
  /** Authentication is an attempted lookup: invalid credentials return null. */
  findVerifiedToken(input: ApiKeyVerifyInput): Promise<ApiKeyVerification | null>;
  /** Resolves either a current API key or the deprecated project credential. */
  findResolvedToken(input: ApiKeyTokenResolutionInput): Promise<ResolvedApiKeyCredential | null>;
  /** Rotates a deprecated project credential while preserving its wire format. */
  regenerateLegacyProjectKey(input: { projectId: string }): Promise<string>;
  /** Resolves organization-only credentials while keeping refusal classes apart. */
  resolveOrganizationToken(
    input: OrganizationApiKeyResolutionInput,
  ): Promise<OrganizationApiKeyResolution>;
  resolveVisibleProjects(input: ApiKeyVisibleProjectsInput): Promise<ApiKeyVisibleProjects>;
  markUsed(input: ApiKeyIdInput): void;
  list(input: ApiKeyListInput): Promise<ApiKey[]>;
  listAll(input: ApiKeyListAllInput): Promise<ApiKey[]>;
  /**
   * The keys a credential may list: a member's own, or every key in the
   * organization for a service key that holds `organization:manage`.
   */
  listForCaller(input: ApiKeyCredentialCheck): Promise<ApiKey[]>;
  revoke(input: RevokeApiKeyInput): Promise<ApiKey>;
  ensureCallerIsOrgMember(input: ApiKeyMembershipInput): Promise<void>;
  assertSelectionWithinCeiling(input: ApiKeySelectionInput): Promise<void>;
  isOrgAdmin(input: ApiKeyMembershipInput): Promise<boolean>;
  /**
   * Whether the credential a request arrived with holds `organization:manage`
   * here. Asked of the KEY and the member it acts as together, so a narrowed
   * key cannot borrow the reach of whoever created it.
   */
  credentialCanManageOrganization(input: ApiKeyCredentialCheck): Promise<boolean>;
  isOrgAdminApiKey(input: ApiKeyAdminKeyInput): Promise<boolean>;
  findById(input: ApiKeyIdInput): Promise<ApiKey | null>;
  getByIdForCaller(input: ApiKeyCallerReadInput): Promise<ApiKeyDetail>;
  findNameByIdInOrg(input: ApiKeyOrgIdInput): Promise<ApiKeyName | null>;
  getUserBindings(input: ApiKeyMembershipInput): Promise<ApiKeyBinding[]>;
  getOrgProjects(input: ApiKeyOrgInput): Promise<ApiKeyProject[]>;
  getOrgTeams(input: ApiKeyOrgInput): Promise<ApiKeyTeam[]>;
  getOrgMembers(input: ApiKeyOrgInput): Promise<ApiKeyUser[]>;
  findIngestionKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<ApiKey | null>;
  listIngestionKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ApiKey[]>;
  /** The member's own live ingest keys in one organization, newest first. */
  findIngestionKeysForUser(input: { organizationId: string; userId: string }): Promise<ApiKey[]>;
  /** One key by the lookup id embedded in its token, revoked or live. */
  findByLookupId(input: { lookupId: string }): Promise<ApiKey | null>;
  validateCliSelection(input: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }): Promise<CliKeySelection>;
  findDefaultCliSelection(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliKeySelection | null>;
  mintCliLoginKey(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    selection: CliKeySelection;
    /**
     * When the device session began, and the organization's session policy,
     * so the minted key's expiry tracks the session (see
     * `loginKeyExpiresAt`). Omitted, the key mints with no expiry.
     */
    sessionStartedAtMs?: number;
    maxSessionDurationDays?: number;
    refreshWindowMs?: number;
  }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }>;
  revokeCliLoginKeysForDevice(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    exceptApiKeyId?: string;
    createdBefore?: Instant;
  }): Promise<void>;
  /** A person revoking one of their own CLI sessions: main's `revokeSessionKey`, counted. */
  revokeCliSessionKey(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<CliSessionKeyRevocation>;
  revokeCliLoginKeyForLogout(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void>;
  /**
   * Moves a live login key's expiry with its session, on a successful
   * refresh, so a session nothing keeps refreshing is still retired by the
   * hourly sweep rather than sliding forward forever.
   */
  extendCliLoginKeyExpiry(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
    sessionStartedAtMs: number;
    maxSessionDurationDays: number;
    refreshWindowMs: number;
  }): Promise<void>;
  enrichBindingsWithNames(input: {
    bindings: ApiKeyBinding[];
    organizationId?: string;
  }): Promise<ApiKeyBindingNames>;
  enrichApiKeyList(input: { apiKeys: ApiKey[] }): Promise<ApiKeyListEnrichment>;

  /** The caller's own bindings in one organization, each with its scope named. */
  listCallerBindings(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<NamedApiKeyBinding[]>;
  /**
   * One key id resolved to a display name. Answers null identically for an id
   * that does not exist and one in another organization, so it cannot enumerate.
   */
  findKeyName(
    input: { organizationId: string; apiKeyId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyName | null>;
  /** The organization's keys for an admin, the caller's own for everyone else. */
  listKeys(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyListEntry[]>;
  /** Mints a key and answers its plaintext token once, here and nowhere else. */
  createKey(
    input: CreateApiKeyManagementInput,
    by: ApiKeyManagementCaller,
  ): Promise<{ token: string; apiKey: ApiKey; assignedToUserId: string | null }>;
  updateKey(input: UpdateApiKeyManagementInput, by: ApiKeyManagementCaller): Promise<ApiKey>;
  revokeKey(
    input: { organizationId: string; apiKeyId: string },
    by: ApiKeyManagementCaller,
  ): Promise<void>;
  listOrganizationProjects(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyProject[]>;
  listOrganizationTeams(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyTeam[]>;
  listOrganizationMembers(
    input: { organizationId: string },
    by: ApiKeyManagementCaller,
  ): Promise<ApiKeyUser[]>;
}

export const ApiKeyApi = moduleApi<ApiKeyApi>()("api-key");
