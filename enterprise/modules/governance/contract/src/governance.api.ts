import { moduleApi } from "@langwatch/runtime-composition";
import type {
  GovernanceOtlpPolicyInput,
  GovernanceOtlpReceiverPolicies,
} from "./otlp-receiver-policy.ts";
import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./ingestion-pull.commands.ts";
import type { RecordPulledUsageCommand } from "./pulled-usage.commands.ts";
import type { TraceDepartmentInput } from "./department.ts";
import type {
  AnomalyRule,
  CreateAnomalyRuleInput,
  UpdateAnomalyRuleInput,
} from "./anomaly-rule.ts";
import type { Department, DepartmentAssignments } from "./department.ts";
import type { CanonicalCostEvent, OtlpLogsRequest } from "./canonical-cost.ts";
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
  PersonalIngestionKey,
  PersonalIngestionKeyState,
} from "./ingestion-source-key.commands.ts";
import type {
  CreatedGovernanceIngestionSource,
  CreateGovernanceIngestionSourceCommand,
  GovernanceIngestionSource,
  UpdateGovernanceIngestionSourceCommand,
} from "./ingestion-source.commands.ts";
import type {
  ArchiveIngestionTemplateInput,
  CloneIngestionTemplateInput,
  CreateIngestionTemplateInput,
  IngestionTemplate,
  PlatformIngestionTemplateSyncResult,
  UpdateIngestionTemplateOttlInput,
} from "./ingestion-template.ts";
import type { GovernanceOcsfExportInput, GovernanceOcsfExportPage } from "./ocsf-export.ts";
import type { OttlTransformInput, OttlTransformResult, OttlValidationResult } from "./ottl.ts";
import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageQueryInput,
  PersonalUsageSummary,
} from "./personal-usage.ts";
import type {
  GovernanceBudgetOverviewForUser,
  GovernanceBudgetOverviewInput,
} from "./personal-budget-overview.ts";
import type {
  EnsureDefaultPersonalVirtualKeyInput,
  IssuePersonalVirtualKeyInput,
  IssuedPersonalVirtualKey,
  ListPersonalVirtualKeysInput,
  PersonalVirtualKey,
  RevokeAllPersonalVirtualKeysInput,
  RevokePersonalVirtualKeyInput,
} from "./personal-virtual-key.ts";
import type { QuarantineFillInput, QuarantineFillStats } from "./quarantine-fill.ts";
import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  FindRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "./routing-policy.ts";
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
  RecordWorkspaceViewInput,
  RecordWorkspaceViewResult,
} from "./admin-workspace-view-audit.ts";
import type { CliBootstrapInput, CliBootstrapResult } from "./cli-bootstrap.ts";
import type { CliSession, CliUserInput, RevokeCliSessionInput } from "./cli-sessions.ts";
import type { GovernanceSetupState } from "./governance.ts";
import type {
  PlatformToolPolicy,
  PlatformToolPolicyMap,
  PlatformToolSlug,
} from "./platform-tool-policy.ts";

/**
 * The one public Governance capability. The deliberately explicit operation
 * names keep transport code from receiving a grab-bag of independently
 * constructed services, while retaining the existing domain vocabulary.
 *
 * Smaller implementation services are private to the server package and must
 * not be placed on App or request context.
 */
export interface GovernanceApi {
  anomalyRuleList(organizationId: string): Promise<AnomalyRule[]>;
  tryFindAnomalyRuleById(input: { id: string; organizationId: string }): Promise<AnomalyRule | null>;
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
  departmentRename(input: { id: string; organizationId: string; name: string }): Promise<Department>;
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

  resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;
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

  ingestionKeyEnsureForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;
  ingestionKeyIssueForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;
  ingestionKeyEnsureForPersonalProject(input: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey>;
  ingestionKeyIssueForPersonalProject(input: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey>;
  ingestionKeyListForPersonalProject(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKey[]>;
  tryDescribePersonalIngestionKey(input: {
    userId: string;
    organizationId: string;
    lookupId: string;
  }): Promise<PersonalIngestionKeyState | null>;

  ingestionSourceList(organizationId: string): Promise<GovernanceIngestionSource[]>;
  tryFindIngestionSourceById(input: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource | null>;
  ingestionSourceGetById(input: {
    id: string;
    organizationId: string;
  }): Promise<GovernanceIngestionSource>;
  /**
   * Of the trace destinations these sources point at, the ones still live in
   * this organization. The admin surfaces need the complement — a destination
   * that is absent has stopped routing — and cannot derive it from the project
   * list they already hold, because a project outside the reader's own teams
   * is equally absent and is not archived at all.
   */
  ingestionSourceLiveTraceProjectIds(
    sources: ReadonlyArray<{ traceProjectId?: string | null }>,
    organizationId: string,
  ): Promise<Set<string>>;
  tryFindIngestionSourceByIngestSecret(rawSecret: string): Promise<GovernanceIngestionSource | null>;
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
  tryFindTemplateByIdForOrg(input: {
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
  tryFindRoutingPolicyById(input: FindRoutingPolicyInput): Promise<RoutingPolicy | null>;
  routingPolicyGetById(input: FindRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicyCreate(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicyUpdate(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicySetDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
  routingPolicyDelete(input: DeleteRoutingPolicyInput): Promise<void>;
  tryResolveDefaultRoutingPolicyForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null>;

  personalVirtualKeyEnsureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey>;
  personalVirtualKeyIssue(input: IssuePersonalVirtualKeyInput): Promise<IssuedPersonalVirtualKey>;
  personalVirtualKeyList(input: ListPersonalVirtualKeysInput): Promise<PersonalVirtualKey[]>;
  personalVirtualKeyRevoke(input: RevokePersonalVirtualKeyInput): Promise<PersonalVirtualKey>;
  personalVirtualKeyRevokeAllForUser(input: RevokeAllPersonalVirtualKeysInput): Promise<number>;

  aiToolListForUser(input: AiToolMemberInput): Promise<AiToolEntry[]>;
  aiToolListForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]>;
  tryFindAiToolById(input: FindAiToolEntryInput): Promise<AiToolEntry | null>;
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
  aiToolListProviderOptionsForAdmin(input: AiToolOrganizationInput): Promise<AiToolProviderOption[]>;
  aiToolListRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<Array<{ id: string; name: string }>>;
  aiToolReorder(input: ReorderAiToolEntriesInput): Promise<void>;
  aiToolResolvePolicyOverrides(
    input: AiToolMemberInput,
  ): Promise<Partial<Record<PlatformToolSlug, PlatformToolPolicy>>>;
  aiToolResolvePolicyMap(input: AiToolMemberInput): Promise<PlatformToolPolicyMap>;
  aiToolResolvePolicy(
    input: AiToolMemberInput & { slug: PlatformToolSlug },
  ): Promise<PlatformToolPolicy>;
  aiToolResolveCliCatalogForUser(input: AiToolMemberInput): Promise<AiToolCliCatalog>;

  cliBootstrapResolve(input: CliBootstrapInput): Promise<CliBootstrapResult>;
  cliSessionListForUser(input: CliUserInput): Promise<CliSession[]>;
  cliSessionRevoke(input: RevokeCliSessionInput): Promise<{ revokedTokens: number }>;
  cliTokenRevokeForUser(input: CliUserInput): Promise<{ revokedCount: number }>;
  adminWorkspaceRecordView(input: RecordWorkspaceViewInput): Promise<RecordWorkspaceViewResult>;
  quarantineFillEvaluate(input: QuarantineFillInput): Promise<QuarantineFillStats>;
  resolveSetupState(organizationId: string): Promise<GovernanceSetupState>;
}

export const GovernanceApi = moduleApi<GovernanceApi>("governance");
