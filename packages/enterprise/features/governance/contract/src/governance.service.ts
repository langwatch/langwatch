import type {
  ConfigureIngestionPullCommand,
  DisableIngestionPullCommand,
  RecordIngestionPullRunCompletedCommand,
  RecordIngestionPullRunFailedCommand,
} from "./ingestion-pull.commands";
import type { RecordPulledUsageCommand } from "./pulled-usage.commands";
import type { TraceDepartmentInput } from "./department";
import type { AnomalyRule, CreateAnomalyRuleInput, UpdateAnomalyRuleInput } from "./anomaly-rule";
import type { Department, DepartmentAssignments } from "./department";
import type { CanonicalCostEvent, OtlpLogsRequest } from "./canonical-cost";
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
} from "./ingestion-source-activity.queries";
import type {
  IngestionKeyMintCommand,
  IssuedIngestionKey,
  PersonalIngestionKey,
} from "./ingestion-source-key.commands";
import type {
  CreatedGovernanceIngestionSource,
  CreateGovernanceIngestionSourceCommand,
  GovernanceIngestionSource,
  UpdateGovernanceIngestionSourceCommand,
} from "./ingestion-source.commands";
import type {
  ArchiveIngestionTemplateInput,
  CloneIngestionTemplateInput,
  CreateIngestionTemplateInput,
  IngestionTemplate,
  PlatformIngestionTemplateSyncResult,
  UpdateIngestionTemplateOttlInput,
} from "./ingestion-template";
import type { GovernanceOcsfExportInput, GovernanceOcsfExportPage } from "./ocsf-export";
import type { OttlTransformInput, OttlTransformResult, OttlValidationResult } from "./ottl";
import type {
  PersonalUsageBreakdown,
  PersonalUsageBucket,
  PersonalUsageQueryInput,
  PersonalUsageSummary,
} from "./personal-usage";
import type {
  GovernanceBudgetOverviewForUser,
  GovernanceBudgetOverviewInput,
} from "./personal-budget-overview";
import type {
  EnsureDefaultPersonalVirtualKeyInput,
  IssuePersonalVirtualKeyInput,
  IssuedPersonalVirtualKey,
  ListPersonalVirtualKeysInput,
  PersonalVirtualKey,
  RevokeAllPersonalVirtualKeysInput,
  RevokePersonalVirtualKeyInput,
} from "./personal-virtual-key";
import type { QuarantineFillInput, QuarantineFillStats } from "./quarantine-fill";
import type {
  CreateRoutingPolicyInput,
  DeleteRoutingPolicyInput,
  FindRoutingPolicyInput,
  ListRoutingPoliciesInput,
  ResolveDefaultRoutingPolicyInput,
  RoutingPolicy,
  SetDefaultRoutingPolicyInput,
  UpdateRoutingPolicyInput,
} from "./routing-policy";
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
} from "./ai-tool-catalog";
import type {
  RecordWorkspaceViewInput,
  RecordWorkspaceViewResult,
} from "./admin-workspace-view-audit";
import type { CliBootstrapInput, CliBootstrapResult } from "./cli-bootstrap";
import type { CliSession, CliUserInput, RevokeCliSessionInput } from "./cli-sessions";
import type { GovernanceSetupState } from "./governance";
import type {
  PlatformToolPolicy,
  PlatformToolPolicyMap,
  PlatformToolSlug,
} from "./platform-tool-policy";

/**
 * The one public Governance capability.  The deliberately explicit operation
 * names keep transport code from receiving a grab-bag of independently
 * constructed services, while retaining the existing domain vocabulary.
 *
 * Smaller implementation services are private to the server package and must
 * not be placed on App or request context.
 */
export abstract class GovernanceService {
  abstract anomalyRuleList(organizationId: string): Promise<AnomalyRule[]>;
  abstract tryFindAnomalyRuleById(id: string, organizationId: string): Promise<AnomalyRule | null>;
  abstract anomalyRuleGetById(id: string, organizationId: string): Promise<AnomalyRule>;
  abstract anomalyRuleCreate(input: CreateAnomalyRuleInput): Promise<AnomalyRule>;
  abstract anomalyRuleUpdate(input: UpdateAnomalyRuleInput): Promise<AnomalyRule>;
  abstract anomalyRuleArchive(id: string, organizationId: string): Promise<AnomalyRule>;

  abstract departmentList(organizationId: string): Promise<Department[]>;
  abstract departmentAssignments(organizationId: string): Promise<DepartmentAssignments>;
  abstract departmentCreate(input: { organizationId: string; name: string }): Promise<Department>;
  abstract departmentResolveByNameOrCreate(input: {
    organizationId: string;
    name: string;
  }): Promise<Department>;
  abstract departmentRename(input: {
    id: string;
    organizationId: string;
    name: string;
  }): Promise<Department>;
  abstract departmentArchive(input: { id: string; organizationId: string }): Promise<void>;
  abstract departmentAssignUser(input: {
    organizationId: string;
    userId: string;
    departmentId: string | null;
  }): Promise<void>;
  abstract departmentAssignTeam(input: {
    organizationId: string;
    teamId: string;
    departmentId: string | null;
  }): Promise<void>;
  abstract departmentAssignProject(input: {
    organizationId: string;
    projectId: string;
    departmentId: string | null;
  }): Promise<void>;

  abstract extractCanonicalCostEvents(request: OtlpLogsRequest): CanonicalCostEvent[];
  abstract ingestionConfigure(input: ConfigureIngestionPullCommand): Promise<void>;
  abstract ingestionDisable(input: DisableIngestionPullCommand): Promise<void>;
  abstract ingestionRecordRunCompleted(
    input: RecordIngestionPullRunCompletedCommand,
  ): Promise<void>;
  abstract ingestionRecordRunFailed(input: RecordIngestionPullRunFailedCommand): Promise<void>;
  abstract usageRecord(input: RecordPulledUsageCommand): Promise<void>;

  abstract resolveSourceNonBillable(input: {
    organizationId: string;
    sourceType: string;
  }): Promise<boolean>;
  abstract resolveTraceDepartment(input: TraceDepartmentInput): string;

  abstract activitySummary(input: ActivityMonitorWindowQuery): Promise<ActivityMonitorSummary>;
  abstract activitySpendByUser(input: ActivityMonitorPagedWindowQuery): Promise<SpendByUserRow[]>;
  abstract activitySpendByTeam(input: ActivityMonitorPagedWindowQuery): Promise<SpendByTeamRow[]>;
  abstract activitySpendByDepartment(
    input: ActivityMonitorWindowQuery,
  ): Promise<SpendByDepartmentRow[]>;
  abstract activitySpendOverTime(input: {
    organizationId: string;
    windowDays: number;
    groupBy: SpendOverTimeGroupBy;
  }): Promise<SpendOverTimeResult>;
  abstract activityRecentAnomalies(input: {
    organizationId: string;
    limit?: number;
  }): Promise<RecentAnomalyRow[]>;
  abstract activityIngestionSourcesHealth(input: {
    organizationId: string;
  }): Promise<IngestionSourceHealthRow[]>;
  abstract activityEventsForSource(input: {
    organizationId: string;
    sourceId: string;
    limit?: number;
    beforeIso?: string;
  }): Promise<ActivityEventDetailRow[]>;
  abstract activitySourceHealthMetrics(input: {
    organizationId: string;
    sourceId: string;
  }): Promise<SourceHealthMetrics>;

  abstract ingestionKeyEnsureForProject(
    input: IngestionKeyMintCommand,
  ): Promise<IssuedIngestionKey>;
  abstract ingestionKeyIssueForProject(input: IngestionKeyMintCommand): Promise<IssuedIngestionKey>;
  abstract ingestionKeyEnsureForPersonalProject(input: {
    userId: string;
    organizationId: string;
    sourceType: string;
    ingestionTemplateId?: string | null;
    createdByDeviceLabel?: string | null;
  }): Promise<IssuedIngestionKey>;
  abstract ingestionKeyListForPersonalProject(input: {
    userId: string;
    organizationId: string;
  }): Promise<PersonalIngestionKey[]>;

  abstract ingestionSourceList(organizationId: string): Promise<GovernanceIngestionSource[]>;
  abstract tryFindIngestionSourceById(
    id: string,
    organizationId: string,
  ): Promise<GovernanceIngestionSource | null>;
  abstract ingestionSourceGetById(
    id: string,
    organizationId: string,
  ): Promise<GovernanceIngestionSource>;
  /**
   * Of the trace destinations these sources point at, the ones still live in
   * this organization. The admin surfaces need the complement — a destination
   * that is absent has stopped routing — and cannot derive it from the project
   * list they already hold, because a project outside the reader's own teams
   * is equally absent and is not archived at all.
   */
  abstract ingestionSourceLiveTraceProjectIds(
    sources: ReadonlyArray<{ traceProjectId?: string | null }>,
    organizationId: string,
  ): Promise<Set<string>>;
  abstract tryFindIngestionSourceByIngestSecret(
    rawSecret: string,
  ): Promise<GovernanceIngestionSource | null>;
  abstract ingestionSourceCreate(
    input: CreateGovernanceIngestionSourceCommand,
  ): Promise<CreatedGovernanceIngestionSource>;
  abstract ingestionSourceUpdate(
    input: UpdateGovernanceIngestionSourceCommand,
  ): Promise<GovernanceIngestionSource>;
  abstract ingestionSourceRotateSecret(
    id: string,
    organizationId: string,
  ): Promise<CreatedGovernanceIngestionSource>;
  abstract ingestionSourceArchive(
    id: string,
    organizationId: string,
  ): Promise<GovernanceIngestionSource>;
  abstract ingestionSourceRecordEventReceived(id: string): Promise<void>;

  abstract templateListForUser(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  abstract templateListForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  abstract tryFindTemplateByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate | null>;
  abstract templateGetByIdForOrg(input: {
    id: string;
    organizationId: string;
  }): Promise<IngestionTemplate>;
  abstract templateCreateOrg(input: CreateIngestionTemplateInput): Promise<IngestionTemplate>;
  abstract templateUpdateOttlRules(
    input: UpdateIngestionTemplateOttlInput,
  ): Promise<IngestionTemplate>;
  abstract templateArchiveOrg(input: ArchiveIngestionTemplateInput): Promise<void>;
  abstract templateCloneFromPlatform(
    input: CloneIngestionTemplateInput,
  ): Promise<IngestionTemplate>;
  abstract templateSyncPlatformCatalog(): Promise<PlatformIngestionTemplateSyncResult>;

  abstract ocsfList(input: GovernanceOcsfExportInput): Promise<GovernanceOcsfExportPage>;
  abstract ottlValidate(statements: string[]): Promise<OttlValidationResult>;
  abstract ottlTransform(input: OttlTransformInput): Promise<OttlTransformResult>;
  abstract personalUsageSummary(input: PersonalUsageQueryInput): Promise<PersonalUsageSummary>;
  abstract personalUsageDailyBuckets(
    input: PersonalUsageQueryInput,
  ): Promise<PersonalUsageBucket[]>;
  abstract personalUsageBreakdownByModel(
    input: PersonalUsageQueryInput,
    limit?: number,
  ): Promise<PersonalUsageBreakdown[]>;
  abstract personalBudgetOverviewForUser(
    input: GovernanceBudgetOverviewInput,
  ): Promise<GovernanceBudgetOverviewForUser>;
  abstract routingPolicyList(input: ListRoutingPoliciesInput): Promise<RoutingPolicy[]>;
  abstract tryFindRoutingPolicyById(input: FindRoutingPolicyInput): Promise<RoutingPolicy | null>;
  abstract routingPolicyGetById(input: FindRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract routingPolicyCreate(input: CreateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract routingPolicyUpdate(input: UpdateRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract routingPolicySetDefault(input: SetDefaultRoutingPolicyInput): Promise<RoutingPolicy>;
  abstract routingPolicyDelete(input: DeleteRoutingPolicyInput): Promise<void>;
  abstract tryResolveDefaultRoutingPolicyForUser(
    input: ResolveDefaultRoutingPolicyInput,
  ): Promise<RoutingPolicy | null>;

  abstract personalVirtualKeyEnsureDefault(
    input: EnsureDefaultPersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey>;
  abstract personalVirtualKeyIssue(
    input: IssuePersonalVirtualKeyInput,
  ): Promise<IssuedPersonalVirtualKey>;
  abstract personalVirtualKeyList(
    input: ListPersonalVirtualKeysInput,
  ): Promise<PersonalVirtualKey[]>;
  abstract personalVirtualKeyRevoke(
    input: RevokePersonalVirtualKeyInput,
  ): Promise<PersonalVirtualKey>;
  abstract personalVirtualKeyRevokeAllForUser(
    input: RevokeAllPersonalVirtualKeysInput,
  ): Promise<number>;

  abstract aiToolListForUser(input: AiToolMemberInput): Promise<AiToolEntry[]>;
  abstract aiToolListForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]>;
  abstract tryFindAiToolById(input: FindAiToolEntryInput): Promise<AiToolEntry | null>;
  abstract aiToolGetById(input: FindAiToolEntryInput): Promise<AiToolEntry>;
  abstract aiToolCreate(input: CreateAiToolEntryInput): Promise<AiToolEntry>;
  abstract aiToolUpdate(input: UpdateAiToolEntryInput): Promise<AiToolEntry>;
  abstract aiToolRemove(input: FindAiToolEntryInput): Promise<AiToolEntry>;
  abstract aiToolEnsureDefaultCatalog(
    input: AiToolOrganizationInput,
  ): Promise<{ hasSeeded: boolean; created: number }>;
  abstract aiToolSeedStarterPack(
    input: SeedAiToolStarterPackInput,
  ): Promise<{ created: number; updated: number; skipped: number }>;
  abstract aiToolListConfiguredProvidersForUser(input: AiToolMemberInput): Promise<string[]>;
  abstract aiToolListProviderOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<AiToolProviderOption[]>;
  abstract aiToolListRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<Array<{ id: string; name: string }>>;
  abstract aiToolReorder(input: ReorderAiToolEntriesInput): Promise<void>;
  abstract aiToolResolvePolicyOverrides(
    input: AiToolMemberInput,
  ): Promise<Partial<Record<PlatformToolSlug, PlatformToolPolicy>>>;
  abstract aiToolResolvePolicyMap(input: AiToolMemberInput): Promise<PlatformToolPolicyMap>;
  abstract aiToolResolvePolicy(
    input: AiToolMemberInput & { slug: PlatformToolSlug },
  ): Promise<PlatformToolPolicy>;
  abstract aiToolResolveCliCatalogForUser(input: AiToolMemberInput): Promise<AiToolCliCatalog>;

  abstract cliBootstrapResolve(input: CliBootstrapInput): Promise<CliBootstrapResult>;
  abstract cliSessionListForUser(input: CliUserInput): Promise<CliSession[]>;
  abstract cliSessionRevoke(input: RevokeCliSessionInput): Promise<{ revokedTokens: number }>;
  abstract cliTokenRevokeForUser(input: CliUserInput): Promise<{ revokedCount: number }>;
  abstract adminWorkspaceRecordView(
    input: RecordWorkspaceViewInput,
  ): Promise<RecordWorkspaceViewResult>;
  abstract quarantineFillEvaluate(input: QuarantineFillInput): Promise<QuarantineFillStats>;
  abstract resolveSetupState(organizationId: string): Promise<GovernanceSetupState>;
}
