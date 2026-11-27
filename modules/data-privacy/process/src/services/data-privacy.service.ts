import type { AuthzApi } from "@langwatch/authz-contract";
import {
  ApiKeyAddForbiddenError,
  dataPrivacyConfigSchema,
  InvalidDataPrivacyConfigError,
  namedApiKeyIds,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
  type DataPrivacyPiiRedactionLevel,
  type DataPrivacyPolicy,
  type DataPrivacyScope,
  type PrivacyPolicyRequestMemo,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { overBroadSecretPatternProbe } from "@langwatch/redaction";
import { type Instant, nowInstant } from "@langwatch/time";
import safe from "safe-regex2";

import type { DataPrivacyDirectoryReader } from "../app/data-privacy.app.ts";
import type { OrganizationApiKeys } from "../channels/data-privacy.channels.ts";
import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
import {
  foreignApiKeyIds,
  namesKeysOnUnrestrictedCategory,
  namesKeysWithoutAdmins,
  restrictedCategoriesDisagreeOnKeys,
} from "../rules/audience-api-keys.rules.ts";
import {
  publicPiiRedactionLevel,
  withPiiRedactionLevel,
} from "../rules/pii-redaction-level.rules.ts";
import { DataPrivacyPolicyCacheService } from "./data-privacy-cache.service.ts";
import type { DataPrivacyProjectScopeService } from "./data-privacy-project-scope.service.ts";
import { DataPrivacyResolutionService } from "./data-privacy-resolution.service.ts";

/** The door's own lineage check (`packages/api` access), asked of a nested scope (Q151 Q1). */
type ScopeLineage = Pick<AuthzApi, "checkScopeLineage">;

type ScopeFacts = Pick<DataPrivacyProjectScopeService, "getScopeFacts">;
/** The organization a department belongs to, as main read it (dataPrivacyPolicy.authz.ts:50). */
type DepartmentOwners = Pick<DataPrivacyDirectoryReader, "findScopeOrganizationId">;

export class DataPrivacyService {
  private readonly repository: DataPrivacyPolicyRepository;
  private readonly cache: DataPrivacyPolicyCacheService;
  private readonly resolution: DataPrivacyResolutionService;
  private readonly scopes: ScopeFacts;
  private readonly lineage: ScopeLineage;
  private readonly departments: DepartmentOwners;
  private readonly apiKeys: OrganizationApiKeys;
  private readonly clock: () => Instant;

  private constructor({
    repository,
    cache,
    resolution,
    scopes,
    lineage,
    departments,
    apiKeys,
    clock,
  }: {
    repository: DataPrivacyPolicyRepository;
    cache: DataPrivacyPolicyCacheService;
    resolution: DataPrivacyResolutionService;
    scopes: ScopeFacts;
    lineage: ScopeLineage;
    departments: DepartmentOwners;
    apiKeys: OrganizationApiKeys;
    clock: () => Instant;
  }) {
    this.repository = repository;
    this.cache = cache;
    this.resolution = resolution;
    this.scopes = scopes;
    this.lineage = lineage;
    this.departments = departments;
    this.apiKeys = apiKeys;
    this.clock = clock;
  }

  static create(options: {
    repository: DataPrivacyPolicyRepository;
    scopes: ScopeFacts;
    lineage: ScopeLineage;
    departments: DepartmentOwners;
    apiKeys: OrganizationApiKeys;
    ttlMs?: number;
    now?: () => number;
    /** When a named key's expiry is checked on save. */
    clock?: () => Instant;
  }): DataPrivacyService {
    const cache = DataPrivacyPolicyCacheService.create(
      options.repository,
      options.ttlMs,
      options.now,
    );

    return new DataPrivacyService({
      repository: options.repository,
      cache,
      resolution: DataPrivacyResolutionService.create({
        repository: options.repository,
        scopes: options.scopes,
        cache,
      }),
      scopes: options.scopes,
      lineage: options.lineage,
      departments: options.departments,
      apiKeys: options.apiKeys,
      clock: options.clock ?? nowInstant,
    });
  }

  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy> {
    return this.resolution.getResolvedForProject(input);
  }

  getResolvedForProjects(input: {
    projectIds: readonly string[];
    memo?: PrivacyPolicyRequestMemo;
  }): Promise<ResolvedDataPrivacy> {
    return this.resolution.getResolvedForProjects(input);
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.resolution.listOrganizationRules(input);
  }

  async setForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
    /** Whether the caller may name a key the rule does not name yet (ADR-208). */
    mayNameNewKeys: boolean;
  }): Promise<DataPrivacyPolicy> {
    const config = this.validated(input.config);
    const organizationId = await this.resolveOrganizationId(input);
    await this.assertNamedKeysAreTheOrganizations({ ...input, organizationId, config });
    const row = await this.repository.upsertForScope({
      organizationId,
      scope: input.scope,
      personalOnly: input.personalOnly,
      config,
    });
    this.cache.clear();

    return row;
  }

  async getPiiRedactionLevel(input: { projectId: string }): Promise<DataPrivacyPiiRedactionLevel> {
    const resolved = await this.resolution.getResolvedForProject(input);

    return publicPiiRedactionLevel(resolved.pii.level);
  }

  /** The project's own rule is the nearest scope, so the level written is the level resolved. */
  async setPiiRedactionLevel(input: {
    projectId: string;
    level: DataPrivacyPiiRedactionLevel;
  }): Promise<void> {
    const { organizationId } = await this.scopes.getScopeFacts(input);
    await this.repository.mergeConfigForScope({
      organizationId,
      scope: { scopeType: "PROJECT", scopeId: input.projectId },
      personalOnly: false,
      merge: (config) => this.validated(withPiiRedactionLevel({ config, level: input.level })),
    });
    this.cache.clear();
  }

  async removeForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    const organizationId = await this.resolveOrganizationId(input);
    await this.repository.deleteForScope({ ...input, organizationId });
    this.cache.clear();
  }

  private async resolveOrganizationId(input: {
    organizationId: string;
    scope: DataPrivacyScope;
  }): Promise<string> {
    if (input.scope.scopeType === "ORGANIZATION") {
      if (input.scope.scopeId !== input.organizationId) {
        throw new ScopeTargetNotFoundError();
      }

      return input.organizationId;
    }

    if (input.scope.scopeType === "TEAM" || input.scope.scopeType === "PROJECT") {
      const { organizationId, scope } = input;
      const lineage = await this.lineage.checkScopeLineage(
        scope.scopeType === "TEAM"
          ? { organizationId, teamId: scope.scopeId }
          : { organizationId, projectId: scope.scopeId },
      );
      if (lineage.kind !== "consistent") {
        throw new ScopeTargetNotFoundError();
      }

      return input.organizationId;
    }

    const departmentOrganizationId = await this.departments.findScopeOrganizationId({
      scope: input.scope,
    });
    if (departmentOrganizationId !== input.organizationId) {
      throw new ScopeTargetNotFoundError();
    }

    return input.organizationId;
  }

  /** ADR-208: an audience names only a live key a customer of this organization made. */
  private async assertNamedKeysAreTheOrganizations(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
    mayNameNewKeys: boolean;
  }): Promise<void> {
    const named = namedApiKeyIds(input.config);
    if (named.length === 0) return;
    const rows = await this.repository.findForProjectChain({
      organizationId: input.organizationId,
      scopes: [
        {
          scopeType: input.scope.scopeType,
          scopeId: input.scope.scopeId,
          personalOnly: input.personalOnly,
        },
      ],
    });
    // The chain read matches scope pairs only; the personal-projects rule shares its scope.
    const stored = rows.find((row) => row.personalOnly === input.personalOnly);
    const kept = stored ? namedApiKeyIds(stored.config) : [];
    // A save that adds no key needs nothing from api-key, so an api-key outage never blocks it.
    if (named.every((id) => kept.includes(id))) return;
    if (!input.mayNameNewKeys) {
      // A permission, not a bad rule: the caller may keep the rule's keys but add none.
      throw new ApiKeyAddForbiddenError();
    }
    const keys = await this.apiKeys.listAll({ organizationId: input.organizationId });
    if (foreignApiKeyIds({ named, keys, kept, now: this.clock() }).length > 0) {
      throw new InvalidDataPrivacyConfigError(
        "The restricted content audience names an API key this organization cannot give it.",
      );
    }
  }

  private validated(config: DataPrivacyConfig): DataPrivacyConfig {
    const parsed = dataPrivacyConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InvalidDataPrivacyConfigError(
        `Invalid data-privacy config: ${parsed.error.message}`,
      );
    }

    this.validatePatterns(parsed.data);
    if (namesKeysOnUnrestrictedCategory(parsed.data)) {
      throw new InvalidDataPrivacyConfigError(
        "Only a restricted category's audience can name API keys.",
      );
    }
    if (restrictedCategoriesDisagreeOnKeys(parsed.data)) {
      throw new InvalidDataPrivacyConfigError(
        "Every restricted category must name the same API keys.",
      );
    }
    if (namesKeysWithoutAdmins(parsed.data)) {
      throw new InvalidDataPrivacyConfigError(
        "An audience that names API keys must include Admins: a key reads as Admins do.",
      );
    }
    if (parsed.data.customAttributes?.some((rule) => rule.audience?.apiKeyIds?.length)) {
      throw new InvalidDataPrivacyConfigError(
        "A custom attribute rule's audience cannot name API keys; only content categories can.",
      );
    }

    return parsed.data;
  }

  private validatePatterns(config: DataPrivacyConfig): void {
    this.assertSafePatterns(config.secrets?.customPatterns ?? [], "Custom secret pattern");
    for (const pattern of config.secrets?.customPatterns ?? []) {
      const ordinaryText = overBroadSecretPatternProbe(pattern);
      if (ordinaryText !== null) {
        throw new InvalidDataPrivacyConfigError(
          `Custom secret pattern ${JSON.stringify(pattern.slice(0, 40))} also matches ordinary text like ${JSON.stringify(ordinaryText)}.`,
        );
      }
    }

    this.assertSafePatterns(config.pii?.exceptPatterns ?? [], "PII exception pattern");
    for (const pattern of config.pii?.exceptPatterns ?? []) {
      const expression = new RegExp(`^(?:${pattern})$`);
      const probes = [
        "4111111111111111",
        "12345678901234",
        "someone@example.com",
        "Jane Doe",
        "+1 555 0100",
      ];
      if (probes.filter((probe) => expression.test(probe)).length > 1) {
        throw new InvalidDataPrivacyConfigError(
          `PII exception pattern ${JSON.stringify(pattern)} is too broad.`,
        );
      }
    }

    for (const rule of config.customAttributes ?? []) {
      if (rule.pattern.replaceAll("*", "").length === 0) {
        throw new InvalidDataPrivacyConfigError(
          `Custom attribute pattern ${JSON.stringify(rule.pattern)} matches every attribute.`,
        );
      }
    }
  }

  private assertSafePatterns(patterns: string[], label: string): void {
    for (const pattern of patterns) {
      try {
        if (!safe(new RegExp(pattern))) {
          throw new Error("unsafe");
        }
      } catch {
        throw new InvalidDataPrivacyConfigError(
          `${label} ${JSON.stringify(pattern)} is not a safe regular expression.`,
        );
      }
    }
  }
}
