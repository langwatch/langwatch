import type { EntitlementOperator } from "@langwatch/entitlement-contract";
import { moduleApi } from "@langwatch/kernel/module-api";

import type {
  RecordWorkspaceViewInput,
  RecordWorkspaceViewResult,
} from "./admin-workspace-view-audit.ts";
import type {
  AiToolCliCatalog,
  AiToolEntry,
  AiToolMemberInput,
  AiToolOrganizationInput,
  AiToolProviderOption,
  CreateAiToolEntryInput,
  FindAiToolEntryInput,
  ReorderAiToolEntriesInput,
  SeedAiToolStarterPackInput,
  UpdateAiToolEntryInput,
} from "./ai-tool-catalog.ts";
import type {
  AnomalyRule,
  CreateAnomalyRuleInput,
  UpdateAnomalyRuleInput,
} from "./anomaly-rule.ts";
import type { CanonicalCostEvent, OtlpLogsRequest } from "./canonical-cost.ts";
import type { CliBootstrapInput, CliBootstrapResult } from "./cli-bootstrap.ts";
import type {
  CliSession,
  CliSessionCard,
  CliSessionRevocation,
  CliUserInput,
  RevokeCliSessionInput,
} from "./cli-sessions.ts";
import type { TraceDepartmentInput, Department, DepartmentAssignments } from "./department.ts";
import type { GovernanceCallSurface } from "./governance-audit.ts";
import type {
  GovernanceCliBudgetStatusAnswer,
  GovernanceCliBootstrapAnswer,
  GovernanceCliBudgetOverviewAnswer,
  GovernanceCliPersonalProjectAnswer,
  GovernanceCliVirtualKeyAnswer,
  GovernanceCliProjectKeyAnswer,
  GovernanceCliIngestionSourcesAnswer,
  GovernanceCliIngestionSourceEventsAnswer,
  GovernanceCliIngestionSourceHealthAnswer,
  GovernanceCliGovernanceStatusAnswer,
  GovernanceCliIngestionTemplatesAnswer,
  GovernanceCliIngestionKeyAnswer,
  GovernanceCliIngestionKeysAnswer,
  GovernanceCliIngestionKeyStateAnswer,
  GovernanceCliKeyLookupRequest,
  GovernanceCliRawRequest,
  GovernanceCliRequest,
  GovernanceCliSourceEventsRequest,
  GovernanceCliSourceRequest,
  GovernanceCliSourcesRequest,
} from "./governance-cli-rest.schemas.ts";
import type {
  GovernanceIngestOtlpInput,
  GovernanceIngestResponse,
  GovernanceIngestWebhookInput,
} from "./governance-ingest-rest.schemas.ts";
import type { GovernanceActorWorkspace } from "./governance.responses.ts";
import type { GovernanceSetupState } from "./governance.ts";
import type {
  PersonalIngestionKeyListing,
  PersonalIngestionKeyMint,
  RotatedIngestionKey,
} from "./ingestion-key.trpc.ts";
import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./ingestion-pull.commands.ts";
import type {
  ActivityEventDetailRow,
  ActivityMonitorPagedWindowQuery,
  ActivityMonitorSummary,
  ActivityMonitorWindowQuery,
  IngestionSourceHealthRow,
  RecentAnomalyRow,
  SourceHealthMetrics,
  SpendByDepartmentRow,
  SpendByTeamRow,
  SpendByUserRow,
  SpendOverTimeGroupBy,
  SpendOverTimeResult,
} from "./ingestion-source-activity.queries.ts";
import type {
  IngestionKeyMintCommand,
  IssuedIngestionKey,
  PersonalIngestionKeyState,
} from "./ingestion-source-key.commands.ts";
import type {
  CreatedGovernanceIngestionSource,
  CreateGovernanceIngestionSourceCommand,
  GovernanceIngestionSource,
  UpdateGovernanceIngestionSourceCommand,
} from "./ingestion-source.commands.ts";
import type { IngestionSourceDto, OttlStarterTemplate } from "./ingestion-source.ts";
import type {
  IngestionSourceCreateInput,
  IngestionSourceUpdateInput,
} from "./ingestion-sources.trpc.ts";
import type {
  ArchiveIngestionTemplateInput,
  CloneIngestionTemplateInput,
  CreateIngestionTemplateInput,
  IngestionTemplate,
  PlatformIngestionTemplateSyncResult,
  UpdateIngestionTemplateOttlInput,
} from "./ingestion-template.ts";
import type { GovernanceOcsfExportInput, GovernanceOcsfExportPage } from "./ocsf-export.ts";
import type {
  GovernanceOtlpPolicyInput,
  GovernanceOtlpReceiverPolicies,
} from "./otlp-receiver-policy.ts";
import type { OttlTransformInput, OttlTransformResult, OttlValidationResult } from "./ottl.ts";
import type { PersonaResolution } from "./persona-home.ts";
import type {
  GovernanceBudgetOverviewForUser,
  GovernanceBudgetOverviewInput,
} from "./personal-budget-overview.ts";
import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageQueryInput,
  PersonalUsageSummary,
} from "./personal-usage.ts";
import type {
  EnsureDefaultPersonalVirtualKeyInput,
  IssuePersonalVirtualKeyInput,
  IssuedPersonalVirtualKey,
  IssuedPersonalVirtualKeyAnswer,
  ListPersonalVirtualKeysInput,
  PersonalVirtualKey,
  RevokeAllPersonalVirtualKeysInput,
  RevokePersonalVirtualKeyInput,
} from "./personal-virtual-key.ts";
import type {
  PlatformToolPolicy,
  PlatformToolPolicyMap,
  PlatformToolSlug,
} from "./platform-tool-policy.ts";
import type { RecordPulledUsageCommand } from "./pulled-usage.commands.ts";
import type { QuarantineFillInput, QuarantineFillStats } from "./quarantine-fill.ts";
import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  FindRoutingPolicyInput,
  ListRoutingPoliciesInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "./routing-policy.ts";

/**
 * The one public Governance capability, with deliberately explicit operation
 * names rather than a grab-bag of independently constructed services. Smaller
 * services stay private to the server package — never on App or request context.
 */
export interface GovernanceApi {
  anomalyRuleList(organizationId: string): Promise<AnomalyRule[]>;
  findAnomalyRuleById(input: { id: string; organizationId: string }): Promise<AnomalyRule | null>;
  anomalyRuleGetById(input: { id: string; organizationId: string }): Promise<AnomalyRule>;
  anomalyRuleCreate(input: CreateAnomalyRuleInput): Promise<AnomalyRule>;
  anomalyRuleUpdate(input: UpdateAnomalyRuleInput): Promise<AnomalyRule>;
  anomalyRuleArchive(input: { id: string; organizationId: string }): Promise<AnomalyRule>;

  departmentList(organizationId: string): Promise<Department[]>;
  departmentAssignments(organizationId: string): Promise<DepartmentAssignments>;
  departmentCreate(input: { organizationId: string; name: string }): Promise<Department>;
  departmentResolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  departmentRename(input: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Department>;
  departmentArchive(input: { id: string; organizationId: string }): Promise<void>;
  departmentAssignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void>;
  departmentAssignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void>;
  departmentAssignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void>;

  extractCanonicalCostEvents(request: OtlpLogsRequest): CanonicalCostEvent[];
  ingestionConfigure(input: ConfigureIngestionPullCommand): Promise<void>;
  ingestionDisable(input: DisableIngestionPullCommand): Promise<void>;
  ingestionRecordRunCompleted(input: RecordIngestionPullRunCompletedCommand): Promise<void>;
  ingestionRecordRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
  usageRecord(input: RecordPulledUsageCommand): Promise<void>;

  resolveOtlpReceiverPolicies(
    input: GovernanceOtlpPolicyInput,
  ): Promise<GovernanceOtlpReceiverPolicies>;

  resolveSourceNonBillable(input: { organizationId: string; sourceType: string }): Promise<boolean>;
  resolveTraceDepartment(input: TraceDepartmentInput): string;

  activitySummary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary>;
  activitySpendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]>;
  activitySpendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]>;
  activitySpendByDepartment(input: ActivityMonitorWindowQuery): Promise<SpendByDepartmentRow[]>;
  activitySpendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult>;
  activityRecentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]>;
  activityIngestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]>;
  activityEventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]>;
  activitySourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics>;

  ingestionKeyIssueForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;
  ingestionKeyIssueForPersonalProject(input: PersonalIngestionKeyMint): Promise<IssuedIngestionKey>;
  ingestionKeyListForPersonalProject(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKeyListing[]>;
  getPersonalIngestionKeyState(input: {
    userId: string;
    organizationId: string;
    lookupId: string;
  }): Promise<PersonalIngestionKeyState>;

  ingestionSourceList(organizationId: string): Promise<GovernanceIngestionSource[]>;
  findIngestionSourceById(input: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource | null>;
  ingestionSourceGetById(input: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource>;
  /**
   * Of the trace destinations these sources point at, the ones still live in
   * this organization — the admin surface needs the complement, since a
   * project outside the reader's own teams is absent without being archived.
   */
  ingestionSourceLiveTraceProjectIds(
    sources: readonly { traceProjectId?: string | null }[],
    organizationId: string,
  ): Promise<Set<string>>;
  findIngestionSourceByIngestSecret(rawSecret: string): Promise<GovernanceIngestionSource | null>;
  ingestionSourceCreate(
    input: CreateGovernanceIngestionSourceCommand,
  ): Promise<CreatedGovernanceIngestionSource>;
  ingestionSourceUpdate(
    input: UpdateGovernanceIngestionSourceCommand,
  ): Promise<GovernanceIngestionSource>;
  ingestionSourceRotateSecret(input: {
    id: string;
    organizationId: string;
  }): Promise<CreatedGovernanceIngestionSource>;
  ingestionSourceArchive(input: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource>;
  ingestionSourceRecordEventReceived(id: string): Promise<void>;

  templateListForUser(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  templateListForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  findTemplateByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null>;
  templateGetByIdForOrg(input: { id: string; organizationId: string }): Promise<IngestionTemplate>;
  templateCreateOrg(input: CreateIngestionTemplateInput): Promise<IngestionTemplate>;
  templateUpdateOttlRules(input: UpdateIngestionTemplateOttlInput): Promise<IngestionTemplate>;
  templateArchiveOrg(input: ArchiveIngestionTemplateInput): Promise<void>;
  templateCloneFromPlatform(input: CloneIngestionTemplateInput): Promise<IngestionTemplate>;
  templateSyncPlatformCatalog(): Promise<PlatformIngestionTemplateSyncResult>;

  ocsfList(input: GovernanceOcsfExportInput): Promise<GovernanceOcsfExportPage>;
  ottlValidate(statements: string[]): Promise<OttlValidationResult>;
  ottlTransform(input: OttlTransformInput): Promise<OttlTransformResult>;
  personalUsageSummary(input: PersonalUsageQueryInput): Promise<PersonalUsageSummary>;
  personalUsageDailyBuckets(input: PersonalUsageQueryInput): Promise<PersonalUsageBucket[]>;
  personalUsageBreakdownByModel(
    input: PersonalUsageQueryInput,
    limit?: number,
  ): Promise<PersonalUsageBreakdown[]>;
  personalBudgetOverviewForUser(
    input: GovernanceBudgetOverviewInput,
  ): Promise<GovernanceBudgetOverviewForUser>;
  routingPolicyList(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]>;
  findRoutingPolicyById(input: FindRoutingPolicyInput): Promise<RoutingPolicy | null>;
  routingPolicyGetById(input: FindRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicyCreate(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicyUpdate(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicySetDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicyDelete(input: DeleteRoutingPolicyInput): Promise<void>;

  personalVirtualKeyEnsureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey>;
  personalVirtualKeyIssue(input: IssuePersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey>;
  personalVirtualKeyList(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]>;
  personalVirtualKeyRevoke(input: RevokePersonalVirtualKeyInput): Promise<PersonalVirtualKey>;
  personalVirtualKeyRevokeAllForUser(input: RevokeAllPersonalVirtualKeysInput): Promise<number>;

  aiToolListForUser(input: AiToolMemberInput): Promise<AiToolEntry[]>;
  aiToolListForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]>;
  findAiToolById(input: FindAiToolEntryInput): Promise<AiToolEntry | null>;
  aiToolGetById(input: FindAiToolEntryInput): Promise<AiToolEntry>;
  aiToolCreate(input: CreateAiToolEntryInput): Promise<AiToolEntry>;
  aiToolUpdate(input: UpdateAiToolEntryInput): Promise<AiToolEntry>;
  aiToolRemove(input: FindAiToolEntryInput): Promise<AiToolEntry>;
  aiToolEnsureDefaultCatalog(
    input: AiToolOrganizationInput,
  ): Promise<{ hasSeeded: boolean; created: number }>;
  aiToolSeedStarterPack(
    input: SeedAiToolStarterPackInput,
  ): Promise<{ created: number; updated: number; skipped: number }>;
  aiToolListConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]>;
  aiToolListProviderOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<AiToolProviderOption[]>;
  aiToolListRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<{ id: string; name: string }[]>;
  aiToolReorder(input: ReorderAiToolEntriesInput): Promise<void>;
  aiToolResolvePolicyOverrides(
    input: AiToolMemberInput,
  ): Promise<Partial<Record<PlatformToolSlug, PlatformToolPolicy>>>;
  aiToolResolvePolicyMap(input: AiToolMemberInput): Promise<PlatformToolPolicyMap>;
  aiToolResolvePolicy(
    input: AiToolMemberInput & { slug: PlatformToolSlug },
  ): Promise<PlatformToolPolicy>;
  aiToolResolveCliCatalogForUser(input: AiToolMemberInput): Promise<AiToolCliCatalog>;

  cliBootstrapResolve: (input: CliBootstrapInput) => Promise<CliBootstrapResult>;
  cliSessionListForUser(input: CliUserInput): Promise<CliSession[]>;
  cliSessionRevoke(input: RevokeCliSessionInput): Promise<{ revokedTokens: number }>;
  cliTokenRevokeForUser(input: CliUserInput): Promise<{ revokedCount: number }>;
  adminWorkspaceRecordView(input: RecordWorkspaceViewInput): Promise<RecordWorkspaceViewResult>;
  quarantineFillEvaluate(input: QuarantineFillInput): Promise<QuarantineFillStats>;
  resolveSetupState(organizationId: string): Promise<GovernanceSetupState>;
}

export const GovernanceApi = moduleApi<GovernanceApi>()("governance");

/**
 * Who a project-scoped call is attributed to. `userId` is absent for a legacy
 * project API key, which is bound to a project rather than to a person.
 */
export interface GovernanceProjectCaller {
  readonly projectId: string;
  readonly userId?: string | null;
  /** Which surface initiated the change, for the audit row. */
  readonly surface: GovernanceCallSurface;
}

/** What a template a member may pick is created from. */
export interface GovernanceTemplateDraft {
  sourceType: string;
  displayName: string;
  description?: string | null;
  iconAsset?: string | null;
  credentialSchema?: string | null;
  ottlRules?: string;
}

/** Who a call is attributed to, and (for a lazy backfill) what to name them. */
export interface GovernanceCaller {
  readonly id: string;
  readonly displayName?: string | null;
  readonly displayEmail?: string | null;
}

/** The ingestion-template operations the governance REST family calls. */
export interface GovernanceRestApi {
  cliBudgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer>;
  cliBootstrapRead(input: GovernanceCliRequest): Promise<GovernanceCliBootstrapAnswer>;
  cliBudgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer>;
  cliPersonalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer>;
  cliVirtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer>;
  cliProjectKey(input: GovernanceCliRawRequest): Promise<GovernanceCliProjectKeyAnswer>;
  cliIngestionSources(
    input: GovernanceCliSourcesRequest,
  ): Promise<GovernanceCliIngestionSourcesAnswer>;
  cliIngestionSourceEvents(
    input: GovernanceCliSourceEventsRequest,
  ): Promise<GovernanceCliIngestionSourceEventsAnswer>;
  cliIngestionSourceHealth(
    input: GovernanceCliSourceRequest,
  ): Promise<GovernanceCliIngestionSourceHealthAnswer>;
  cliGovernanceStatus(input: GovernanceCliRequest): Promise<GovernanceCliGovernanceStatusAnswer>;
  cliIngestionTemplates(
    input: GovernanceCliRequest,
  ): Promise<GovernanceCliIngestionTemplatesAnswer>;
  cliIngestionKey(input: GovernanceCliRawRequest): Promise<GovernanceCliIngestionKeyAnswer>;
  cliIngestionKeys(input: GovernanceCliRequest): Promise<GovernanceCliIngestionKeysAnswer>;
  cliIngestionKeyState(
    input: GovernanceCliKeyLookupRequest,
  ): Promise<GovernanceCliIngestionKeyStateAnswer>;

  ingestOtlpTraces(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse>;
  ingestWebhook(input: GovernanceIngestWebhookInput): Promise<GovernanceIngestResponse>;
  ingestOtlpLogs(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse>;
  ingestOtlpMetrics(input: GovernanceIngestOtlpInput): Promise<GovernanceIngestResponse>;

  listIngestionTemplatesForMember(scope: { projectId: string }): Promise<IngestionTemplate[]>;
  listIngestionTemplatesForAdmin(scope: { projectId: string }): Promise<IngestionTemplate[]>;
  getIngestionTemplate(input: { projectId: string; id: string }): Promise<IngestionTemplate>;
  createIngestionTemplate(
    input: GovernanceTemplateDraft,
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate>;
  updateIngestionTemplateOttlRules(
    input: { id: string; ottlRules: string },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate>;
  archiveIngestionTemplate(input: { id: string }, by: GovernanceProjectCaller): Promise<void>;
  cloneIngestionTemplate(
    input: { sourceTemplateId: string },
    by: GovernanceProjectCaller,
  ): Promise<IngestionTemplate>;

  anomalyRuleList(
    input: { organizationId: string },
    by: EntitlementOperator,
  ): Promise<AnomalyRule[]>;
  anomalyRuleGetById(
    input: { id: string; organizationId: string },
    by: EntitlementOperator,
  ): Promise<AnomalyRule>;
  anomalyRuleCreate(input: CreateAnomalyRuleInput, by: EntitlementOperator): Promise<AnomalyRule>;
  anomalyRuleUpdate(input: UpdateAnomalyRuleInput, by: EntitlementOperator): Promise<AnomalyRule>;
  anomalyRuleArchive(
    input: { id: string; organizationId: string },
    by: EntitlementOperator,
  ): Promise<AnomalyRule>;
  templateListForUser(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  templateListForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  templateGetByIdForOrg(input: { id: string; organizationId: string }): Promise<IngestionTemplate>;
  templateCreateOrg(input: CreateIngestionTemplateInput): Promise<IngestionTemplate>;
  templateUpdateOttlRules(input: UpdateIngestionTemplateOttlInput): Promise<IngestionTemplate>;
  templateArchiveOrg(input: ArchiveIngestionTemplateInput): Promise<void>;
  templateCloneFromPlatform(input: CloneIngestionTemplateInput): Promise<IngestionTemplate>;
  listRoutingPolicies(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]>;
  getRoutingPolicy(input: FindRoutingPolicyInput): Promise<RoutingPolicy>;
  createRoutingPolicy(
    input: Omit<CreateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy>;
  updateRoutingPolicy(
    input: Omit<UpdateRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy>;
  setDefaultRoutingPolicy(
    input: Omit<SetDefaultRoutingPolicyInput, "actorUserId">,
    by: GovernanceCaller,
  ): Promise<RoutingPolicy>;
  deleteRoutingPolicy(input: DeleteRoutingPolicyInput): Promise<void>;
  listPersonalVirtualKeys(
    input: { organizationId: string; targetUserId?: string },
    by: GovernanceCaller,
  ): Promise<PersonalVirtualKey[]>;
  issuePersonalVirtualKey(
    input: { organizationId: string; label: string; routingPolicyId?: string },
    by: GovernanceCaller,
  ): Promise<IssuedPersonalVirtualKeyAnswer>;
  revokePersonalVirtualKey(
    input: { organizationId: string; id: string },
    by: GovernanceCaller,
  ): Promise<void>;
  ingestionKeyList(input: {
    organizationId: string;
    userId: string;
  }): Promise<PersonalIngestionKeyListing[]>;
  ingestionKeyInstall(input: PersonalIngestionKeyMint): Promise<IssuedIngestionKey>;
  ingestionKeyRotate(input: PersonalIngestionKeyMint): Promise<RotatedIngestionKey>;
  ingestionKeyRevoke(input: {
    organizationId: string;
    userId: string;
    apiKeyId: string;
  }): Promise<void>;
  cliSessionListForUser(input: CliUserInput): Promise<CliSessionCard[]>;
  cliSessionRevoke(input: RevokeCliSessionInput): Promise<CliSessionRevocation>;
  cliSessionRevokeAll(input: CliUserInput): Promise<CliSessionRevocation>;
  ingestionSourceList(input: { organizationId: string }): Promise<IngestionSourceDto[]>;
  ingestionSourceGet(input: { id: string; organizationId: string }): Promise<IngestionSourceDto>;
  ingestionSourceCreate(
    input: IngestionSourceCreateInput & { actorUserId: string },
  ): Promise<{ source: IngestionSourceDto; ingestSecret: string | null }>;
  ingestionSourceUpdate(input: IngestionSourceUpdateInput): Promise<IngestionSourceDto>;
  ingestionSourceRotateSecret(input: {
    id: string;
    organizationId: string;
  }): Promise<{ source: IngestionSourceDto; ingestSecret: string }>;
  ingestionSourceArchive(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionSourceDto>;
  ingestionSourceValidateOttl(input: { statements: string[] }): Promise<OttlValidationResult>;
  ingestionSourceOttlStarter(input: { sourceType: string }): OttlStarterTemplate;
  governanceSetupState(input: { organizationId: string }): Promise<GovernanceSetupState>;
  governanceResolveHome(
    input: { organizationId: string },
    by: { id: string },
  ): Promise<PersonaResolution>;
  governanceOcsfExport(
    input: GovernanceOcsfExportInput,
    by: EntitlementOperator,
  ): Promise<GovernanceOcsfExportPage>;
  governanceQuarantineFillStats(input: QuarantineFillInput): Promise<QuarantineFillStats>;
  governanceRecordWorkspaceView(
    input: RecordWorkspaceViewInput,
  ): Promise<RecordWorkspaceViewResult>;
  findActorWorkspace(input: {
    organizationId: string;
    actor: string;
  }): Promise<GovernanceActorWorkspace | null>;
  departmentList(input: { organizationId: string }): Promise<Department[]>;
  departmentAssignments(input: { organizationId: string }): Promise<DepartmentAssignments>;
  departmentCreate(input: { organizationId: string; name: string }): Promise<Department>;
  departmentRename(input: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Department>;
  departmentArchive(input: { id: string; organizationId: string }): Promise<void>;
  departmentResolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  departmentAssignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void>;
  departmentAssignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void>;
  departmentAssignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void>;
}

export const GovernanceRestApi = moduleApi<GovernanceRestApi>()("governance");
