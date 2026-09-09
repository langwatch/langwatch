import { featureApi } from "@langwatch/runtime-composition";
import type { Instant } from "@langwatch/time";
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
import type { ApiKeyListEntry, NamedApiKeyBinding } from "./api-key.list.ts";
import type {
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  OrganizationApiKeyResolutionInput,
  ResolvedApiKeyCredential,
} from "./api-key.tokens.ts";
import type { ApiKeyVisibleProjects, ApiKeyVisibleProjectsInput } from "./api-key.visibility.ts";

export type ApiKeyManagementCaller = Readonly<{ id: string }>;
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

export interface ApiKeyApi {
  create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }>;
  update(input: UpdateApiKeyInput): Promise<ApiKey>;
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
  revoke(input: RevokeApiKeyInput): Promise<ApiKey>;
  ensureCallerIsOrgMember(input: ApiKeyMembershipInput): Promise<void>;
  assertSelectionWithinCeiling(input: ApiKeySelectionInput): Promise<void>;
  isOrgAdmin(input: ApiKeyMembershipInput): Promise<boolean>;
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
  }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }>;
  revokeCliLoginKeysForDevice(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    exceptApiKeyId?: string;
    createdBefore?: Instant;
  }): Promise<void>;
  revokeCliLoginKeyForLogout(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
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

export const ApiKeyApi = featureApi<ApiKeyApi>("api-key");
