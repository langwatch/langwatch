import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataPrivacyApi,
  type DataPrivacyCallerInput,
  type DataPrivacyConfig,
  type DataPrivacyLogRecord,
  type DataPrivacyMetricAttributes,
  type DataPrivacyPiiRedactionLevel,
  type DataPrivacyPolicy,
  type DataPrivacyScope,
  type DataPrivacyScopeTarget,
  type DataPrivacySnapshot,
  type ResolvedDataPrivacy,
} from "@langwatch/data-privacy-contract";
import { createTenantId } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import type { FeatureSetup } from "@langwatch/runtime-composition";
import type { DataPrivacyDirectoryRepository } from "../repositories/data-privacy-directory.repository.ts";
import type { PiiAnalysisPort } from "../ports/pii-analysis.port.ts";
import type { DataPrivacyRepositories } from "../repositories/data-privacy.repositories.ts";
import { ContentDropPolicyService } from "../services/content-drop-policy.service.ts";
import { DataPrivacyPermissionsService } from "../services/data-privacy-permissions.service.ts";
import { DataPrivacyScopeAuthorizationService } from "../services/data-privacy-scope-authorization.service.ts";
import { DataPrivacySnapshotService } from "../services/data-privacy-snapshot.service.ts";
import { DataPrivacyService } from "../services/data-privacy.service.ts";
import { OtlpSpanPiiRedactionService } from "../services/otlp-span-pii-redaction.service.ts";

export type DataPrivacyInfrastructure = Readonly<{
  /** Which organization owns a scope target, and what each scope is called. */
  directory: DataPrivacyDirectoryRepository;
  ttlMs?: number;
  now?: () => number;
}> &
  /**
   * The record redaction path, or `null` where the process composed no PII
   * analysis transport. Only the log and metric features call it, and they
   * are installed beside a transport.
   */
  (
    | Readonly<{ redaction: OtlpSpanPiiRedactionService | null }>
    | Readonly<{
        pii: Readonly<{
          transport: PiiAnalysisPort;
          isLangevalsConfigured: boolean;
          isProduction: boolean;
          nativePolicyEnforced: boolean;
          piiRedactionMaxAttributeLength: number;
        }>;
      }>
  );

type DataPrivacySetup = FeatureSetup<
  typeof DataPrivacyApp.dependencies,
  DataPrivacyInfrastructure,
  undefined,
  DataPrivacyRepositories
>;

/** The one public object of the scoped privacy rules. */
export class DataPrivacyApp implements DataPrivacyApi {
  static readonly contract = DataPrivacyApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    featureFlags: FeatureFlagApi,
    permissions: AuthzApi,
  };

  #privacy: DataPrivacyService;
  #redaction: OtlpSpanPiiRedactionService | null;
  #snapshots: DataPrivacySnapshotService;
  #scopeAuthorization: DataPrivacyScopeAuthorizationService;
  #contentDrop: ContentDropPolicyService;
  #projects: ProjectApi;

  private constructor(services: {
    privacy: DataPrivacyService;
    redaction: OtlpSpanPiiRedactionService | null;
    snapshots: DataPrivacySnapshotService;
    scopeAuthorization: DataPrivacyScopeAuthorizationService;
    contentDrop: ContentDropPolicyService;
    projects: ProjectApi;
  }) {
    this.#privacy = services.privacy;
    this.#redaction = services.redaction;
    this.#snapshots = services.snapshots;
    this.#scopeAuthorization = services.scopeAuthorization;
    this.#contentDrop = services.contentDrop;
    this.#projects = services.projects;
  }

  static create({ repositories, infrastructure, dependencies }: DataPrivacySetup): DataPrivacyApp {
    const privacy = DataPrivacyService.create({
      repository: repositories.policies,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      ...(infrastructure.ttlMs === undefined ? {} : { ttlMs: infrastructure.ttlMs }),
      ...(infrastructure.now === undefined ? {} : { now: infrastructure.now }),
    });
    const permissions = DataPrivacyPermissionsService.create({ authz: dependencies.permissions });

    return new DataPrivacyApp({
      privacy,
      redaction:
        "pii" in infrastructure
          ? OtlpSpanPiiRedactionService.create({
              ...infrastructure.pii,
              dataPrivacy: privacy,
              featureFlags: dependencies.featureFlags,
            })
          : infrastructure.redaction,
      snapshots: DataPrivacySnapshotService.create({
        policies: privacy,
        directory: infrastructure.directory,
        permissions,
      }),
      scopeAuthorization: DataPrivacyScopeAuthorizationService.create({
        directory: infrastructure.directory,
        permissions,
      }),
      contentDrop: ContentDropPolicyService.create(),
      projects: dependencies.projects,
    });
  }

  getResolvedForProject(input: { projectId: string }): Promise<ResolvedDataPrivacy> {
    return this.#privacy.getResolvedForProject(input);
  }

  listOrganizationRules(input: { organizationId: string }): Promise<DataPrivacyPolicy[]> {
    return this.#privacy.listOrganizationRules(input);
  }

  setForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
    config: DataPrivacyConfig;
  }): Promise<DataPrivacyPolicy> {
    return this.#privacy.setForScope(input);
  }

  removeForScope(input: {
    organizationId: string;
    scope: DataPrivacyScope;
    personalOnly: boolean;
  }): Promise<void> {
    return this.#privacy.removeForScope(input);
  }

  getSnapshot(input: { projectId: string } & DataPrivacyCallerInput): Promise<DataPrivacySnapshot> {
    return this.#snapshots.getSnapshot({ userId: input.userId, projectId: input.projectId });
  }

  async setScopeRule(
    input: DataPrivacyScopeTarget & { config: DataPrivacyConfig } & DataPrivacyCallerInput,
  ): Promise<DataPrivacyPolicy> {
    const organizationId = await this.#authorizeScopeWrite(input);

    return this.#privacy.setForScope({
      organizationId,
      scope: input.scope,
      personalOnly: input.personalOnly,
      config: input.config,
    });
  }

  async removeScopeRule(input: DataPrivacyScopeTarget & DataPrivacyCallerInput): Promise<void> {
    const organizationId = await this.#authorizeScopeWrite(input);

    await this.#privacy.removeForScope({
      organizationId,
      scope: input.scope,
      personalOnly: input.personalOnly,
    });
  }

  async dropsAnyContent(input: { projectId: string }): Promise<boolean> {
    return this.#contentDrop.dropsAnyContent(await this.#privacy.getResolvedForProject(input));
  }

  redactLog(
    input: DataPrivacyLogRecord,
    piiRedactionLevel: DataPrivacyPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void> {
    return this.#redactionPath().redactLog(
      input,
      piiRedactionLevel,
      tenantId ? createTenantId(tenantId) : undefined,
    );
  }

  redactMetricAttributes(
    input: DataPrivacyMetricAttributes,
    piiRedactionLevel: DataPrivacyPiiRedactionLevel,
    tenantId?: string,
  ): Promise<void> {
    return this.#redactionPath().redactMetricAttributes(
      input,
      piiRedactionLevel,
      tenantId ? createTenantId(tenantId) : undefined,
    );
  }

  /** Refuses by name on a process that composed no PII analysis transport. */
  #redactionPath(): OtlpSpanPiiRedactionService {
    if (!this.#redaction) {
      throw new Error(
        "This process composed no PII analysis transport, so it cannot redact a record.",
      );
    }

    return this.#redaction;
  }

  /**
   * Anchors a rule write to the acting project's organization and authorizes it
   * at the TARGET scope's own tier, then answers which organization the write
   * lands in.
   */
  async #authorizeScopeWrite(
    input: { projectId: string; scope: DataPrivacyScope } & DataPrivacyCallerInput,
  ): Promise<string> {
    await this.#scopeAuthorization.assertScopeBelongsToProjectOrganization({
      projectId: input.projectId,
      scope: input.scope,
    });
    await this.#scopeAuthorization.assertCanWriteScope({
      userId: input.userId,
      scope: input.scope,
    });
    const project = await this.#projects.getWithTeam(input.projectId);

    return project.team.organizationId;
  }
}
