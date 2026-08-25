import {
  ApiKeyService as ApiKeyCapability,
  type ApiKey,
  type ApiKeyBinding,
  type ApiKeyBindingNames,
  type ApiKeyDetail,
  type ApiKeyListEnrichment,
  type ApiKeyName,
  type ApiKeyProject,
  type ApiKeyVerification,
  type ApiKeyScope,
  type ApiKeyTeam,
  type ApiKeyUser,
  type ApiKeyVisibleProjects,
  type CliKeyScopeSummary,
  type CliKeySelection,
  type CreateApiKeyInput,
  type OrganizationApiKeyResolution,
  type ResolvedApiKeyToken,
  type RevokeApiKeyInput,
  type UpdateApiKeyInput,
} from "@langwatch/api-key-contract";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";
import type { ApiKeyBindingIdPort } from "../ports/api-key-binding-id.port";
import type { ApiKeyTokenPort } from "../ports/api-key-token.port";
import type { ApiKeyRepository } from "../repositories/api-key.repository";
import { ApiKeyCatalogService } from "./api-key-catalog.service";
import { ApiKeyCliService } from "./api-key-cli.service";
import { ApiKeyEnrichmentService } from "./api-key-enrichment.service";
import { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service";
import { ApiKeyLifecycleService } from "./api-key-lifecycle.service";
import { ApiKeyTokenResolutionService } from "./api-key-token-resolution.service";
import { ApiKeyVisibilityService } from "./api-key-visibility.service";
import type { LegacyApiKeyGrantService } from "./legacy-api-key-grant.service";

export type ApiKeyDependencies = {
  authz: AuthzService;
  grants: AuthzGrantsService;
  organizations: OrganizationService;
  projects: ProjectService;
  bindingIds: ApiKeyBindingIdPort;
  legacyGrants: LegacyApiKeyGrantService;
  tokens: ApiKeyTokenPort;
};

/** The only public capability for API credentials. */
export class ApiKeyService extends ApiKeyCapability {
  private readonly policy: ApiKeyGrantPolicyService;
  private readonly catalog: ApiKeyCatalogService;
  private readonly lifecycle: ApiKeyLifecycleService;
  private readonly tokens: ApiKeyTokenResolutionService;
  private readonly visibility: ApiKeyVisibilityService;
  private readonly cli: ApiKeyCliService;
  private readonly enrichment: ApiKeyEnrichmentService;

  static create(
    options: ApiKeyDependencies & { repository: ApiKeyRepository },
  ): ApiKeyService {
    return new ApiKeyService(options.repository, options);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    private readonly options: ApiKeyDependencies,
  ) {
    super();
    const dependencies = { repository, ...options };
    this.policy = ApiKeyGrantPolicyService.create(dependencies);
    this.catalog = ApiKeyCatalogService.create(dependencies);
    this.lifecycle = ApiKeyLifecycleService.create(dependencies, this.policy);
    this.tokens = ApiKeyTokenResolutionService.create(dependencies);
    this.visibility = ApiKeyVisibilityService.create(dependencies);
    this.cli = ApiKeyCliService.create(dependencies, this.policy, this.lifecycle);
    this.enrichment = ApiKeyEnrichmentService.create(dependencies, this.catalog);
  }

  async create(input: CreateApiKeyInput): Promise<{ token: string; apiKey: ApiKey }> {
    return this.lifecycle.create(input);
  }

  async update(input: UpdateApiKeyInput): Promise<ApiKey> {
    return this.lifecycle.update(input);
  }

  async tryVerify(input: { token: string }): Promise<ApiKeyVerification | null> {
    return this.tokens.tryVerify(input);
  }

  async tryResolveToken(input: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedApiKeyToken | null> {
    return this.tokens.tryResolveToken(input);
  }

  async regenerateLegacyProjectKey(input: { projectId: string }): Promise<string> {
    return this.tokens.regenerateLegacyProjectKey(input);
  }

  async resolveOrganizationToken(input: {
    token: string;
  }): Promise<OrganizationApiKeyResolution> {
    return this.tokens.resolveOrganizationToken(input);
  }

  async resolveVisibleProjects(input: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<ApiKeyVisibleProjects> {
    return this.visibility.resolveVisibleProjects(input);
  }

  markUsed({ id }: { id: string }): void {
    void this.repository.updateLastUsedAt({ id }).catch(() => undefined);
  }

  async list(input: { userId: string; organizationId: string }): Promise<ApiKey[]> {
    return this.catalog.list(input);
  }

  async listAll(input: { organizationId: string }): Promise<ApiKey[]> {
    return this.catalog.listAll(input);
  }

  async revoke(input: RevokeApiKeyInput): Promise<ApiKey> {
    return this.lifecycle.revoke(input);
  }

  async ensureCallerIsOrgMember(input: {
    userId: string;
    organizationId: string;
  }): Promise<void> {
    return this.policy.ensureCallerIsOrgMember(input);
  }

  async assertSelectionWithinCeiling(input: {
    userId: string;
    organizationId: string;
    bindings: Array<ApiKeyScope & { role: "CUSTOM" }>;
    permissions: string[];
  }): Promise<void> {
    return this.policy.assertSelectionWithinCeiling(input);
  }

  async isOrgAdmin(input: { userId: string; organizationId: string }): Promise<boolean> {
    return this.policy.isOrgAdmin(input);
  }

  async isOrgAdminApiKey(input: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<boolean> {
    return this.policy.isOrgAdminApiKey(input);
  }

  async tryGetById(input: { id: string }): Promise<ApiKey | null> {
    return this.catalog.tryGetById(input);
  }

  async getByIdForCaller(input: {
    id: string;
    organizationId: string;
    callerUserId: string | null;
    callerCanReadAnyKey: boolean;
  }): Promise<ApiKeyDetail> {
    return this.catalog.getByIdForCaller(input);
  }

  async tryGetNameByIdInOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<ApiKeyName | null> {
    return this.catalog.tryGetNameByIdInOrg(input);
  }

  async getUserBindings(input: {
    userId: string;
    organizationId: string;
  }): Promise<ApiKeyBinding[]> {
    return this.catalog.getUserBindings(input);
  }

  async getOrgProjects(input: { organizationId: string }): Promise<ApiKeyProject[]> {
    return this.catalog.getOrgProjects(input);
  }

  async getOrgTeams(input: { organizationId: string }): Promise<ApiKeyTeam[]> {
    return this.catalog.getOrgTeams(input);
  }

  async getOrgMembers(input: { organizationId: string }): Promise<ApiKeyUser[]> {
    return this.catalog.getOrgMembers(input);
  }

  async tryGetIngestionKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<ApiKey | null> {
    return this.catalog.tryGetIngestionKey(input);
  }

  async listIngestionKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ApiKey[]> {
    return this.catalog.listIngestionKeysForProject(input);
  }

  async validateCliSelection(input: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }): Promise<CliKeySelection> {
    return this.cli.validateCliSelection(input);
  }

  async tryResolveDefaultCliSelection(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliKeySelection | null> {
    return this.cli.tryResolveDefaultCliSelection(input);
  }

  async mintCliLoginKey(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    selection: CliKeySelection;
  }): Promise<{ token: string; apiKeyId: string; scope: CliKeyScopeSummary }> {
    return this.cli.mintCliLoginKey(input);
  }

  async revokeCliLoginKeysForDevice(input: {
    userId: string;
    organizationId: string;
    deviceLabel: string;
    exceptApiKeyId?: string;
    createdBefore?: Date;
  }): Promise<void> {
    return this.cli.revokeCliLoginKeysForDevice(input);
  }

  async revokeCliLoginKeyForLogout(input: {
    apiKeyId: string;
    userId: string;
    organizationId: string;
  }): Promise<void> {
    return this.cli.revokeCliLoginKeyForLogout(input);
  }

  async enrichBindingsWithNames(input: {
    bindings: ApiKeyBinding[];
    organizationId?: string;
  }): Promise<ApiKeyBindingNames> {
    return this.enrichment.enrichBindingsWithNames(input);
  }

  async enrichApiKeyList(input: { apiKeys: ApiKey[] }): Promise<ApiKeyListEnrichment> {
    return this.enrichment.enrichApiKeyList(input);
  }
}
