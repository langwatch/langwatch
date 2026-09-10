import {
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
  type ResolvedApiKeyCredential,
  type RevokeApiKeyInput,
  type UpdateApiKeyInput,
} from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ApiKeyBindingId } from "./api-key-binding-id.service.ts";
import type { ApiKeyTokenRepository } from "../repositories/api-key-token.repository.ts";
import type { ApiKeyRepository } from "../repositories/api-key.repository.ts";
import { ApiKeyCatalogService } from "./api-key-catalog.service.ts";
import { ApiKeyCliService } from "./api-key-cli.service.ts";
import { ApiKeyEnrichmentService } from "./api-key-enrichment.service.ts";
import { ApiKeyGrantPolicyService } from "./api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "./api-key-lifecycle.service.ts";
import { ApiKeyTokenResolutionService } from "./api-key-token-resolution.service.ts";
import { ApiKeyVisibilityService } from "./api-key-visibility.service.ts";
import type { LegacyApiKeyGrantService } from "./legacy-api-key-grant.service.ts";
import type { Instant } from "@langwatch/time";

export type ApiKeyDependencies = {
  authz: AuthzApi;
  grants: AuthzApi;
  organizations: OrganizationApi;
  projects: ProjectApi;
  bindingIds: ApiKeyBindingId;
  legacyGrants: LegacyApiKeyGrantService;
  tokens: ApiKeyTokenRepository;
};

/** The only public capability for API credentials; ApiKeyApp adapts it to the contract API. */
export class ApiKeyService {
  private readonly policy: ApiKeyGrantPolicyService;
  private readonly catalog: ApiKeyCatalogService;
  private readonly lifecycle: ApiKeyLifecycleService;
  private readonly tokens: ApiKeyTokenResolutionService;
  private readonly visibility: ApiKeyVisibilityService;
  private readonly cli: ApiKeyCliService;
  private readonly enrichment: ApiKeyEnrichmentService;

  static create(options: ApiKeyDependencies & { repository: ApiKeyRepository }): ApiKeyService {
    return new ApiKeyService(options.repository, options);
  }

  private constructor(
    private readonly repository: ApiKeyRepository,
    options: ApiKeyDependencies,
  ) {
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

  async findVerifiedToken(input: { token: string }): Promise<ApiKeyVerification | null> {
    return this.tokens.findVerifiedToken(input);
  }

  async findResolvedToken(input: {
    token: string;
    projectId?: string | null;
  }): Promise<ResolvedApiKeyCredential | null> {
    return this.tokens.findResolvedToken(input);
  }

  async regenerateLegacyProjectKey(input: { projectId: string }): Promise<string> {
    return this.tokens.regenerateLegacyProjectKey(input);
  }

  async resolveOrganizationToken(input: { token: string }): Promise<OrganizationApiKeyResolution> {
    return this.tokens.resolveOrganizationToken(input);
  }

  async resolveVisibleProjects(input: {
    apiKeyId: string;
    organizationId: string;
  }): Promise<ApiKeyVisibleProjects> {
    return this.visibility.resolveVisibleProjects(input);
  }

  markUsed({ id }: { id: string }): void {
    void this.repository.updateLastUsedAt({ id }).catch(() => void 0);
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

  async ensureCallerIsOrgMember(input: { userId: string; organizationId: string }): Promise<void> {
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

  async isOrgAdminApiKey(input: { apiKeyId: string; organizationId: string }): Promise<boolean> {
    return this.policy.isOrgAdminApiKey(input);
  }

  async findById(input: { id: string }): Promise<ApiKey | null> {
    return this.catalog.findById(input);
  }

  async getByIdForCaller(input: {
    id: string;
    organizationId: string;
    callerUserId: string | null;
    callerCanReadAnyKey: boolean;
  }): Promise<ApiKeyDetail> {
    return this.catalog.getByIdForCaller(input);
  }

  async findNameByIdInOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<ApiKeyName | null> {
    return this.catalog.findNameByIdInOrg(input);
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

  async findIngestionKey(input: {
    organizationId: string;
    projectId: string;
    sourceType: string;
  }): Promise<ApiKey | null> {
    return this.catalog.findIngestionKey(input);
  }

  async listIngestionKeysForProject(input: {
    organizationId: string;
    projectId: string;
  }): Promise<ApiKey[]> {
    return this.catalog.listIngestionKeysForProject(input);
  }

  async findByLookupId(input: { lookupId: string }): Promise<ApiKey | null> {
    return this.catalog.findByLookupId(input);
  }

  async validateCliSelection(input: {
    userId: string;
    organizationId: string;
    selection: CliKeySelection;
  }): Promise<CliKeySelection> {
    return this.cli.validateCliSelection(input);
  }

  async findDefaultCliSelection(input: {
    userId: string;
    organizationId: string;
  }): Promise<CliKeySelection | null> {
    return this.cli.findDefaultCliSelection(input);
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
    createdBefore?: Instant;
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
