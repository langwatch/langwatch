import type { AuthzApi } from "@langwatch/authz-contract";
import {
  DepartmentScopeOwnershipUnavailableError,
  dataPrivacyConfigSchema,
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
  type DataPrivacyPiiRedactionLevel,
  type DataPrivacyPolicy,
  type DataPrivacyScope,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { overBroadSecretPatternProbe } from "@langwatch/redaction";
import safe from "safe-regex2";

import type { DataPrivacyPolicyRepository } from "../repositories/data-privacy.repository.ts";
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

export class DataPrivacyService {
  private readonly repository: DataPrivacyPolicyRepository;
  private readonly cache: DataPrivacyPolicyCacheService;
  private readonly resolution: DataPrivacyResolutionService;
  private readonly scopes: ScopeFacts;
  private readonly lineage: ScopeLineage;

  private constructor({
    repository,
    cache,
    resolution,
    scopes,
    lineage,
  }: {
    repository: DataPrivacyPolicyRepository;
    cache: DataPrivacyPolicyCacheService;
    resolution: DataPrivacyResolutionService;
    scopes: ScopeFacts;
    lineage: ScopeLineage;
  }) {
    this.repository = repository;
    this.cache = cache;
    this.resolution = resolution;
    this.scopes = scopes;
    this.lineage = lineage;
  }

  static create(options: {
    repository: DataPrivacyPolicyRepository;
    scopes: ScopeFacts;
    lineage: ScopeLineage;
    ttlMs?: number;
    now?: () => number;
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
    });
  }

  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy> {
    return this.resolution.getResolvedForProject(input);
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.resolution.listOrganizationRules(input);
  }

  async setForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    const config = this.validated(input.config);
    const organizationId = await this.resolveOrganizationId(input);
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

    throw new DepartmentScopeOwnershipUnavailableError();
  }

  private validated(config: DataPrivacyConfig): DataPrivacyConfig {
    const parsed = dataPrivacyConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InvalidDataPrivacyConfigError(
        `Invalid data-privacy config: ${parsed.error.message}`,
      );
    }

    this.validatePatterns(parsed.data);

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
