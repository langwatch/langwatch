import { overBroadSecretPatternProbe } from "@langwatch/redaction";
import {
  DataPrivacyService as DataPrivacyServiceContract,
  DepartmentScopeOwnershipUnavailableError,
  dataPrivacyConfigSchema,
  InvalidDataPrivacyConfigError,
  ScopeTargetNotFoundError,
  type DataPrivacyConfig,
  type DataPrivacyPolicy,
  type DataPrivacyScope,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import safe from "safe-regex2";
import type { DataPrivacyPolicyRepository } from "../ports/data-privacy.port";
import { DataPrivacyPolicyCache } from "./data-privacy.cache";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { ProjectService } from "@langwatch/project-contract";

export class DataPrivacyService extends DataPrivacyServiceContract {
  private constructor(
    private readonly repository: DataPrivacyPolicyRepository,
    private readonly cache: DataPrivacyPolicyCache,
    private readonly projects: ProjectService,
    private readonly organizations: OrganizationService,
  ) {
    super();
  }

  static create(options: {
    repository: DataPrivacyPolicyRepository;
    projects: ProjectService;
    organizations: OrganizationService;
    ttlMs?: number;
    now?: () => number;
  }): DataPrivacyService {
    const cache = new DataPrivacyPolicyCache(
      options.repository,
      options.ttlMs,
      options.now,
    );
    return new DataPrivacyService(
      options.repository,
      cache,
      options.projects,
      options.organizations,
    );
  }

  async getResolvedForProject(input: {
    projectId: string;
  }): Promise<ResolvedDataPrivacy> {
    const project = await this.projects.getWithTeam(input.projectId);
    return this.cache.resolve({
      projectId: project.id,
      facts: {
        organizationId: project.team.organizationId,
        teamId: project.teamId,
        projectId: project.id,
        departmentId: project.departmentId,
        isPersonal: project.isPersonal,
      },
    });
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.repository.findAllInOrganization(input);
  }

  tryGetById(input: { id: string }): Promise<DataPrivacyPolicy | null> {
    return this.repository.tryFindById(input);
  }

  async setForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    const parsed = dataPrivacyConfigSchema.safeParse(input.config);
    if (!parsed.success) {
      throw new InvalidDataPrivacyConfigError(
        `Invalid data-privacy config: ${parsed.error.message}`,
      );
    }
    this.validatePatterns(parsed.data);
    const organizationId = await this.resolveOrganizationId(input);
    const row = await this.repository.upsertForScope({
      organizationId,
      scope: input.scope,
      personalOnly: input.personalOnly,
      config: parsed.data,
    });
    this.cache.clear();
    return row;
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
        throw new ScopeTargetNotFoundError(
          "The policy organization does not match its scope.",
        );
      }
      return input.organizationId;
    }
    if (input.scope.scopeType === "TEAM") {
      const team = await this.organizations.getTeamById({ teamId: input.scope.scopeId });
      if (team.organizationId !== input.organizationId) {
        throw new ScopeTargetNotFoundError(
          "The policy team does not belong to its organization.",
        );
      }
      return team.organizationId;
    }
    if (input.scope.scopeType === "PROJECT") {
      const project = await this.projects.getWithTeam(input.scope.scopeId);
      if (project.team.organizationId !== input.organizationId) {
        throw new ScopeTargetNotFoundError(
          "The policy project does not belong to its organization.",
        );
      }
      return project.team.organizationId;
    }
    throw new DepartmentScopeOwnershipUnavailableError();
  }

  private validatePatterns(config: DataPrivacyConfig): void {
    this.assertSafePatterns(
      config.secrets?.customPatterns ?? [],
      "Custom secret pattern",
    );
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
        if (!safe(new RegExp(pattern))) throw new Error("unsafe");
      } catch {
        throw new InvalidDataPrivacyConfigError(
          `${label} ${JSON.stringify(pattern)} is not a safe regular expression.`,
        );
      }
    }
  }
}
