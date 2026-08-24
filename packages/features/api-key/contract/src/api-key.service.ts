import type { ApiKey, ApiKeyBinding, ApiKeyBindingNames, ApiKeyDetail, ApiKeyListEnrichment, ApiKeyName, ApiKeyProject, ApiKeyScope, ApiKeyTeam, ApiKeyUser, ApiKeyVerification, CliKeyScopeSummary, CliKeySelection, CreateApiKeyInput, RevokeApiKeyInput, UpdateApiKeyInput } from "./api-key";
import type {
  ApiKeyTokenResolutionInput,
  OrganizationApiKeyResolution,
  OrganizationApiKeyResolutionInput,
  ResolvedApiKeyToken,
} from "./api-key.tokens";
import type {
  ApiKeyVisibleProjects,
  ApiKeyVisibleProjectsInput,
} from "./api-key.visibility";
export type ApiKeySelectionInput = { userId: string; organizationId: string; bindings: Array<ApiKeyScope & { role: "CUSTOM" }>; permissions: string[] };
export type ApiKeyListInput = { userId: string; organizationId: string };
export type ApiKeyListAllInput = { organizationId: string };
export type ApiKeyVerifyInput = { token: string };
export type ApiKeyOrgInput = { organizationId: string };
export type ApiKeyIdInput = { id: string };
export type ApiKeyOrgIdInput = { id: string; organizationId: string };
export type ApiKeyMembershipInput = { userId: string; organizationId: string };
export type ApiKeyAdminKeyInput = { apiKeyId: string; organizationId: string };
export type ApiKeyCallerReadInput = { id: string; organizationId: string; callerUserId: string | null; callerCanReadAnyKey: boolean };

/** The only public capability for API credentials. */
export abstract class ApiKeyService {
  abstract create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }>;
  abstract update(input: UpdateApiKeyInput): Promise<ApiKey>;
  /** Authentication is an attempted lookup: invalid credentials return null. */
  abstract tryVerify(input: ApiKeyVerifyInput): Promise<ApiKeyVerification | null>;
  /** Resolves either a current API key or the deprecated project credential. */
  abstract tryResolveToken(
    input: ApiKeyTokenResolutionInput,
  ): Promise<ResolvedApiKeyToken | null>;
  /** Resolves organization-only credentials while keeping refusal classes apart. */
  abstract resolveOrganizationToken(
    input: OrganizationApiKeyResolutionInput,
  ): Promise<OrganizationApiKeyResolution>;
  abstract resolveVisibleProjects(
    input: ApiKeyVisibleProjectsInput,
  ): Promise<ApiKeyVisibleProjects>;
  abstract markUsed(input: ApiKeyIdInput): void;
  abstract list(input: ApiKeyListInput): Promise<ApiKey[]>;
  abstract listAll(input: ApiKeyListAllInput): Promise<ApiKey[]>;
  abstract revoke(input: RevokeApiKeyInput): Promise<ApiKey>;
  abstract ensureCallerIsOrgMember(input: ApiKeyMembershipInput): Promise<void>;
  abstract assertSelectionWithinCeiling(input: ApiKeySelectionInput): Promise<void>;
  abstract isOrgAdmin(input: ApiKeyMembershipInput): Promise<boolean>;
  abstract isOrgAdminApiKey(input: ApiKeyAdminKeyInput): Promise<boolean>;
  abstract tryGetById(input: ApiKeyIdInput): Promise<ApiKey | null>;
  abstract getByIdForCaller(input: ApiKeyCallerReadInput): Promise<ApiKeyDetail>;
  abstract tryGetNameByIdInOrg(input: ApiKeyOrgIdInput): Promise<ApiKeyName | null>;
  abstract getUserBindings(input: ApiKeyMembershipInput): Promise<ApiKeyBinding[]>;
  abstract getOrgProjects(input: ApiKeyOrgInput): Promise<ApiKeyProject[]>;
  abstract getOrgTeams(input: ApiKeyOrgInput): Promise<ApiKeyTeam[]>;
  abstract getOrgMembers(input: ApiKeyOrgInput): Promise<ApiKeyUser[]>;
  abstract tryGetIngestionKey(input: { organizationId: string; projectId: string; sourceType: string }): Promise<ApiKey | null>;
  abstract listIngestionKeysForProject(input: { organizationId: string; projectId: string }): Promise<ApiKey[]>;
  abstract validateCliSelection(input: { userId: string; organizationId: string; selection: CliKeySelection }): Promise<CliKeySelection>;
  abstract tryResolveDefaultCliSelection(input: { userId: string; organizationId: string }): Promise<CliKeySelection | null>;
  abstract mintCliLoginKey(input: { userId: string; organizationId: string; deviceLabel: string; selection: CliKeySelection }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }>;
  abstract revokeCliLoginKeysForDevice(input: { userId: string; organizationId: string; deviceLabel: string; exceptApiKeyId?: string; createdBefore?: Date }): Promise<void>;
  abstract revokeCliLoginKeyForLogout(input: { apiKeyId: string; userId: string; organizationId: string }): Promise<void>;
  abstract enrichBindingsWithNames(input: { bindings: ApiKeyBinding[]; organizationId?: string }): Promise<ApiKeyBindingNames>;
  abstract enrichApiKeyList(input: { apiKeys: ApiKey[] }): Promise<ApiKeyListEnrichment>;
}
