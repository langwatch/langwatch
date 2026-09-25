// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { AgentApi } from "@langwatch/agent-contract";
import { ApiKeyApi } from "@langwatch/api-key-contract";
import { AuditLogApi } from "@langwatch/audit-log-contract";
import {
  AuthApi,
  type BrowserSessionInventoryEntry,
  type CliAccessSession,
} from "@langwatch/auth-contract";
/**
 * The governance feature's application: what all three of its doors call.
 *
 * Governance answers over two transports today — a project-scoped REST family
 * (ingestion templates) and two tRPC surfaces (personal virtual keys, routing
 * policies) — and before this each door declared its own private bag. The two
 * tRPC files each wrote `Readonly<{ governance: GovernanceApi }>`, agreeing
 * by attention rather than by construction, and the REST family took its two
 * capabilities as separate resolver functions that neither tRPC door could
 * reach. One object now holds the union, so a rule written here is the rule
 * every door gets.
 *
 * What lives here as a method is what a door would otherwise have to know:
 *
 *   - resolving a project's organization, which the REST family did seven
 *     times inline;
 *   - attributing a write to its caller, including the `svc_<projectId>`
 *     fallback a legacy project token gets — four copies of one rule;
 *   - the organization-membership gate on every personal-virtual-key call, and
 *     the duplicate-label refusal;
 *   - turning the Governance contract's plain domain errors into handled ones
 *     with stable codes, so no transport constructs a transport error.
 *
 * A caller arrives as an argument, never read from a session or a request.
 * That is what lets one operation serve a browser session, an API key and the
 * CLI without knowing which it is serving.
 */
import type { AuthzPermission, AuthzService } from "@langwatch/authz-contract";
import { AuthzApi, PermissionDeniedError } from "@langwatch/authz-contract";
import {
  NoEligibleProvidersError,
  NoEligibleModelProvidersError,
  PersonalVirtualKeyLabelTakenError,
  PersonalVirtualKeyMissingError,
  PersonalVirtualKeyNotFoundError,
  RoutingPolicyHasNoProvidersError,
  RoutingPolicyEmptyError,
  RoutingPolicyModelNotConcreteError,
  RoutingPolicyProviderRequiredError,
  RoutingPolicyScopeRequiredError,
  RoutingPolicyModelMustBeConcreteError,
  RoutingPolicyMustHaveProviderError,
  RoutingPolicyMustHaveScopeError,
  type CliBootstrapResult,
  type CreateRoutingPolicyInput,
  type DeleteRoutingPolicyInput,
  type Department,
  type DepartmentAssignments,
  type FindRoutingPolicyInput,
  type GovernanceBudgetOverviewForUser,
  type GovernanceApi,
  type RecordWorkspaceViewResult,
  type RecordWorkspaceViewInput,
  type QuarantineFillStats,
  type QuarantineFillInput,
  type GovernanceOcsfExportPage,
  type GovernanceOcsfExportInput,
  type GovernanceSetupState,
  getStarterTemplate,
  type IngestionSourceCreateInput,
  type IngestionSourceDto,
  type IngestionSourceUpdateInput,
  isOttlEnabledSourceType,
  OTTL_ENABLED_SOURCE_TYPES,
  type OttlStarterTemplate,
  type PersonaResolution,
  type GovernanceOttlGateway,
  type OttlValidationResult,
  type IssuedIngestionKey,
  type PersonalIngestionKeyListing,
  type PersonalIngestionKeyMint,
  type RotatedIngestionKey,
  type GovernanceCliBudgetStatusAnswer,
  type GovernanceCliBootstrapAnswer,
  type GovernanceCliBudgetOverviewAnswer,
  type GovernanceCliPersonalProjectAnswer,
  type GovernanceCliVirtualKeyAnswer,
  type GovernanceCliProjectKeyAnswer,
  type GovernanceCliIngestionSourcesAnswer,
  type GovernanceCliIngestionSourceEventsAnswer,
  type GovernanceCliIngestionSourceHealthAnswer,
  type GovernanceCliGovernanceStatusAnswer,
  type GovernanceCliIngestionTemplatesAnswer,
  type GovernanceCliIngestionKeyAnswer,
  type GovernanceCliIngestionKeysAnswer,
  type GovernanceCliIngestionKeyStateAnswer,
  type GovernanceCliKeyLookupRequest,
  type GovernanceCliRawRequest,
  type GovernanceCliRequest,
  type GovernanceCliSourceEventsRequest,
  type GovernanceCliSourceRequest,
  type GovernanceCliSourcesRequest,
  type GovernanceIngestOtlpInput,
  type GovernanceIngestResponse,
  type GovernanceIngestWebhookInput,
  type GovernanceProjectCaller,
  GovernanceRestApi,
  type IngestionTemplate,
  type AiToolEntry,
  type AiToolMemberInput,
  type AiToolOrganizationInput,
  type AiToolProviderOption,
  type AiToolStarterTileChoice,
  type CreateAiToolEntryInput,
  type FindAiToolEntryInput,
  type ReorderAiToolEntriesInput,
  type SeedAiToolStarterPackInput,
  type UpdateAiToolEntryInput,
  type CliSessionCard,
  type IssuedPersonalVirtualKeyAnswer,
  type GovernanceCaller,
  type GovernanceConfig,
  governanceConfig,
  governanceGatewayBaseUrl,
  type CliSessionRevocation,
  type CliUserInput,
  type RevokeCliSessionInput,
  type AnomalyRule,
  type ActivityEventDetailRow,
  type ActivityMonitorPagedWindowQuery,
  type ActivityMonitorSummary,
  type ActivityMonitorWindowQuery,
  type IngestionSourceHealthRow,
  type RecentAnomalyRow,
  type SourceHealthMetrics,
  type SpendByDepartmentRow,
  type SpendByTeamRow,
  type SpendByUserRow,
  type SpendOverTimeGroupBy,
  type SpendOverTimeResult,
  type CreateAnomalyRuleInput,
  type UpdateAnomalyRuleInput,
  type ArchiveIngestionTemplateInput,
  type CloneIngestionTemplateInput,
  type CreateIngestionTemplateInput,
  type UpdateIngestionTemplateOttlInput,
  type ListPersonalVirtualKeysInput,
  type ListRoutingPoliciesInput,
  type GovernanceActorWorkspace,
  type PersonalVirtualKey,
  type PersonalUsageQueryInput,
  type PersonalUsageRollup,
  type PersonalUsageWindow,
  type RoutingPolicy,
  type SetDefaultRoutingPolicyInput,
  type UpdateRoutingPolicyInput,
  governanceSecrets,
  AgentListingUnavailableError,
  type AgentListingRequestResult,
  type AgentSyncSourceListing,
  type IdentityMatchConfirmed,
  type IdentityMatchRun,
  type OrganizationSessionPolicyShape,
  type GovernanceAgentRow,
  type GovernanceCostDayRecords,
  type GovernanceCostModelBreakdown,
  type GovernanceCostPeriodRecordsInput,
  type GovernanceCostProviderDayBreakdown,
  type GovernanceCostWindowInput,
  type GovernanceSpenderBreakdown,
  type PeopleScreenPerson,
  type PeopleScreenSuggestion,
  type SessionCeilingApplied,
} from "@langwatch/enterprise-governance-contract";
import { ScimApi } from "@langwatch/enterprise-scim-contract";
import {
  assertEnterprisePlanType,
  isEnterpriseTier,
  EntitlementApi,
  type EntitlementOperator,
  type EnterpriseFeature,
  ENTERPRISE_FEATURE_ERRORS,
} from "@langwatch/entitlement-contract";
import type { EventingCommandSender } from "@langwatch/eventing";
import { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import { GatewayApi } from "@langwatch/gateway-contract";
import { isZodLikeError, ValidationError } from "@langwatch/handled-error";
import type { EventingParticipation, FeatureSetup } from "@langwatch/kernel";
import {
  ModelProviderApi,
  suggestTierTargets,
  type SuggestTierTargetsInput,
  type TierTargetSuggestion,
} from "@langwatch/model-provider-contract";
import { createLogger } from "@langwatch/observability";
import {
  OrganizationApi,
  type OrganizationService,
  TeamNotFoundError,
} from "@langwatch/organization-contract";
import { PROJECT_KIND, ProjectApi } from "@langwatch/project-contract";
import { TraceApi } from "@langwatch/trace-contract";
import { UserApi } from "@langwatch/user-contract";

import { governanceListingChannels } from "../channels/governance-listing-channels.registry.ts";
import { ClaudeComplianceReferencePullerAdapter } from "../channels/http/http.claude-compliance.channel.ts";
import { HttpCopilotStudioDataverseChannel } from "../channels/http/http.copilot-studio-dataverse.channel.ts";
import { HttpCopilotStudioChannel } from "../channels/http/http.copilot-studio.channel.ts";
import { HttpOttlTransformChannel } from "../channels/http/http.ottl-transform.channel.ts";
import { HttpPollingPullerAdapter } from "../channels/http/http.polling.channel.ts";
import { HttpProviderAccountChannel } from "../channels/http/http.provider-account.channel.ts";
import { GovernanceCostRollupFoldProjection } from "../eventing/governance-cost-rollup.projection.ts";
import { GovernanceCostRollupStore } from "../eventing/governance-cost-rollup.store.ts";
import { IngestionPullProcess } from "../eventing/ingestion-pull.process.ts";
import type { GovernanceRepositories } from "../repositories/governance.repositories.ts";
import { anomalyRuleConfigComplaint } from "../rules/anomaly-rule-config-error.rules.ts";
import { nextIngestionPullRunAt } from "../rules/ingestion-pull-schedule.rules.ts";
import { toPullLifecycleSource } from "../rules/pull-schedule.rules.ts";
import { ratePulledUsage } from "../rules/pulled-usage-rate.rules.ts";
import { DefaultGovernanceAdminWorkspaceViewAuditService } from "../services/admin-workspace-view-audit.service.ts";
import { AgentDiscoveryService } from "../services/agent-discovery.service.ts";
import { DefaultGovernanceAiToolCatalogService } from "../services/ai-tool-catalog.service.ts";
import { ModelProviderAiToolCatalogService } from "../services/ai-tool-provider-catalog.service.ts";
import { AiToolProviderReachService } from "../services/ai-tool-provider-reach.service.ts";
import { GovernanceAiToolSlugService } from "../services/ai-tool-slug.service.ts";
import { AnomalyRuleService } from "../services/anomaly-rule.service.ts";
import { AnthropicAdminPullerAdapter } from "../services/anthropic-admin-puller.service.ts";
import { DefaultGovernanceCliSessionInventoryService } from "../services/cli-session-inventory.service.ts";
import { DatabricksGeniePullerService } from "../services/databricks-genie-puller.service.ts";
import { DepartmentService } from "../services/department.service.ts";
import { DirectoryDepartmentSyncService } from "../services/directory-department-sync.service.ts";
import { ErasureSuppressionService } from "../services/erasure-suppression.service.ts";
import { GovernanceAgentSyncService } from "../services/governance-agent-sync.service.ts";
import { GovernanceAgentsScreenService } from "../services/governance-agents-screen.service.ts";
import {
  GovernanceCliAccessService,
  type GovernanceCliAccessApi,
  type GovernanceCliMemberDirectory,
} from "../services/governance-cli-access.service.ts";
import {
  GovernanceCliActivityService,
  type GovernanceCliActivityApi,
} from "../services/governance-cli-activity.service.ts";
import {
  GovernanceCliCredentialService,
  type GovernanceCliBudgetReader,
  type GovernanceCliCredentialApi,
  type GovernanceCliPersonDirectory,
} from "../services/governance-cli-credentials.service.ts";
import { DefaultGovernanceCliBootstrapService } from "../services/governance-cli-tool-bootstrap.service.ts";
import { GovernanceCliService } from "../services/governance-cli.service.ts";
import { GovernanceCostBreakdownService } from "../services/governance-cost-breakdown.service.ts";
import { GovernanceIngestAccessService } from "../services/governance-ingest-access.service.ts";
import type { GovernanceIngestRateLimiter } from "../services/governance-ingest-rate-limit.service.ts";
import {
  GovernanceIngestReceiverService,
  type GovernanceIngestLogCollectionChannel,
  type GovernanceIngestMetricCollectionChannel,
  type GovernanceIngestPrincipalDirectory,
  type GovernanceIngestSpend,
  type GovernanceIngestTraceCollection,
} from "../services/governance-ingest-receiver.service.ts";
import { GovernanceIngestService } from "../services/governance-ingest.service.ts";
import { GovernancePeopleScreenService } from "../services/governance-people-screen.service.ts";
import { DefaultGovernancePersonalVirtualKeyService } from "../services/governance-personal-key.service.ts";
import { DefaultGovernanceRoutingPolicyService } from "../services/governance-routing.service.ts";
import { DefaultGovernanceSetupStateService } from "../services/governance-setup-state.service.ts";
import { IdentityMatchSuggestionService } from "../services/identity-match-suggestion.service.ts";
import { IdentityMatchService } from "../services/identity-match.service.ts";
import { IngestionCredentialsService } from "../services/ingestion-credentials.service.ts";
import {
  IngestionPullEventingAdapter,
  type IngestionPullDefinition,
} from "../services/ingestion-pull-eventing.service.ts";
import { IngestionPullLifecycleService } from "../services/ingestion-pull-lifecycle.service.ts";
import { IngestionPullListingService } from "../services/ingestion-pull-listing.service.ts";
import { IngestionPullLogService } from "../services/ingestion-pull-log.service.ts";
import { IngestionPullMetricsService } from "../services/ingestion-pull-metrics.service.ts";
import { IngestionPullWorkerService } from "../services/ingestion-pull-worker.service.ts";
import { IngestionPullService } from "../services/ingestion-pull.service.ts";
import { ActivityMonitorService } from "../services/ingestion-source-activity.service.ts";
import { IngestionSourceReadService } from "../services/ingestion-source-read.service.ts";
import {
  IngestionSecretConfiguration,
  IngestionSecretService,
} from "../services/ingestion-source-secret.service.ts";
import { IngestionSourceService } from "../services/ingestion-source.service.ts";
import { IngestionTemplateService } from "../services/ingestion-template.service.ts";
import { DefaultGovernanceOcsfExportService } from "../services/ocsf-export.service.ts";
import { OpenAiAdminPullerAdapter } from "../services/openai-admin-puller.service.ts";
import { OpenAiComplianceReferencePullerService } from "../services/openai-compliance-puller.service.ts";
import { OrganizationSessionPolicyService } from "../services/organization-session-policy.service.ts";
import { OrganizationSupportContactService } from "../services/organization-support-contact.service.ts";
import { PersonDiscoveryService } from "../services/person-discovery.service.ts";
import { PersonListingService } from "../services/person-listing.service.ts";
import { PersonaHomeService } from "../services/persona-home.service.ts";
import { PersonalIngestionKeyService } from "../services/personal-ingestion-key.service.ts";
import { PersonalUsageDashboardService } from "../services/personal-usage-dashboard.service.ts";
import { DefaultGovernancePersonalUsageService } from "../services/personal-usage.service.ts";
import { GatewayPersonalVirtualKeyIssuerService } from "../services/personal-virtual-key-issuer.service.ts";
import { PullDestinationService } from "../services/pull-destination.service.ts";
import {
  PulledUsageEventingAdapter,
  type PulledUsageDefinition,
} from "../services/pulled-usage-eventing.service.ts";
import { PulledUsagePricingService } from "../services/pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../services/pulled-usage-record.service.ts";
import { PullerRegistryService } from "../services/puller-registry.service.ts";
import { QuarantineFillEvaluatorService } from "../services/quarantine-fill.service.ts";
import { ProjectQuarantineTenantResolverService } from "../services/quarantine-tenant.service.ts";
import { S3PollingPullerService } from "../services/s3-puller.service.ts";
import { SourceCredentialAccessService } from "../services/source-credential-access.service.ts";
import { ssrfSafeFetch } from "../services/ssrf-safe-fetch.ts";
import { SuppressionSnapshotService } from "../services/suppression-snapshot.service.ts";
import type {
  GovernanceEncryptor,
  GovernanceHttpClient,
  PulledUsageDispatcher,
  GovernanceProjectDirectory,
} from "./governance.members.ts";

const logger = createLogger("langwatch:governance");

type EventingSenders = Readonly<Record<string, EventingCommandSender<unknown>>>;

/** Where an actor's own workspace lives, for the admin's drill-in link. */
/**
 * What the `/api/auth/cli` governance plane reads that this feature does not
 * own: the device session a bearer names, the seat behind it, the plan it is
 * admitted against, and the identity and contact reads its credential routes
 * perform.
 */
export interface GovernanceCliMembers {
  /** Whether a caller still holds a seat in the token's organization. */
  members: GovernanceCliMemberDirectory;
  /** The identity and project reads the credential routes perform. */
  persons: GovernanceCliPersonDirectory;
  /** Who to point a caller at when a budget refuses the request. */
  supportContacts: Pick<OrganizationSupportContactService, "findSupportContact">;
  /** The spend decision the budget pre-flight asks, where one is composed. */
  budgets?: GovernanceCliBudgetReader | undefined;
  /** The deployment's public origin; the links this family answers use it. */
  publicBaseUrl?: string | undefined;
}

/**
 * What the push-mode `/api/ingest` receivers reach: the tenant every payload
 * lands under, the pipelines each signal is folded into, and the throttle the
 * gate applies before a byte is read. Only the trace pipeline is required —
 * a signal this deployment folds nowhere answers `not-served` rather than
 * pretending to accept it.
 */
export interface GovernanceIngestMembers {
  /** The hidden per-organization governance project every receiver writes under. */
  projects: Pick<GovernanceProjectDirectory, "ensureInternal">;
  /** Who a cost event's actor email names, where they are a member. */
  principals: GovernanceIngestPrincipalDirectory;
  /** The trace pipeline. Required — without it there is no receiver at all. */
  traceCollection: GovernanceIngestTraceCollection;
  /** The log pipeline, where this process folds logs. */
  logCollection?: GovernanceIngestLogCollectionChannel | undefined;
  /** The metric pipeline, where this process folds metrics. */
  metricCollection?: GovernanceIngestMetricCollectionChannel | undefined;
  /** The spend ledger a cost event is priced into, where one is composed. */
  spend?: GovernanceIngestSpend | undefined;
  /** The per-caller throttle, where this deployment composed a counter. */
  rateLimit?: GovernanceIngestRateLimiter | undefined;
}

/**
 * What this application is assembled from, once its three peers have been
 * resolved from {@link GovernanceApp.dependencies} and merged with the
 * bespoke members: the private view the constructor holds, not the shape a
 * process supplies.
 */
export interface GovernanceAppDependencies {
  /**
   * The ~100-operation governance facade, and the CLI/ingest collaborators
   * behind it. Optional because nothing constructs
   * `createGovernanceInstallation` today — no `GovernanceInstallationOptions`
   * is assembled anywhere a process boots — so a process that installs this
   * app supplies none of the three. Every method that reads one of them (the
   * CLI/ingest accessors, and the personal-virtual-key, routing-policy and
   * CLI-bootstrap operations the REST family does not call) throws a plain
   * error if it is ever reached before a process actually supplies it; the
   * seven ingestion-template and two department operations this REST family
   * serves read none of the three.
   */
  governance?: GovernanceApi;
  /**
   * The organization a project belongs to, for the project-scoped REST family,
   * and the organization's hidden governance project, which is the tenant an
   * ingestion source's usage rows land in.
   */
  projects: Pick<
    ProjectApi,
    | "getOrganizationId"
    | "findInternal"
    | "countWithTraces"
    | "findSharedProjectSlugs"
    | "listActiveByScopes"
    | "listByTeam"
    | "listIdsByOrganization"
    | "findWithTeam"
    | "ensureInternal"
    | "findInternalIds"
    | "findProjectsWithDepartments"
    | "assignProjectDepartment"
    | "findLiveNonGovernanceIdsByOrganization"
  >;
  /** Agent owns the Agent table: the organization's connected agents, read by project. */
  agents: Pick<AgentApi, "findConnectedInProjects">;
  /** The release flag that decides whether an organization's pulled usage carries a cost. */
  featureFlags: Pick<FeatureFlagApi, "isEnabled">;
  /** Where a pulled Genie/Copilot conversation lands as a trace: the OTLP door main routed through. */
  traces: Pick<TraceApi, "otlpTraces">;
  apiKeys: Pick<
    ApiKeyApi,
    | "revokeCliSessionKey"
    | "applySessionCeiling"
    | "create"
    | "revoke"
    | "findById"
    | "findByLookupId"
    | "findIngestionKeysForUser"
  >;
  gateway: Pick<
    GatewayApi,
    | "createVirtualKey"
    | "revokeVirtualKey"
    | "findPersonalVirtualKeys"
    | "findVirtualKeyById"
    | "budgetOverviewForUser"
  >;
  modelProviders: Pick<
    ModelProviderApi,
    "countEnabledInScopes" | "findEnabledProviderKeysInScopes"
  >;
  users: Pick<UserApi, "findById" | "findByEmail" | "findLastHomePath">;
  /** Audit-log owns the AuditLog table: workspace-view rows are written and deduped there. */
  auditLog: Pick<AuditLogApi, "record" | "hasRecordedSince">;
  /** Auth owns CLI bearer validation and revocation. */
  auth: Pick<
    AuthApi,
    | "findCliAccessSession"
    | "revokeCliAccessToken"
    | "findCliTokenRecordsForUser"
    | "revokeCliTokens"
    | "listBrowserSessions"
    | "endBrowserSession"
    | "endBrowserSessionsForIdentifier"
  >;
  /** Entitlements resolve the actual caller organization, never a deployment-global plan. */
  entitlements: Pick<EntitlementApi, "getActivePlan">;
  /**
   * The member's personal workspace: created on demand when they mint their
   * first key, read as it stands when they open their own dashboard.
   */
  organizations: Pick<OrganizationService, "ensurePersonalWorkspace" | "getPersonalWorkspace"> &
    Pick<
      OrganizationApi,
      | "isMember"
      | "findMembersIncludingDeactivated"
      | "findMemberDepartments"
      | "findMembersWithDepartments"
      | "assignMemberDepartment"
      | "findMemberDepartmentsOnDay"
      | "findOpenMemberDepartmentLinks"
      | "findTeamsWithDepartments"
      | "findMemberTeamIds"
      | "assignTeamDepartment"
      | "findPrimaryIntent"
      | "getTeam"
      | "getTeamWithMembers"
      | "getSessionPolicy"
      | "saveSessionPolicy"
    >;
  /** The SSO directory's external ids, which the identity match reads as proof. */
  scim: Pick<ScimApi, "findDirectoryExternalIds">;
  /**
   * The process's permission engine. Read directly rather than through a port
   * because the one question this feature asks it — may the caller see somebody
   * else's personal keys — is a plain decision at the organization scope.
   */
  permissions: Pick<AuthzService, "getDecision">;
  /**
   * What the CLI governance plane reaches beyond this feature. Optional for
   * the same reason as {@link governance} — supplied only alongside it.
   */
  cli?: GovernanceCliMembers;
  /**
   * What the push-mode ingestion receivers reach beyond this feature.
   * Optional for the same reason as {@link governance} — supplied only
   * alongside it.
   */
  ingest?: GovernanceIngestMembers;
}

/**
 * What a process cannot hand this application from a peer's API: the
 * governance capability itself and the four bespoke directories behind it.
 *
 * Every one of these is a conversion debt with a named destination — the
 * capability becomes what this app IS rather than something injected into it,
 * the two personal-virtual-key checks and the actor lookup become repository
 * reads, and the CLI and ingest bags split into peers, channels and config.
 * Until then they travel beside the process's own members the way
 * `ScimBespokeMembers` does, so that what is genuinely unfinished is visible
 * in the type rather than hidden inside one undifferentiated bag.
 *
 * `governance`, `cli` and `ingest` stay three separate keys here rather than
 * folding into one grouped optional slot: `buildAppWithUnfinishedCapability`
 * in `app/__tests__/governance.app.unit.test.ts` builds this application by
 * naming them at this same top level, and a grouped slot would turn that into
 * an excess-property error. Each is independently optional instead, for the
 * one reason given on {@link GovernanceAppDependencies.governance}.
 */
export type GovernanceBespokeMembers = Omit<
  GovernanceAppDependencies,
  "projects" | "organizations" | "permissions" | "scim"
>;

/**
 * How a process installs this application: three peers, its own Prisma read,
 * and the still-unfinished governance/cli/ingest bag (see
 * {@link GovernanceAppDependencies.governance}) — untouched by the
 * personalVirtualKeys/actors conversion below.
 */
type GovernanceSetup = Readonly<{
  dependencies: FeatureSetup<typeof GovernanceApp.dependencies, never, undefined>["dependencies"];
  config: GovernanceConfig | undefined;
  resources: FeatureSetup<typeof GovernanceApp.dependencies, never, undefined>["resources"];
  secrets: FeatureSetup<typeof GovernanceApp.dependencies, never, undefined>["secrets"];
  members: Readonly<{
    encryption: GovernanceEncryptor;
    isSaas: boolean;
  }> &
    Pick<GovernanceBespokeMembers, "governance" | "cli" | "ingest">;
  repositories: GovernanceRepositories;
}>;

export class GovernanceApp implements GovernanceRestApi {
  static readonly contract: typeof GovernanceRestApi = GovernanceRestApi;
  static readonly reads = ["encryption", "isSaas"] as const;
  /**
   * The peer modules this application reads. A peer is never a member:
   * the process resolves each token and hands the app the peer's own API, so
   * governance names what it needs rather than being handed a narrowed copy
   * whichever composition root happened to build it.
   */
  static readonly dependencies = {
    agents: AgentApi,
    projects: ProjectApi,
    auth: AuthApi,
    entitlements: EntitlementApi,
    organizations: OrganizationApi,
    permissions: AuthzApi,
    scim: ScimApi,
    featureFlags: FeatureFlagApi,
    traces: TraceApi,
    apiKeys: ApiKeyApi,
    gateway: GatewayApi,
    modelProviders: ModelProviderApi,
    users: UserApi,
    auditLog: AuditLogApi,
  };
  static readonly config = governanceConfig;
  static readonly secrets = governanceSecrets;

  static async create({
    config,
    members,
    dependencies,
    repositories,
    secrets,
  }: GovernanceSetup): Promise<GovernanceApp> {
    const erasureSuppression = await secrets.into(
      governanceSecrets.erasurePseudonymSecret,
      (erasureSecret) =>
        ErasureSuppressionService.create({
          suppressions: repositories.erasedIdentifierSuppressions,
          tenantHistory: repositories.tenantHistory,
          erasureSecret,
        }),
    );
    const ingestionSecrets = await secrets.into(governanceSecrets.ingestionSecretPepper, (pepper) =>
      IngestionSecretService.create(IngestionSecretConfiguration.create({ pepper: pepper ?? "" })),
    );
    // Main posted OTTL to LW_GATEWAY_INTERNAL_URL, then LW_GATEWAY_BASE_URL; only the legacy leaf is shared today.
    const ottl = await secrets.into(governanceSecrets.ottlSigningSecret, (secret) =>
      HttpOttlTransformChannel.create({
        baseUrl: config?.gatewayInternalUrl ?? config?.gatewayLegacyUrl ?? null,
        secret,
      }),
    );
    return new GovernanceApp({
      ottl,
      ingestionSecrets,
      dependencies: {
        governance: members.governance,
        cli: members.cli,
        ingest: members.ingest,
        agents: dependencies.agents,
        projects: dependencies.projects,
        auth: dependencies.auth,
        entitlements: dependencies.entitlements,
        organizations: dependencies.organizations,
        permissions: dependencies.permissions,
        scim: dependencies.scim,
        featureFlags: dependencies.featureFlags,
        traces: dependencies.traces,
        apiKeys: dependencies.apiKeys,
        gateway: dependencies.gateway,
        modelProviders: dependencies.modelProviders,
        users: dependencies.users,
        auditLog: dependencies.auditLog,
      },
      repositories,
      erasureSuppression,
      encryption: members.encryption,
      gatewayBaseUrl: governanceGatewayBaseUrl({ config, isSaas: members.isSaas }),
    });
  }

  private constructor({
    ottl,
    ingestionSecrets,
    dependencies,
    repositories,
    erasureSuppression,
    encryption,
    gatewayBaseUrl,
  }: {
    ottl: GovernanceOttlGateway;
    ingestionSecrets: IngestionSecretService;
    dependencies: GovernanceAppDependencies;
    repositories: GovernanceRepositories;
    erasureSuppression: ErasureSuppressionService;
    encryption: GovernanceEncryptor;
    gatewayBaseUrl: string;
  }) {
    this.dependencies = dependencies;
    this.repositories = repositories;
    this.encryption = encryption;
    this.anomalyRules = AnomalyRuleService.create({ repository: repositories.anomalyRules });
    this.activityMonitor = ActivityMonitorService.create(repositories.activityMonitor);
    this.routingPolicies = DefaultGovernanceRoutingPolicyService.create({
      repository: repositories.routingPolicies,
    });
    this.personalKeys = DefaultGovernancePersonalVirtualKeyService.create({
      keys: dependencies.gateway,
      providers: dependencies.modelProviders,
      issuer: GatewayPersonalVirtualKeyIssuerService.create(dependencies.gateway),
      organizations: dependencies.organizations,
      policies: this.routingPolicies,
      gatewayBaseUrl,
    });
    this.sessionPolicy = OrganizationSessionPolicyService.create({
      organizations: dependencies.organizations,
      loginKeys: dependencies.apiKeys,
    });
    this.cliSessions = DefaultGovernanceCliSessionInventoryService.create({
      auth: dependencies.auth,
      loginKeys: dependencies.apiKeys,
    });
    this.departments = DepartmentService.create({
      repository: repositories.departments,
      organizations: dependencies.organizations,
      projects: dependencies.projects,
    });
    this.erasureSuppression = erasureSuppression;
    // One instance: the erasure refreshes the very snapshot the cost fold reads (ADR-128 §9 step 5).
    this.suppressionSnapshot = SuppressionSnapshotService.create({
      load: () => erasureSuppression.loadSnapshot(),
    });
    this.identityMatches = IdentityMatchService.create({
      discoveredPeople: repositories.discoveredPeople,
      matches: repositories.identityMatches,
      suggestions: repositories.identityMatchSuggestions,
      organizations: dependencies.organizations,
      directory: dependencies.scim,
    });
    this.agentSync = GovernanceAgentSyncService.create({
      sources: repositories.ingestionSources,
      projects: dependencies.projects,
      listings: repositories.ingestionPullRuns,
      dispatch: (command) => this.agentListingSender().send(command),
    });
    this.agentsScreen = GovernanceAgentsScreenService.create({
      agents: dependencies.agents,
      projects: dependencies.projects,
      organizations: dependencies.organizations,
      discoveredAgents: repositories.discoveredAgents,
    });
    this.costBreakdown = GovernanceCostBreakdownService.create({
      costRollup: repositories.costRollup,
      projects: dependencies.projects,
      discoveredPeople: repositories.discoveredPeople,
    });
    this.people = GovernancePeopleScreenService.create({
      discoveredPeople: repositories.discoveredPeople,
      matches: repositories.identityMatches,
      suggestions: repositories.identityMatchSuggestions,
      departments: this.departments,
      organizations: dependencies.organizations,
    });
    this.identityMatchSuggestions = IdentityMatchSuggestionService.create({
      discoveredPeople: repositories.discoveredPeople,
      matches: repositories.identityMatches,
      suggestions: repositories.identityMatchSuggestions,
      organizations: dependencies.organizations,
    });
    this.templates = IngestionTemplateService.create({
      repository: repositories.ingestionTemplates,
    });
    this.aiTools = DefaultGovernanceAiToolCatalogService.create({
      repository: repositories.aiTools,
      slugs: GovernanceAiToolSlugService.create(),
      providers: ModelProviderAiToolCatalogService.create(),
      reach: AiToolProviderReachService.create({
        organizations: dependencies.organizations,
        projects: dependencies.projects,
        modelProviders: dependencies.modelProviders,
      }),
      departments: repositories.departments,
      routingPolicies: repositories.routingPolicies,
      sources: repositories.ingestionSources,
      members: dependencies.organizations,
      diagnostics: { warn: (message, context) => logger.warn(context, message) },
    });
    this.ingestionKeys = PersonalIngestionKeyService.create({
      apiKeys: dependencies.apiKeys,
      organizations: dependencies.organizations,
      templates: repositories.ingestionTemplates,
    });
    this.setupState = DefaultGovernanceSetupStateService.create({
      repository: repositories.setupState,
      keys: dependencies.gateway,
      projects: dependencies.projects,
      activity: repositories.traceActivity,
    });
    this.personaHome = PersonaHomeService.create({
      setupState: this.setupState,
      projects: dependencies.projects,
      entitlements: dependencies.entitlements,
      permissions: dependencies.permissions,
      users: dependencies.users,
      featureFlags: dependencies.featureFlags,
      organizations: dependencies.organizations,
    });
    this.workspaceViews = DefaultGovernanceAdminWorkspaceViewAuditService.create({
      auditLog: dependencies.auditLog,
      teams: dependencies.organizations,
      projects: dependencies.projects,
      events: repositories.ocsfEvents,
      diagnostics: { warn: (message, context) => logger.warn(context, message) },
    });
    this.ocsfExport = DefaultGovernanceOcsfExportService.create({
      repository: repositories.ocsfExports,
      events: repositories.ocsfEvents,
    });
    this.quarantineFill = QuarantineFillEvaluatorService.create({
      tenant: ProjectQuarantineTenantResolverService.create(dependencies.projects),
      traceActivity: repositories.traceActivity,
    });
    this.pullLifecycle = IngestionPullLifecycleService.create({
      repository: repositories.ingestionPullLifecycle,
      projects: dependencies.projects,
      tenant: {
        resolveTenantId: async (organizationId) =>
          (
            await dependencies.projects.ensureInternal({
              organizationId,
              kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
            })
          ).id,
      },
      commands: {
        configure: (input) => this.ingestionPullSender("configure").send(input),
        disable: (input) => this.ingestionPullSender("disable").send(input),
      },
    });
    const ingestionCredentials = IngestionCredentialsService.create(encryption);
    this.ingestionSources = IngestionSourceService.create({
      repository: repositories.ingestionSources,
      projects: dependencies.projects,
      entitlements: {
        hasEnterprisePlan: async (organizationId) =>
          isEnterpriseTier(
            (await dependencies.entitlements.getActivePlan({ organizationId })).type,
          ),
      },
      lifecycle: { sync: (source) => this.pullLifecycle.sync(toPullLifecycleSource(source)) },
      credentials: ingestionCredentials,
      secrets: ingestionSecrets,
      destinations: PullDestinationService.create(),
      providerAccounts: HttpProviderAccountChannel.create({ credentials: ingestionCredentials }),
      diagnostics: { warn: (message, context) => logger.warn(context, message) },
    });
    this.ottl = ottl;
    this.sourceReads = IngestionSourceReadService.create({
      sources: this.ingestionSources,
      pullRuns: repositories.ingestionPullRuns,
      projects: dependencies.projects,
    });
    // Stored credentials seal under the process's CREDENTIALS_SECRET, the key main sealed them with.
    const sourceCredentials = SourceCredentialAccessService.create({
      sources: repositories.ingestionSources,
      credentials: IngestionCredentialsService.create(encryption),
    });
    const http: GovernanceHttpClient = { fetch: ssrfSafeFetch };
    this.http = http;
    const channels = governanceListingChannels.live;
    const signIn = channels.providerSignIn.create({ http });
    this.agentDiscovery = AgentDiscoveryService.create({
      agents: repositories.discoveredAgents,
      sourceCredentials,
      signIn,
      genieSpaces: channels.genieSpaces.create({ http }),
      copilotBots: channels.copilotBots.create({ http }),
    });
    this.personListing = PersonListingService.create({
      sourceCredentials,
      suppression: erasureSuppression,
      discovery: PersonDiscoveryService.create({ people: repositories.discoveredPeople }),
      signIn,
      adminApiUsers: channels.adminApiUsers.create({ http }),
      microsoftDirectory: channels.microsoftDirectory.create({ http }),
      databricksScimUsers: channels.databricksScimUsers.create({ http }),
    });

    // In a real deployment all three arrive together, from the one call that
    // builds the facade (`createGovernanceInstallation`) — never singly. No
    // process makes that call today, so every service below stays unbuilt
    // and its accessor throws if a CLI/ingest transport or a personal-key/
    // routing-policy tRPC operation ever reaches it.
    this.personalUsageDashboards = PersonalUsageDashboardService.create({
      usage: DefaultGovernancePersonalUsageService.create({ reader: repositories.personalUsage }),
      organizations: dependencies.organizations,
      projects: dependencies.projects,
    });
    const supportContacts = OrganizationSupportContactService.create({
      repository: repositories.supportContacts,
    });
    this.cliBootstraps = DefaultGovernanceCliBootstrapService.create({
      catalog: this.aiTools,
      budgets: { overviewForUser: (input) => dependencies.gateway.budgetOverviewForUser(input) },
      contacts: {
        findAdminEmail: (organizationId) => supportContacts.findSupportContact({ organizationId }),
      },
      gatewayUrl: gatewayBaseUrl,
    });
    const { governance, cli, ingest } = dependencies;
    if (governance && cli && ingest) {
      this.cliAccessService = GovernanceCliAccessService.create({
        accessTokens: cliAccessTokens(dependencies.auth),
        directory: () => cli.members,
        plans: () => dependencies.entitlements,
        permittedOnOrganization: (input) =>
          this.permittedOn("organization", input.organizationId, input),
        publicBaseUrl: cli.publicBaseUrl,
      });
      this.cliCredentialService = GovernanceCliCredentialService.create({
        governance: () => governance,
        directory: () => cli.persons,
        supportContacts: () => cli.supportContacts,
        ensurePersonalWorkspace: (input) =>
          dependencies.organizations.ensurePersonalWorkspace(input),
        getPersonalWorkspace: (input) => dependencies.organizations.getPersonalWorkspace(input),
        permittedOnProject: (input) => this.permittedOn("project", input.projectId, input),
        budgets: cli.budgets,
        publicBaseUrl: cli.publicBaseUrl,
      });
      this.cliActivityService = GovernanceCliActivityService.create({
        governance: () => governance,
      });
      this.cliService = GovernanceCliService.create({
        access: this.cliAccessService,
        credentials: this.cliCredentialService,
        activity: this.cliActivityService,
        governance,
      });
      const ingestAccess = GovernanceIngestAccessService.create({
        governance: () => governance,
        rateLimit: ingest.rateLimit,
      });
      const ingestReceiver = GovernanceIngestReceiverService.create({
        governance: () => governance,
        projects: () => ingest.projects,
        directory: () => ingest.principals,
        traceCollection: ingest.traceCollection,
        logCollection: ingest.logCollection,
        metricCollection: ingest.metricCollection,
        spend: ingest.spend,
      });
      this.ingestService = GovernanceIngestService.create({
        access: ingestAccess,
        receiver: ingestReceiver,
      });
    }
  }

  private readonly dependencies: GovernanceAppDependencies;
  private readonly anomalyRules: AnomalyRuleService;
  private readonly activityMonitor: ActivityMonitorService;
  private readonly routingPolicies: DefaultGovernanceRoutingPolicyService;
  private readonly personalKeys: DefaultGovernancePersonalVirtualKeyService;
  private readonly cliSessions: DefaultGovernanceCliSessionInventoryService;
  private readonly sessionPolicy: OrganizationSessionPolicyService;
  private readonly people: GovernancePeopleScreenService;
  private readonly agentsScreen: GovernanceAgentsScreenService;
  private readonly costBreakdown: GovernanceCostBreakdownService;
  private readonly aiTools: DefaultGovernanceAiToolCatalogService;
  private readonly agentSync: GovernanceAgentSyncService;
  private readonly departments: DepartmentService;
  private readonly agentDiscovery: AgentDiscoveryService;
  private readonly personListing: PersonListingService;
  private readonly templates: IngestionTemplateService;
  private readonly ingestionKeys: PersonalIngestionKeyService;
  private readonly setupState: DefaultGovernanceSetupStateService;
  private readonly workspaceViews: DefaultGovernanceAdminWorkspaceViewAuditService;
  private readonly pullLifecycle: IngestionPullLifecycleService;
  private readonly ingestionSources: IngestionSourceService;
  private readonly sourceReads: IngestionSourceReadService;
  private readonly personaHome: PersonaHomeService;
  private readonly ottl: GovernanceOttlGateway;
  private readonly ocsfExport: DefaultGovernanceOcsfExportService;
  private readonly quarantineFill: QuarantineFillEvaluatorService;
  private readonly erasureSuppression: ErasureSuppressionService;
  private readonly suppressionSnapshot: SuppressionSnapshotService;
  private readonly identityMatches: IdentityMatchService;
  private readonly identityMatchSuggestions: IdentityMatchSuggestionService;
  private readonly repositories: GovernanceRepositories;
  private readonly encryption: GovernanceEncryptor;
  private readonly http: GovernanceHttpClient;
  private ingestionPullCommands: EventingSenders | undefined;
  private pulledUsageCommands: EventingSenders | undefined;
  private readonly personalUsageDashboards: PersonalUsageDashboardService;
  private readonly cliBootstraps: DefaultGovernanceCliBootstrapService;
  private readonly cliAccessService?: GovernanceCliAccessApi;
  private readonly cliCredentialService?: GovernanceCliCredentialApi;
  private readonly cliActivityService?: GovernanceCliActivityApi;
  private readonly cliService?: GovernanceCliService;
  private readonly ingestService?: GovernanceIngestService;

  /**
   * Every accessor below resolves to the ~100-operation governance facade
   * (see the comment on {@link GovernanceAppDependencies.governance}), which
   * no process builds yet. Its callers all sit behind the CLI/ingest
   * transports this module drops from its boot graph, or a tRPC surface no
   * composition root mounts — so this throw is unreachable in practice, and
   * honest about why on the day it stops being unreachable.
   */
  private unfinishedCapability(): never {
    throw new Error("governance: this capability is not installed on this app");
  }

  /** The governance facade, or a throw naming why it is absent. */
  private get governanceApi(): GovernanceApi {
    return this.dependencies.governance ?? this.unfinishedCapability();
  }

  /**
   * One permission question at one scope. Both CLI families ask it — the gate
   * at organization tier, the credential routes at project tier — and asking
   * it here is what keeps the deployment's AuthZ graph a single member rather
   * than a function each service is handed separately.
   */
  private async permittedOn(
    tier: "organization" | "project",
    id: string,
    input: { userId: string; permission: AuthzPermission },
  ): Promise<boolean> {
    const { permitted } = await this.dependencies.permissions.getDecision({
      userId: input.userId,
      permission: input.permission,
      scope: { tier, id },
    });

    return permitted;
  }

  // ── The CLI governance plane ──────────────────────────────────────────────

  /** The bearer, the plan and the RBAC permission, in that order. */
  /** ingestion_pull_processing for this role: the worker also hosts main's pull process manager. */
  ingestionPullPipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): IngestionPullDefinition {
    const runStatusStore = this.repositories.ingestionPullRuns;
    if (participation === "produce") {
      return IngestionPullEventingAdapter.create({ runStatusStore }).build();
    }
    return IngestionPullEventingAdapter.create({
      runStatusStore,
      process: this.ingestionPullProcess(),
    }).build();
  }

  connectIngestionPull(commands: EventingSenders): void {
    this.ingestionPullCommands = commands;
  }

  /** Main's boot reconciliation (`pipelineSet.ts:132-150`): every source's schedule sent to its pull process. */
  reconcileIngestionPulls({
    findPullProcessKeys,
  }: {
    findPullProcessKeys: (input: { projectIds: string[] }) => Promise<string[]>;
  }): Promise<{ reconciled: number; failed: number }> {
    return this.pullLifecycle.reconcile({ findPullProcessKeys });
  }

  /** pulled_usage_processing for this role: the worker also hosts main's `governanceCostRollup` fold. */
  pulledUsagePipeline({
    participation,
  }: {
    participation: EventingParticipation;
  }): PulledUsageDefinition {
    if (participation === "produce") return PulledUsageEventingAdapter.create().build();
    const costRollup = GovernanceCostRollupFoldProjection.create({
      store: GovernanceCostRollupStore.create(this.repositories.costRollup),
      actorIds: {
        actorIdForRollupWrite: ({ tenantId, rawActorId }) =>
          this.erasureSuppression.actorIdForRollupWrite({
            tenantId,
            rawActorId,
            snapshot: this.suppressionSnapshot,
          }),
      },
    });
    return PulledUsageEventingAdapter.create({ costRollup }).build();
  }

  connectPulledUsage(commands: EventingSenders): void {
    this.pulledUsageCommands = commands;
  }

  /** Main's `agentListingDispatcher`: no pull pipeline here is a named refusal. */
  private agentListingSender() {
    const sender = this.ingestionPullCommands?.["requestAgentsListing"];
    if (!sender) throw new AgentListingUnavailableError("event_sourcing_disabled");
    return sender;
  }

  private ingestionPullSender(name: string) {
    const sender = this.ingestionPullCommands?.[name];
    if (!sender) throw new Error(`ingestion_pull_processing is not registered for ${name}`);
    return sender;
  }

  private pulledUsageSender(name: string) {
    const sender = this.pulledUsageCommands?.[name];
    if (!sender) throw new Error(`pulled_usage_processing is not registered for ${name}`);
    return sender;
  }

  /** Main's `pipelineSet.ts:76-130`: the runner, its outcome senders late-bound, and the listings. */
  private ingestionPullProcess(): IngestionPullProcess {
    const { repositories, http, dependencies } = this;
    const diagnostics = IngestionPullLogService.create();
    const objects = governanceListingChannels.live.objectStore.create();
    const pullers = PullerRegistryService.create();
    pullers.register(HttpPollingPullerAdapter.create({ http, diagnostics }));
    pullers.register(S3PollingPullerService.create({ objects, diagnostics }));
    pullers.register(HttpCopilotStudioChannel.create({ http }));
    pullers.register(HttpCopilotStudioDataverseChannel.create(http));
    pullers.register(OpenAiComplianceReferencePullerService.create({ objects, diagnostics }));
    pullers.register(OpenAiAdminPullerAdapter.create(http));
    pullers.register(ClaudeComplianceReferencePullerAdapter.create({ http, diagnostics }));
    pullers.register(AnthropicAdminPullerAdapter.create(http));
    pullers.register(DatabricksGeniePullerService.create(http));
    const worker = IngestionPullWorkerService.create({
      sources: repositories.ingestionSources,
      registry: pullers,
      credentials: IngestionCredentialsService.create(this.encryption),
      projects: dependencies.projects,
      sink: repositories.ocsfEvents,
      usageEntitlement: {
        isEnabled: (organizationId) =>
          dependencies.featureFlags.isEnabled("release_pulled_usage_cost_enabled", {
            kind: "organization",
            organizationId,
          }),
      },
      usageRecords: PulledUsageRecordService.create(
        PulledUsagePricingService.create({ rate: ratePulledUsage }),
      ),
      suppression: this.erasureSuppression,
      discovery: PersonDiscoveryService.create({ people: this.repositories.discoveredPeople }),
      unpricedWindows: this.repositories.ingestionSources,
      departmentSync: DirectoryDepartmentSyncService.create({
        departments: this.departments,
        matcher: this.identityMatches,
        discoveredPeople: this.repositories.discoveredPeople,
        matches: this.repositories.identityMatches,
        organizations: dependencies.organizations,
      }),
      // Main `presets.ts:1566-1576`: proof before guesses, the order the engine spec fixes.
      identityMatch: {
        runFor: async ({ organizationId }) => {
          await this.identityMatches.linkProvenMatches({ organizationId });
          await this.identityMatchSuggestions.recompute({ organizationId });
        },
      },
      diagnostics,
      traceIngestion: {
        ingest: async ({ projectId, request }) => {
          const result = await dependencies.traces.otlpTraces({
            tenantId: projectId,
            traceRequest: request,
          });
          return {
            rejectedSpans: result.rejectedSpans ?? 0,
            ingestionFailures: result.ingestionFailures ?? 0,
            ...(result.ingestionFailureMessage
              ? { ingestionFailureMessage: result.ingestionFailureMessage }
              : {}),
          };
        },
      },
    });
    const pulledUsage: PulledUsageDispatcher = {
      recordPulledUsage: (input) => this.pulledUsageSender("recordPulledUsage").send(input),
    };
    return IngestionPullProcess.create({
      schedule: { nextRunAt: nextIngestionPullRunAt },
      execution: IngestionPullService.create({
        runPort: { run: (input) => worker.run({ ...input, pulledUsage }) },
        outcomePort: {
          completed: (input) => this.ingestionPullSender("recordRunCompleted").send(input),
          failed: (input) => this.ingestionPullSender("recordRunFailed").send(input),
        },
        metrics: IngestionPullMetricsService.create(),
      }),
      listing: IngestionPullListingService.create({
        sources: repositories.ingestionSources,
        agents: this.agentDiscovery,
        people: this.personListing,
        outcomes: {
          agentsListed: (input) => this.ingestionPullSender("recordAgentsListed").send(input),
          agentsListingRefused: (input) =>
            this.ingestionPullSender("recordAgentsListingRefused").send(input),
          peopleListed: (input) => this.ingestionPullSender("recordPeopleListed").send(input),
          peopleListingRefused: (input) =>
            this.ingestionPullSender("recordPeopleListingRefused").send(input),
        },
      }),
    });
  }

  cliAccess(): GovernanceCliAccessApi {
    return this.cliAccessService ?? this.unfinishedCapability();
  }

  /** Everything `/api/auth/cli` hands back or mints. */
  cliCredentials(): GovernanceCliCredentialApi {
    return this.cliCredentialService ?? this.unfinishedCapability();
  }

  /** The Activity Monitor reads, each with its ownership proof. */
  cliActivity(): GovernanceCliActivityApi {
    return this.cliActivityService ?? this.unfinishedCapability();
  }

  /** The same governance capability the console's tRPC procedures read. */
  governance(): GovernanceApi {
    return this.governanceApi;
  }

  cliBudgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).budgetStatus(input);
  }

  cliBootstrapRead(input: GovernanceCliRequest): Promise<GovernanceCliBootstrapAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).bootstrap(input);
  }

  cliBudgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).budgetOverview(input);
  }

  cliPersonalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).personalProject(input);
  }

  cliVirtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).virtualKey(input);
  }

  cliProjectKey(input: GovernanceCliRawRequest): Promise<GovernanceCliProjectKeyAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).projectKey(input);
  }

  cliIngestionSources(
    input: GovernanceCliSourcesRequest,
  ): Promise<GovernanceCliIngestionSourcesAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionSources(input);
  }

  cliIngestionSourceEvents(
    input: GovernanceCliSourceEventsRequest,
  ): Promise<GovernanceCliIngestionSourceEventsAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionSourceEvents(input);
  }

  cliIngestionSourceHealth(
    input: GovernanceCliSourceRequest,
  ): Promise<GovernanceCliIngestionSourceHealthAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionSourceHealth(input);
  }

  cliGovernanceStatus(input: GovernanceCliRequest): Promise<GovernanceCliGovernanceStatusAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).governanceStatus(input);
  }

  cliIngestionTemplates(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliIngestionTemplatesAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionTemplates(input);
  }

  cliIngestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionKey(input);
  }

  cliIngestionKeys(input: GovernanceCliRequest): Promise<GovernanceCliIngestionKeysAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionKeys(input);
  }

  cliIngestionKeyState(
    input: GovernanceCliKeyLookupRequest,
  ): Promise<GovernanceCliIngestionKeyStateAnswer> {
    return (this.cliService ?? this.unfinishedCapability()).ingestionKeyState(input);
  }

  // ── The push-mode ingestion receivers ─────────────────────────────────────

  ingestOtlpTraces(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveOtlpTraces(input);
  }

  ingestWebhook(input: GovernanceIngestWebhookInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveWebhook(input);
  }

  ingestOtlpLogs(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveOtlpLogs(input);
  }

  ingestOtlpMetrics(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse> {
    return (this.ingestService ?? this.unfinishedCapability()).receiveOtlpMetrics(input);
  }

  // ── Ingestion templates ───────────────────────────────────────────────────

  /** The templates a member of this project's organization may pick from. */
  async listIngestionTemplatesForMember(scope: {
    projectId: string;
  }): Promise<IngestionTemplate[]> {
    const organizationId = await this.organizationOf(scope.projectId);
    return this.templates.listForUser({ organizationId });
  }

  /** The same union, with the canonical OTTL source on every row. */
  async listIngestionTemplatesForAdmin(scope: { projectId: string }): Promise<IngestionTemplate[]> {
    const organizationId = await this.organizationOf(scope.projectId);
    return this.templates.listForOrgAdmin({ organizationId });
  }

  /** One template, scoped to the project's organization. */
  async getIngestionTemplate(input: { projectId: string; id: string }): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(input.projectId);
    return this.templates.getByIdForOrg({
      id: input.id,
      organizationId,
    });
  }

  /**
   * Creates an org-authored template, attributed to the caller who asked.
   *
   * The attribution is here rather than in the door because "who authored this
   * template" is a property of the act, not of the transport it arrived over,
   * and a door stamping it for itself is a chance to stamp it differently or
   * not at all.
   */
  async createIngestionTemplate(
    input: {
      sourceType: string;
      displayName: string;
      description?: string | null;
      iconAsset?: string | null;
      credentialSchema?: string | null;
      ottlRules?: string;
    },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(by.projectId);
    return this.templates.createOrgTemplate({
      organizationId,
      callerUserId: attributedUserId(by),
      sourceType: input.sourceType,
      displayName: input.displayName,
      description: input.description ?? null,
      iconAsset: input.iconAsset ?? null,
      credentialSchema: input.credentialSchema ?? null,
      ottlRules: input.ottlRules,
      surface: by.surface,
    });
  }

  /** Replaces a template's OTTL, attributed to the caller who asked. */
  async updateIngestionTemplateOttlRules(
    input: { id: string; ottlRules: string },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(by.projectId);
    return this.templates.updateOttlRules({
      organizationId,
      callerUserId: attributedUserId(by),
      id: input.id,
      ottlRules: input.ottlRules,
      surface: by.surface,
    });
  }

  /** Soft-archives an org-authored template, attributed to the caller. */
  async archiveIngestionTemplate(
    input: { id: string },
    by: GovernanceProjectCaller,
  ): Promise<void> {
    const organizationId = await this.organizationOf(by.projectId);
    await this.templates.archiveOrgTemplate({
      organizationId,
      callerUserId: attributedUserId(by),
      id: input.id,
      surface: by.surface,
    });
  }

  /** Forks a platform template into the caller's organization. */
  async cloneIngestionTemplate(
    input: { sourceTemplateId: string },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate> {
    const organizationId = await this.organizationOf(by.projectId);
    return this.templates.cloneFromPlatform({
      organizationId,
      callerUserId: attributedUserId(by),
      sourceTemplateId: input.sourceTemplateId,
      surface: by.surface,
    });
  }

  // ── The governance overview: setup state, OCSF export (Enterprise), quarantine fill ──

  // ── Ingestion sources (main `ingestionSources.ts`) ──────────────────────

  ingestionSourceList(input: { organizationId: string }): Promise<IngestionSourceDto[]> {
    return this.sourceReads.list(input.organizationId);
  }

  ingestionSourceGet(input: { id: string; organizationId: string }): Promise<IngestionSourceDto> {
    return this.sourceReads.get(input);
  }

  async ingestionSourceCreate(
    input: IngestionSourceCreateInput & { actorUserId: string },
  ): Promise<{ source: IngestionSourceDto; ingestSecret: string | null }> {
    const created = await this.ingestionSources.createSource(input);
    return {
      source: await this.sourceReads.present(created.source),
      ingestSecret: created.ingestSecret,
    };
  }

  async ingestionSourceUpdate(input: IngestionSourceUpdateInput): Promise<IngestionSourceDto> {
    return this.sourceReads.present(await this.ingestionSources.updateSource(input));
  }

  async ingestionSourceRotateSecret(input: {
    id: string;
    organizationId: string;
  }): Promise<{ source: IngestionSourceDto; ingestSecret: string }> {
    const rotated = await this.ingestionSources.rotateSecret(input);
    return {
      source: await this.sourceReads.present(rotated.source),
      ingestSecret: rotated.ingestSecret,
    };
  }

  async ingestionSourceArchive(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionSourceDto> {
    return this.sourceReads.present(await this.ingestionSources.archive(input));
  }

  ingestionSourceValidateOttl(input: { statements: string[] }): Promise<OttlValidationResult> {
    return this.ottl.validate(input.statements);
  }

  ingestionSourceOttlStarter({ sourceType }: { sourceType: string }): OttlStarterTemplate {
    return {
      enabled: isOttlEnabledSourceType(sourceType),
      statements: [...getStarterTemplate(sourceType)],
      enabledSourceTypes: [...OTTL_ENABLED_SOURCE_TYPES],
    };
  }

  governanceResolveHome(
    input: { organizationId: string },
    by: { id: string },
  ): Promise<PersonaResolution> {
    return this.personaHome.resolve({ organizationId: input.organizationId, userId: by.id });
  }

  async governanceSetupState(input: { organizationId: string }): Promise<GovernanceSetupState> {
    return this.setupState.resolve(input.organizationId);
  }

  async governanceOcsfExport(
    input: GovernanceOcsfExportInput,
    by: EntitlementOperator,
  ): Promise<GovernanceOcsfExportPage> {
    await this.assertEnterprise({
      organizationId: input.organizationId,
      by,
      feature: "OCSF_EXPORT",
    });
    return this.ocsfExport.list(input);
  }

  async governanceQuarantineFillStats(input: QuarantineFillInput): Promise<QuarantineFillStats> {
    return this.quarantineFill.evaluate(input);
  }

  async governanceRecordWorkspaceView(
    input: RecordWorkspaceViewInput,
  ): Promise<RecordWorkspaceViewResult> {
    return this.workspaceViews.recordView(input);
  }

  // ── Personal ingestion keys: the caller's own /me trace-ingest keys ──

  async ingestionKeyList(input: {
    organizationId: string;
    userId: string;
  }): Promise<PersonalIngestionKeyListing[]> {
    return this.ingestionKeys.list(input);
  }

  async ingestionKeyInstall(input: PersonalIngestionKeyMint): Promise<IssuedIngestionKey> {
    return this.ingestionKeys.mint(input);
  }

  async ingestionKeyRotate(input: PersonalIngestionKeyMint): Promise<RotatedIngestionKey> {
    return this.ingestionKeys.rotate(input);
  }

  async ingestionKeyRevoke(input: {
    organizationId: string;
    userId: string;
    apiKeyId: string;
  }): Promise<void> {
    return this.ingestionKeys.revoke(input);
  }

  async sessionPolicyGet(input: {
    organizationId: string;
  }): Promise<OrganizationSessionPolicyShape> {
    return this.sessionPolicy.get(input);
  }

  async sessionPolicySetMaxDuration(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<SessionCeilingApplied> {
    return this.sessionPolicy.setMaxDuration(input);
  }

  governanceAgentsSyncSources(input: {
    organizationId: string;
  }): Promise<AgentSyncSourceListing[]> {
    return this.agentSync.listableSourcesWithLastListing(input);
  }

  /** Main resolved the pull pipeline before reading a source, so its absence refuses even with nothing to list. */
  async governanceAgentsRequestListing(input: {
    organizationId: string;
  }): Promise<AgentListingRequestResult> {
    this.agentListingSender();
    return this.agentSync.requestListing(input);
  }

  governanceAgentsList(input: { organizationId: string }): Promise<GovernanceAgentRow[]> {
    return this.agentsScreen.listAgents(input);
  }

  // ── Governance cost (main's governanceCost router, Enterprise-gated per organization) ──

  async governanceCostDailyByProvider(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostProviderDayBreakdown> {
    await this.assertGovernanceCost(input.organizationId, by);
    return this.costBreakdown.dailyByProvider(input);
  }

  async governanceCostSpendByModel(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostModelBreakdown> {
    await this.assertGovernanceCost(input.organizationId, by);
    return this.costBreakdown.spendByModel(input);
  }

  async governanceCostPeriodRecords(
    input: GovernanceCostPeriodRecordsInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostDayRecords> {
    await this.assertGovernanceCost(input.organizationId, by);
    return this.costBreakdown.periodRecords(input);
  }

  async governanceCostSpenders(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceSpenderBreakdown> {
    await this.assertGovernanceCost(input.organizationId, by);
    return this.costBreakdown.spenderBreakdown(input);
  }

  private assertGovernanceCost(organizationId: string, by: EntitlementOperator): Promise<void> {
    return this.assertEnterprise({ organizationId, by, feature: "GOVERNANCE_COST" });
  }

  governancePeopleList(input: { organizationId: string }): Promise<PeopleScreenPerson[]> {
    return this.people.listPeople(input);
  }

  governancePeopleSuggestions(input: {
    organizationId: string;
  }): Promise<PeopleScreenSuggestion[]> {
    return this.people.listSuggestions(input);
  }

  governancePeopleRunMatch(input: { organizationId: string }): Promise<IdentityMatchRun> {
    return this.identityMatches.linkProvenMatches(input);
  }

  governancePeopleConfirmSuggestion(input: {
    organizationId: string;
    suggestionId: string;
  }): Promise<IdentityMatchConfirmed> {
    return this.identityMatches.confirmSuggestion(input);
  }

  // ── Personal web sessions: the caller's own browsers, which auth owns ──

  async personalWebSessionList(input: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<BrowserSessionInventoryEntry[]> {
    return [...(await this.dependencies.auth.listBrowserSessions(input))];
  }

  personalWebSessionEnd(input: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<{ ended: number }> {
    return this.dependencies.auth.endBrowserSession(input);
  }

  personalWebSessionsEndForIdentifier(input: {
    userId: string;
    identifierId: string;
  }): Promise<{ ended: number }> {
    return this.dependencies.auth.endBrowserSessionsForIdentifier(input);
  }

  // ── Personal CLI sessions: the caller's own devices, answered for their user id alone ──

  async cliSessionListForUser(input: CliUserInput): Promise<CliSessionCard[]> {
    const sessions = await this.cliSessions.listForUser(input);
    return sessions.map(
      ({ tokenKeys: _tokenKeys, organizationId: _organizationId, ...card }) => card,
    );
  }

  async cliSessionRevoke(input: RevokeCliSessionInput): Promise<CliSessionRevocation> {
    return { ok: true, ...(await this.cliSessions.revokeSession(input)) };
  }

  async cliSessionRevokeAll(input: CliUserInput): Promise<CliSessionRevocation> {
    return { ok: true, ...(await this.cliSessions.revokeAllSessions(input)) };
  }

  // ── Anomaly rules: Enterprise-only, refused per organization as main's gate did ──

  async anomalyRuleList(
    input: { organizationId: string },
    by: EntitlementOperator,
  ): Promise<AnomalyRule[]> {
    await this.assertEnterprise({
      organizationId: input.organizationId,
      by,
      feature: "ANOMALY_RULES",
    });
    return this.anomalyRules.list(input.organizationId);
  }

  async anomalyRuleGetById(
    input: { id: string; organizationId: string },
    by: EntitlementOperator,
  ): Promise<AnomalyRule> {
    await this.assertEnterprise({
      organizationId: input.organizationId,
      by,
      feature: "ANOMALY_RULES",
    });
    return this.anomalyRules.getById(input);
  }

  async anomalyRuleCreate(
    input: CreateAnomalyRuleInput,
    by: EntitlementOperator,
  ): Promise<AnomalyRule> {
    await this.assertEnterprise({
      organizationId: input.organizationId,
      by,
      feature: "ANOMALY_RULES",
    });
    return this.anomalyRules.createRule(input).catch((error: unknown) => {
      throw this.anomalyRuleConfigError(error, input.ruleType);
    });
  }

  async anomalyRuleUpdate(
    input: UpdateAnomalyRuleInput,
    by: EntitlementOperator,
  ): Promise<AnomalyRule> {
    await this.assertEnterprise({
      organizationId: input.organizationId,
      by,
      feature: "ANOMALY_RULES",
    });
    return this.anomalyRules.updateRule(input).catch((error: unknown) => {
      throw this.anomalyRuleConfigError(error, input.ruleType);
    });
  }

  async anomalyRuleArchive(
    input: { id: string; organizationId: string },
    by: EntitlementOperator,
  ): Promise<AnomalyRule> {
    await this.assertEnterprise({
      organizationId: input.organizationId,
      by,
      feature: "ANOMALY_RULES",
    });
    return this.anomalyRules.archive(input);
  }

  /** A config that fails its schema is main's handled complaint; any other failure passes through. */
  private anomalyRuleConfigError(error: unknown, ruleType?: string): unknown {
    if (!isZodLikeError(error)) return error;
    const complaint = anomalyRuleConfigComplaint({ issues: error.issues, ruleType });
    return new ValidationError(complaint, { meta: { formErrors: [complaint] } });
  }

  // ── The activity monitor: Enterprise-only, refused per organization as main's gate did ──

  async activitySummary(
    input: ActivityMonitorWindowQuery,
    by: EntitlementOperator,
  ): Promise<ActivityMonitorSummary> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.summary(input);
  }

  async activitySpendByUser(
    input: ActivityMonitorPagedWindowQuery,
    by: EntitlementOperator,
  ): Promise<SpendByUserRow[]> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.spendByUser(input);
  }

  async activitySpendByTeam(
    input: ActivityMonitorPagedWindowQuery,
    by: EntitlementOperator,
  ): Promise<SpendByTeamRow[]> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.spendByTeam(input);
  }

  async activitySpendByDepartment(
    input: ActivityMonitorWindowQuery,
    by: EntitlementOperator,
  ): Promise<SpendByDepartmentRow[]> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.spendByDepartment(input);
  }

  async activitySpendOverTime(
    input: ActivityMonitorWindowQuery & { groupBy: SpendOverTimeGroupBy },
    by: EntitlementOperator,
  ): Promise<SpendOverTimeResult> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.spendOverTime(input);
  }

  async activityRecentAnomalies(
    input: { organizationId: string; limit: number },
    by: EntitlementOperator,
  ): Promise<RecentAnomalyRow[]> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.recentAnomalies(input);
  }

  async activityIngestionSourcesHealth(
    input: { organizationId: string },
    by: EntitlementOperator,
  ): Promise<IngestionSourceHealthRow[]> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.ingestionSourcesHealth(input);
  }

  async activityEventsForSource(
    input: { organizationId: string; sourceId: string; limit: number; beforeIso?: string },
    by: EntitlementOperator,
  ): Promise<ActivityEventDetailRow[]> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.eventsForSource(input);
  }

  async activitySourceHealthMetrics(
    input: { organizationId: string; sourceId: string },
    by: EntitlementOperator,
  ): Promise<SourceHealthMetrics> {
    await this.assertActivityMonitor(input.organizationId, by);
    return this.activityMonitor.sourceHealthMetrics(input);
  }

  private assertActivityMonitor(organizationId: string, by: EntitlementOperator): Promise<void> {
    return this.assertEnterprise({ organizationId, by, feature: "ACTIVITY_MONITOR" });
  }

  private async assertEnterprise({
    organizationId,
    by,
    feature,
  }: {
    organizationId: string;
    by: EntitlementOperator;
    feature: EnterpriseFeature;
  }): Promise<void> {
    const operator = by.impersonatorId
      ? { id: by.id, impersonatorId: by.impersonatorId }
      : { id: by.id };
    const plan = await this.dependencies.entitlements.getActivePlan({ organizationId, operator });
    assertEnterprisePlanType({
      planType: plan.type,
      errorMessage: ENTERPRISE_FEATURE_ERRORS[feature],
    });
  }

  // ── The AI tools catalogue (the console's tRPC) ──────────────────────────

  aiToolListForUser(input: AiToolMemberInput): Promise<AiToolEntry[]> {
    return this.aiTools.findForMember(input);
  }

  async aiToolProviderAvailability(
    input: AiToolMemberInput,
  ): Promise<{ configuredProviders: string[] }> {
    return { configuredProviders: await this.aiTools.listConfiguredProvidersForUser(input) };
  }

  aiToolClaudeCodeOtlpEndpoint(
    input: AiToolOrganizationInput,
  ): Promise<{ endpoint: string | null }> {
    return this.aiTools.findClaudeCodeOtlpEndpoint(input);
  }

  aiToolListForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]> {
    return this.aiTools.listForAdmin(input);
  }

  aiToolGetById(input: FindAiToolEntryInput): Promise<AiToolEntry> {
    return this.aiTools.getById(input);
  }

  aiToolCreate(input: CreateAiToolEntryInput): Promise<AiToolEntry> {
    return this.aiTools.create(input);
  }

  aiToolUpdate(input: UpdateAiToolEntryInput): Promise<AiToolEntry> {
    return this.aiTools.update(input);
  }

  aiToolRemove(input: FindAiToolEntryInput): Promise<AiToolEntry> {
    return this.aiTools.remove(input);
  }

  aiToolSeedStarterPack(
    input: SeedAiToolStarterPackInput,
  ): Promise<{ created: number; updated: number; skipped: number }> {
    return this.aiTools.seedStarterPack(input);
  }

  aiToolStarterPackCatalog(): AiToolStarterTileChoice[] {
    return DefaultGovernanceAiToolCatalogService.listStarterPackTiles();
  }

  aiToolListProviderOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<AiToolProviderOption[]> {
    return this.aiTools.listProviderOptionsForAdmin(input);
  }

  aiToolListRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<{ id: string; name: string }[]> {
    return this.aiTools.listRoutingPolicyOptionsForAdmin(input);
  }

  aiToolReorder(input: ReorderAiToolEntriesInput): Promise<void> {
    return this.aiTools.reorder(input);
  }

  // ── Ingestion templates, organization-keyed (the console's tRPC) ──────────

  templateListForUser(input: { organizationId: string }): Promise<IngestionTemplate[]> {
    return this.templates.listForUser(input);
  }

  templateListForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]> {
    return this.templates.listForOrgAdmin(input);
  }

  templateGetByIdForOrg(input: { id: string; organizationId: string }): Promise<IngestionTemplate> {
    return this.templates.getByIdForOrg(input);
  }

  /** An `otlp_token` credential is the default one, so it is stored as none, as on main. */
  templateCreateOrg(input: CreateIngestionTemplateInput): Promise<IngestionTemplate> {
    return this.templates.createOrgTemplate({
      ...input,
      description: input.description ?? null,
      iconAsset: input.iconAsset ?? null,
      credentialSchema:
        input.credentialSchema === "otlp_token" ? null : (input.credentialSchema ?? null),
    });
  }

  templateUpdateOttlRules(input: UpdateIngestionTemplateOttlInput): Promise<IngestionTemplate> {
    return this.templates.updateOttlRules(input);
  }

  templateArchiveOrg(input: ArchiveIngestionTemplateInput): Promise<void> {
    return this.templates.archiveOrgTemplate(input);
  }

  templateCloneFromPlatform(input: CloneIngestionTemplateInput): Promise<IngestionTemplate> {
    return this.templates.cloneFromPlatform(input);
  }

  // ── Departments ────────────────────────────────────────────────────────────

  departmentList(input: { organizationId: string }): Promise<Department[]> {
    return this.departments.getAll(input);
  }

  departmentAssignments(input: { organizationId: string }): Promise<DepartmentAssignments> {
    return this.departments.getAssignments(input);
  }

  departmentCreate(input: { organizationId: string; name: string }): Promise<Department> {
    return this.departments.create(input);
  }

  departmentRename(input: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Department> {
    return this.departments.rename(input);
  }

  departmentArchive(input: { id: string; organizationId: string }): Promise<void> {
    return this.departments.archive(input);
  }

  departmentAssignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.departments.assignTeam(input);
  }

  departmentAssignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.departments.assignProject(input);
  }

  /** Finds a department by name, or creates it, for SCIM cost-center sync. */
  async departmentResolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department> {
    return this.departments.resolveByNameOrCreate(input);
  }

  /** Assigns (or clears) a member's department, for SCIM cost-center sync. */
  async departmentAssignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void> {
    return this.departments.assignUser(input);
  }

  // ── Personal virtual keys ─────────────────────────────────────────────────

  /**
   * Personal keys in an organization. Never returns the secret.
   *
   * A personal key belongs to its principal, so the caller's own keys need no
   * permission. `targetUserId` names someone else's, and omitting it asks for
   * every member's; both widen the result past the caller and so are answered
   * only for a holder of `virtualKeys:viewOtherPersonal` at this organization.
   */
  async listPersonalVirtualKeys(
    input: { organizationId: string; targetUserId?: string },
    by: GovernanceCaller,
  ): Promise<PersonalVirtualKey[]> {
    await this.assertOrganizationMembership({
      organizationId: input.organizationId,
      userId: by.id,
    });

    const principalUserId = await this.resolvePersonalKeyPrincipal(input, by);
    const query: ListPersonalVirtualKeysInput = {
      organizationId: input.organizationId,
      ...(principalUserId === undefined ? {} : { userId: principalUserId }),
    };
    return this.personalKeys.list(query);
  }

  /**
   * Issues a personal key under the given label, attributed to its principal.
   *
   * Returns the secret exactly once — the caller must persist it immediately.
   */
  async issuePersonalVirtualKey(
    input: { organizationId: string; label: string; routingPolicyId?: string },
    by: GovernanceCaller,
  ): Promise<IssuedPersonalVirtualKeyAnswer> {
    await this.assertOrganizationMembership({
      organizationId: input.organizationId,
      userId: by.id,
    });

    const profile = await this.dependencies.users.findById({ id: by.id });
    // Lazy backfill for members who joined before personal workspaces shipped.
    const workspace = await this.dependencies.organizations.ensurePersonalWorkspace({
      userId: by.id,
      organizationId: input.organizationId,
      displayName: by.displayName ?? profile?.name ?? null,
      displayEmail: by.displayEmail ?? profile?.email ?? null,
    });

    const duplicate = await this.personalKeys.hasLiveKeyLabelled({
      organizationId: input.organizationId,
      userId: by.id,
      label: input.label,
    });
    if (duplicate) throw new PersonalVirtualKeyLabelTakenError(input.label);

    try {
      const issued = await this.personalKeys.issue({
        userId: by.id,
        organizationId: input.organizationId,
        personalProjectId: workspace.project.id,
        personalTeamId: workspace.team.id,
        label: input.label,
        routingPolicyId: input.routingPolicyId,
      });
      return {
        id: issued.id,
        label: issued.label,
        secret: issued.secret,
        baseUrl: issued.baseUrl,
        displayPrefix: issued.virtualKey.displayPrefix,
        routingPolicyId: issued.routingPolicyId,
      };
    } catch (error) {
      if (error instanceof NoEligibleProvidersError) {
        throw new NoEligibleModelProvidersError(error.organizationId);
      }
      if (error instanceof RoutingPolicyHasNoProvidersError) {
        throw new RoutingPolicyEmptyError(error.routingPolicyId, error.routingPolicyName);
      }
      throw error;
    }
  }

  /** Revokes one of the caller's own personal keys. Idempotent. */
  async revokePersonalVirtualKey(
    input: { organizationId: string; id: string },
    by: GovernanceCaller,
  ): Promise<void> {
    await this.assertOrganizationMembership({
      organizationId: input.organizationId,
      userId: by.id,
    });

    try {
      await this.personalKeys.revoke({
        userId: by.id,
        organizationId: input.organizationId,
        virtualKeyId: input.id,
      });
    } catch (error) {
      if (error instanceof PersonalVirtualKeyNotFoundError) {
        throw new PersonalVirtualKeyMissingError(error.virtualKeyId);
      }
      throw error;
    }
  }

  // ── The member's own dashboard ────────────────────────────────────────────

  /**
   * Whether the caller belongs to this organization at all.
   *
   * Answered rather than enforced because the /me door re-checks membership
   * after `organization:view` and sends its own refusal: the permission says
   * the caller may act on an organization, this says the one they named is
   * theirs, which is what keeps a personal rollup inside their own tenant.
   */
  isOrganizationMember(input: { organizationId: string; userId: string }): Promise<boolean> {
    return this.dependencies.organizations.isMember(input);
  }

  /**
   * One person's own usage against a tenant the caller has already resolved:
   * the totals, the per-day buckets, and the split by model.
   */
  personalUsage(input: PersonalUsageQueryInput): Promise<PersonalUsageRollup> {
    return this.personalUsageDashboards.rollup(input);
  }

  /**
   * The same rollup for the caller's own /me screen, over the tenants their
   * traffic actually lands in. Zeros before their first request, so the page
   * renders rather than refusing.
   */
  personalUsageDashboard(
    input: { organizationId: string; window?: PersonalUsageWindow },
    by: GovernanceCaller,
  ): Promise<PersonalUsageRollup> {
    return this.personalUsageDashboards.read({
      userId: by.id,
      organizationId: input.organizationId,
      window: input.window,
    });
  }

  /**
   * Every budget that binds the caller's own keys in this organization, each
   * labelled with its scope, most binding first.
   *
   * The caller is always the subject: a member reads their OWN overview, which
   * is why the user id comes from `by` rather than from the input. One source,
   * so the /me screen and the CLI's login epilogue can never report different
   * numbers for the same budget.
   */
  personalBudgetOverview(
    input: { organizationId: string; includeTopModels?: boolean },
    by: GovernanceCaller,
  ): Promise<GovernanceBudgetOverviewForUser> {
    return this.dependencies.gateway.budgetOverviewForUser({
      organizationId: input.organizationId,
      userId: by.id,
    });
  }

  /**
   * What the CLI's login-completion ceremony renders: the tools and providers
   * this organization publishes to the caller, and their monthly budget.
   */
  cliBootstrap(
    input: { organizationId: string },
    by: GovernanceCaller,
  ): Promise<CliBootstrapResult> {
    return this.cliBootstraps.resolve({ userId: by.id, organizationId: input.organizationId });
  }

  /**
   * The personal workspace behind a CH-side `actor` token, for the bird's-eye
   * "View their workspace →" link on `/governance/users/[id]`.
   *
   * Three refusals collapse to one `null`: the token names nobody, the person
   * it names is not in this organization, or they have no personal workspace
   * yet. Keeping them indistinguishable is deliberate — a caller who may read
   * the governance surface still learns nothing about who else exists on the
   * instance from the shape of the answer.
   */
  async findActorWorkspace(input: {
    organizationId: string;
    actor: string;
  }): Promise<GovernanceActorWorkspace | null> {
    const user =
      (await this.dependencies.users.findById({ id: input.actor })) ??
      (input.actor.includes("@")
        ? await this.dependencies.users.findByEmail({ email: input.actor })
        : null);
    if (!user) return null;

    const member = await this.isOrganizationMember({
      organizationId: input.organizationId,
      userId: user.id,
    });
    if (!member) return null;

    const workspace = await this.dependencies.organizations
      .getPersonalWorkspace({
        userId: user.id,
        organizationId: input.organizationId,
      })
      .catch((error: unknown) => {
        if (TeamNotFoundError.is(error)) return null;
        throw error;
      });
    if (!workspace) return null;

    return {
      userId: user.id,
      // The admin reading the link needs a person, and any of the three
      // columns identifies one; the id is the last resort rather than a blank.
      displayName: user.name ?? user.email ?? user.id,
      teamId: workspace.team.id,
      projectId: workspace.project.id,
      projectSlug: workspace.project.slug,
    };
  }

  // ── Routing policies ──────────────────────────────────────────────────────

  /** Policies in an organization, optionally narrowed to one scope's choices. */
  listRoutingPolicies(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]> {
    return this.routingPolicies.list(input);
  }

  /** One policy by id, including its scope rows. */
  getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy> {
    return this.routingPolicies.getById(input);
  }

  /** Models worth pointing a tier at, ranked from the catalogue. */
  routingPolicyTierSuggestions(
    input: Omit<SuggestTierTargetsInput, "limit">,
  ): TierTargetSuggestion[] {
    return suggestTierTargets({
      tier: input.tier,
      boundProviderTypes: input.boundProviderTypes,
    });
  }

  /** Creates a policy, attributed to the caller who asked for it. */
  async createRoutingPolicy(
    input: Omit<CreateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    try {
      return await this.routingPolicies.create({
        ...input,
        actorUserId: by.id,
      });
    } catch (error) {
      throw asHandledRoutingPolicyError(error);
    }
  }

  /** Updates a policy, attributed to the caller who asked for it. */
  async updateRoutingPolicy(
    input: Omit<UpdateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    try {
      return await this.routingPolicies.update({
        ...input,
        actorUserId: by.id,
      });
    } catch (error) {
      throw asHandledRoutingPolicyError(error);
    }
  }

  /** Makes one policy the organization's default. */
  setDefaultRoutingPolicy(
    input: Omit<SetDefaultRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy> {
    return this.routingPolicies.setDefault({
      ...input,
      actorUserId: by.id,
    });
  }

  /** Removes one policy from the organization. */
  deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void> {
    return this.routingPolicies.delete(input);
  }

  // ── Internals ─────────────────────────────────────────────────────────────

  private organizationOf(projectId: string): Promise<string> {
    return this.dependencies.projects.getOrganizationId(projectId);
  }

  /** Refuses a caller who is not in the organization they named. */
  private async assertOrganizationMembership(input: {
    organizationId: string;
    userId: string;
  }): Promise<void> {
    if (await this.dependencies.organizations.isMember(input)) return;
    throw new PermissionDeniedError({
      permission: "organization:view",
      scope: { type: "organization", id: input.organizationId },
      denialReason: "no-membership",
    });
  }

  /**
   * Which principal's keys the caller may see: their own always, anyone
   * else's — or the whole organization, when no target is named — only with
   * `virtualKeys:viewOtherPersonal`. `undefined` means every member's.
   */
  private async resolvePersonalKeyPrincipal(
    input: { organizationId: string; targetUserId?: string },
    by: GovernanceCaller,
  ): Promise<string | undefined> {
    if (input.targetUserId === by.id) return by.id;

    const { permitted: canViewOthers } = await this.dependencies.permissions.getDecision({
      userId: by.id,
      permission: "virtualKeys:viewOtherPersonal",
      scope: { tier: "organization", id: input.organizationId },
    });
    if (input.targetUserId !== undefined) {
      if (!canViewOthers) {
        throw new PermissionDeniedError({
          permission: "virtualKeys:viewOtherPersonal",
          scope: { type: "organization", id: input.organizationId },
          denialReason: "no-binding",
        });
      }
      return input.targetUserId;
    }
    return canViewOthers ? undefined : by.id;
  }
}

/**
 * Who a project-scoped write is recorded against.
 *
 * A legacy project API key is bound to a project rather than to a person, so
 * there is no user to name; `svc_<projectId>` is what the audit row carries
 * instead, and it has to be one string, decided once.
 */
function attributedUserId(by: GovernanceProjectCaller): string {
  return by.userId ?? `svc_${by.projectId}`;
}

function cliAccessTokens(auth: Pick<AuthApi, "findCliAccessSession" | "revokeCliAccessToken">) {
  return {
    async resolve(authorization: string | null | undefined) {
      const session = await auth.findCliAccessSession({ authorization });
      return session ? toGovernanceCliCaller(session) : null;
    },
    revoke: ({ authHeader, userId }: { authHeader: string | null | undefined; userId: string }) =>
      auth.revokeCliAccessToken({ authorization: authHeader, userId }),
  };
}

function toGovernanceCliCaller(session: CliAccessSession) {
  return {
    user_id: session.userId,
    organization_id: session.organizationId,
    ...(session.cliApiKeyId ? { cli_api_key_id: session.cliApiKeyId } : {}),
    ...(session.clientInfo
      ? {
          client_info: {
            device_label: session.clientInfo.deviceLabel,
            hostname: session.clientInfo.hostname,
          },
        }
      : {}),
  };
}

/**
 * The Governance contract's three routing-policy guards, as handled errors
 * with stable codes. Anything else is returned untouched so it degrades to a
 * generic unknown carrying a trace id, per ADR-045.
 */
function asHandledRoutingPolicyError(error: unknown): unknown {
  if (error instanceof RoutingPolicyMustHaveProviderError) {
    return new RoutingPolicyProviderRequiredError();
  }
  if (error instanceof RoutingPolicyMustHaveScopeError) {
    return new RoutingPolicyScopeRequiredError();
  }
  if (error instanceof RoutingPolicyModelMustBeConcreteError) {
    return new RoutingPolicyModelNotConcreteError(error.field, error.value);
  }
  return error;
}
