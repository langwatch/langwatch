import { AuthzApi } from "@langwatch/authz-contract";
import {
  DataPrivacyApi,
  type DataPrivacyCallerInput,
  type DataPrivacyConfig,
  dataPrivacyConfig,
  type DataPrivacyLogRecord,
  type DataPrivacyMetricAttributes,
  type DataPrivacyPiiRedactionLevel,
  type DataPrivacyPolicy,
  type DataPrivacyScope,
  type DataPrivacyScopeTarget,
  type DataPrivacyServerConfig,
  type DataPrivacySnapshot,
  type ResolvedDataPrivacy,
  type SpanContentDropResult,
} from "@langwatch/data-privacy-contract";
import { createTenantId } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { FeatureSetup } from "@langwatch/kernel";
import { OrganizationApi } from "@langwatch/organization-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { Secret } from "@langwatch/secrets";
import type { OtlpResource, OtlpSpan } from "@langwatch/trace-contract";

import type { DataPrivacyRepositories } from "../repositories/data-privacy.repositories.ts";
import { ContentDropPolicyService } from "../services/content-drop-policy.service.ts";
import { DataPrivacyPermissionsService } from "../services/data-privacy-permissions.service.ts";
import { DataPrivacyScopeAuthorizationService } from "../services/data-privacy-scope-authorization.service.ts";
import { DataPrivacySnapshotService } from "../services/data-privacy-snapshot.service.ts";
import { DataPrivacyService } from "../services/data-privacy.service.ts";
import { OtlpSpanContentDropService } from "../services/otlp-span-content-drop.service.ts";
import { OtlpSpanPiiRedactionService } from "../services/otlp-span-pii-redaction.service.ts";
import type { PiiAnalysis } from "./data-privacy.members.ts";

/** A project's place in the organization chain, plus the name it renders under. */
export type DataPrivacyProjectLineage = Readonly<{
  projectId: string;
  name: string;
  teamId: string | null;
  organizationId: string | null;
  organizationName: string | null;
}>;

/** One organization's scope targets, as the settings page lists them. */
export type DataPrivacyOrganizationDirectory = Readonly<{
  /** Archived departments stay in the list so existing rules keep a name. */
  departments: readonly { id: string; name: string; archived: boolean }[];
  teams: readonly { id: string; name: string }[];
  projects: readonly { id: string; name: string; teamId: string }[];
  /** The custom RBAC groups a `restrict` rule may name as its audience. */
  groups: readonly { id: string; name: string }[];
}>;

/**
 * Organization lineage for privacy rules: read-only members for naming scope
 * targets, avoiding write graphs or authz services.
 */
export interface DataPrivacyDirectoryReader {
  /** The project the settings page was opened from, or null when there is none. */
  findProjectLineage(input: { projectId: string }): Promise<DataPrivacyProjectLineage | null>;

  findOrganizationDirectory(input: {
    organizationId: string;
  }): Promise<DataPrivacyOrganizationDirectory>;

  /**
   * The organization that owns a scope target, or null when it doesn't
   * exist. The anchor every gate on a scope-targeted mutation checks
   * against — NOT a caller-supplied project id, which could name a different organization.
   */
  findScopeOrganizationId(input: { scope: DataPrivacyScope }): Promise<string | null>;
}

export type DataPrivacyInfrastructure = Readonly<{
  /** Which organization owns a scope target, and what each scope is called. */
  directory: DataPrivacyDirectoryReader;
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
          transport: PiiAnalysis;
          isLangevalsConfigured: boolean;
          isProduction: boolean;
          nativePolicyEnforced: boolean;
          piiRedactionMaxAttributeLength: number;
        }>;
      }>
  );

type DataPrivacySetup = FeatureSetup<
  typeof DataPrivacyApp.dependencies,
  Readonly<{ dataPrivacy: DataPrivacyInfrastructure }>,
  DataPrivacyServerConfig,
  DataPrivacyRepositories
>;

/** Applies a closure to the resolved credential without handing the value out. */
type GoogleCredentialsUse = <Out>(build: (credential: string | undefined) => Out) => Out;

/** The one public object of the scoped privacy rules. */
export class DataPrivacyApp implements DataPrivacyApi {
  static readonly contract = DataPrivacyApi;
  static readonly dependencies = {
    projects: ProjectApi,
    organizations: OrganizationApi,
    featureFlags: FeatureFlagApi,
    permissions: AuthzApi,
  };
  static readonly reads = ["dataPrivacy"] as const;
  static readonly config = dataPrivacyConfig;
  /** The DLP service account's key; model-provider's Vertex dispatch borrows it. */
  static readonly secrets = {
    googleApplicationCredentials: Secret.load("GOOGLE_APPLICATION_CREDENTIALS", { optional: true }),
  } as const;

  #privacy: DataPrivacyService;
  #redaction: OtlpSpanPiiRedactionService | null;
  #snapshots: DataPrivacySnapshotService;
  #scopeAuthorization: DataPrivacyScopeAuthorizationService;
  #contentDrop: ContentDropPolicyService;
  #spanContentDrop: OtlpSpanContentDropService;
  #projects: ProjectApi;
  #googleCredentials: GoogleCredentialsUse;

  private constructor(services: {
    privacy: DataPrivacyService;
    redaction: OtlpSpanPiiRedactionService | null;
    snapshots: DataPrivacySnapshotService;
    scopeAuthorization: DataPrivacyScopeAuthorizationService;
    contentDrop: ContentDropPolicyService;
    spanContentDrop: OtlpSpanContentDropService;
    projects: ProjectApi;
    googleCredentials: GoogleCredentialsUse;
  }) {
    this.#privacy = services.privacy;
    this.#redaction = services.redaction;
    this.#snapshots = services.snapshots;
    this.#scopeAuthorization = services.scopeAuthorization;
    this.#contentDrop = services.contentDrop;
    this.#spanContentDrop = services.spanContentDrop;
    this.#projects = services.projects;
    this.#googleCredentials = services.googleCredentials;
  }

  static async create({
    repositories,
    members: supplied,
    dependencies,
    config,
    secrets,
  }: DataPrivacySetup): Promise<DataPrivacyApp> {
    const googleCredentials = await secrets.into(
      DataPrivacyApp.secrets.googleApplicationCredentials,
      (credential): GoogleCredentialsUse =>
        (build) =>
          build(credential),
    );
    const members = supplied.dataPrivacy;
    const privacy = DataPrivacyService.create({
      repository: repositories.policies,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      ...(members.ttlMs === undefined ? {} : { ttlMs: members.ttlMs }),
      ...(members.now === undefined ? {} : { now: members.now }),
    });
    const permissions = DataPrivacyPermissionsService.create({ authz: dependencies.permissions });

    return new DataPrivacyApp({
      privacy,
      redaction:
        "pii" in members
          ? OtlpSpanPiiRedactionService.create({
              ...members.pii,
              dataPrivacy: privacy,
              featureFlags: dependencies.featureFlags,
            })
          : members.redaction,
      snapshots: DataPrivacySnapshotService.create({
        policies: privacy,
        directory: members.directory,
        permissions,
      }),
      scopeAuthorization: DataPrivacyScopeAuthorizationService.create({
        directory: members.directory,
        permissions,
      }),
      contentDrop: ContentDropPolicyService.create(),
      spanContentDrop: OtlpSpanContentDropService.create({
        dataPrivacy: privacy,
        nativePolicyEnforced: config.enforcement !== "off",
      }),
      projects: dependencies.projects,
      googleCredentials,
    });
  }

  intoGoogleApplicationCredentials<Out>(build: (credential: string | undefined) => Out): Out {
    return this.#googleCredentials(build);
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

  async redactSpan(input: {
    span: OtlpSpan;
    resource: OtlpResource | null;
    piiRedactionLevel: DataPrivacyPiiRedactionLevel;
    tenantId: string;
  }): Promise<void> {
    await this.#redactionPath().redactSpan({
      span: input.span,
      resource: input.resource,
      piiRedactionLevel: input.piiRedactionLevel,
      tenantId: createTenantId(input.tenantId),
    });
  }

  dropSpanContent(input: { span: OtlpSpan; projectId: string }): Promise<SpanContentDropResult> {
    return this.#spanContentDrop.dropSpanContent(input);
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
