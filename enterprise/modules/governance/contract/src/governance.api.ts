import type { BrowserSessionInventoryEntry } from "@langwatch/auth-contract";
import type { EntitlementOperator } from "@langwatch/entitlement-contract";
import { moduleApi } from "@langwatch/module";

import type {
  RecordWorkspaceViewInput,
  RecordWorkspaceViewResult,
} from "./admin-workspace-view-audit.ts";
import type {
  AiToolEntry,
  AiToolMemberInput,
  AiToolOrganizationInput,
  AiToolProviderOption,
  AiToolStarterTileChoice,
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
import type { CliBootstrapResult } from "./cli-bootstrap.ts";
import type {
  CliSessionCard,
  CliSessionRevocation,
  CliUserInput,
  RevokeCliSessionInput,
} from "./cli-sessions.ts";
import type { Department, DepartmentAssignments } from "./department.ts";
import type {
  AgentListingRequestResult,
  AgentSyncSourceListing,
  GovernanceAgentRow,
} from "./governance-agents.ts";
import type { GovernanceCallSurface } from "./governance-audit.ts";
import type {
  GovernanceCliBudgetStatusAnswer,
  GovernanceCliBootstrapAnswer,
  GovernanceCliBudgetOverviewAnswer,
  GovernanceCliPersonalProjectAnswer,
  GovernanceCliVirtualKeyAnswer,
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
  GovernanceCostDayRecords,
  GovernanceCostModelBreakdown,
  GovernanceCostPeriodRecordsInput,
  GovernanceCostProviderDayBreakdown,
  GovernanceCostSummary,
  GovernanceCostWindowInput,
  GovernanceSpenderBreakdown,
} from "./governance-cost.ts";
import type {
  GovernanceIngestOtlpInput,
  GovernanceIngestResponse,
  GovernanceIngestWebhookInput,
} from "./governance-ingest-rest.schemas.ts";
import type {
  IdentityMatchConfirmed,
  IdentityMatchRun,
  PeopleScreenPerson,
  PeopleScreenSuggestion,
} from "./governance-people.ts";
import type { GovernanceActorWorkspace } from "./governance.responses.ts";
import type { GovernanceSetupState } from "./governance.ts";
import type {
  PersonalIngestionKeyListing,
  PersonalIngestionKeyMint,
  RotatedIngestionKey,
} from "./ingestion-key.trpc.ts";
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
import type { IssuedIngestionKey } from "./ingestion-source-key.commands.ts";
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
  UpdateIngestionTemplateOttlInput,
} from "./ingestion-template.ts";
import type { GovernanceOcsfExportInput, GovernanceOcsfExportPage } from "./ocsf-export.ts";
import type { OttlValidationResult } from "./ottl.ts";
import type { PersonaResolution } from "./persona-home.ts";
import type { GovernanceBudgetOverviewForUser } from "./personal-budget-overview.ts";
import type {
  PersonalUsageQueryInput,
  PersonalUsageRollup,
  PersonalUsageWindow,
} from "./personal-usage.ts";
import type { QuarantineFillInput, QuarantineFillStats } from "./quarantine-fill.ts";
import type { OrganizationSessionPolicyShape, SessionCeilingApplied } from "./session-policy.ts";

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
export type GovernanceTemplateDraft = Pick<
  CreateIngestionTemplateInput,
  "sourceType" | "displayName" | "description" | "iconAsset" | "credentialSchema" | "ottlRules"
>;

/** Who a call is attributed to, and (for a lazy backfill) what to name them. */
export interface GovernanceCaller {
  readonly id: string;
  readonly displayName?: string | null;
  readonly displayEmail?: string | null;
}

/** A hosted MCP session's server, as the governance tools register on it. */
export type GovernanceMcpToolServer = {
  tool(name: string, description: string, inputSchema: unknown, callback: unknown): unknown;
};

/** One hosted MCP session the governance tools install on. */
export type GovernanceMcpSessionTools = {
  server: GovernanceMcpToolServer;
  /** The project the session's credential is capped at; its organization scopes the tools. */
  projectId: string;
  /** Captured at /api/mcp/authorize; absent for project-apiKey-only sessions. */
  callerUserId: string | undefined;
};

/** The ingestion-template operations the governance REST family calls. */
export interface GovernanceRestApi {
  /** Installs the governance MCP tools on one hosted MCP session (Alex, 2026-09-27). */
  registerMcpTools(input: GovernanceMcpSessionTools): void;
  cliBudgetStatus(input: GovernanceCliRequest): Promise<GovernanceCliBudgetStatusAnswer>;
  cliBootstrapRead(input: GovernanceCliRequest): Promise<GovernanceCliBootstrapAnswer>;
  cliBudgetOverview(input: GovernanceCliRequest): Promise<GovernanceCliBudgetOverviewAnswer>;
  cliPersonalProject(input: GovernanceCliRequest): Promise<GovernanceCliPersonalProjectAnswer>;
  cliVirtualKey(input: GovernanceCliRawRequest): Promise<GovernanceCliVirtualKeyAnswer>;
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
  isSourceBilled(input: { organizationId: string; sourceType: string }): Promise<boolean>;

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

  activitySummary(
    input: ActivityMonitorWindowQuery,
    by: EntitlementOperator,
  ): Promise<ActivityMonitorSummary>;
  activitySpendByUser(
    input: ActivityMonitorPagedWindowQuery,
    by: EntitlementOperator,
  ): Promise<SpendByUserRow[]>;
  activitySpendByTeam(
    input: ActivityMonitorPagedWindowQuery,
    by: EntitlementOperator,
  ): Promise<SpendByTeamRow[]>;
  activitySpendByDepartment(
    input: ActivityMonitorWindowQuery,
    by: EntitlementOperator,
  ): Promise<SpendByDepartmentRow[]>;
  activitySpendOverTime(
    input: ActivityMonitorWindowQuery & { groupBy: SpendOverTimeGroupBy },
    by: EntitlementOperator,
  ): Promise<SpendOverTimeResult>;
  activityRecentAnomalies(
    input: { organizationId: string; limit: number },
    by: EntitlementOperator,
  ): Promise<RecentAnomalyRow[]>;
  activityIngestionSourcesHealth(
    input: { organizationId: string },
    by: EntitlementOperator,
  ): Promise<IngestionSourceHealthRow[]>;
  activityEventsForSource(
    input: { organizationId: string; sourceId: string; limit: number; beforeIso?: string },
    by: EntitlementOperator,
  ): Promise<ActivityEventDetailRow[]>;
  activitySourceHealthMetrics(
    input: { organizationId: string; sourceId: string },
    by: EntitlementOperator,
  ): Promise<SourceHealthMetrics>;
  aiToolListForUser(input: AiToolMemberInput): Promise<AiToolEntry[]>;
  aiToolProviderAvailability(input: AiToolMemberInput): Promise<{ configuredProviders: string[] }>;
  aiToolClaudeCodeOtlpEndpoint(
    input: AiToolOrganizationInput,
  ): Promise<{ endpoint: string | null }>;
  aiToolListForAdmin(input: AiToolOrganizationInput): Promise<AiToolEntry[]>;
  aiToolGetById(input: FindAiToolEntryInput): Promise<AiToolEntry>;
  aiToolCreate(input: CreateAiToolEntryInput): Promise<AiToolEntry>;
  aiToolUpdate(input: UpdateAiToolEntryInput): Promise<AiToolEntry>;
  aiToolRemove(input: FindAiToolEntryInput): Promise<AiToolEntry>;
  aiToolSeedStarterPack(
    input: SeedAiToolStarterPackInput,
  ): Promise<{ created: number; updated: number; skipped: number }>;
  /** Main's `ensureDefaultCatalog`: the starter set, only for an organization with no entries. */
  aiToolEnsureDefaultCatalog(
    input: AiToolOrganizationInput,
  ): Promise<{ hasSeeded: boolean; created: number }>;
  aiToolStarterPackCatalog(): AiToolStarterTileChoice[];
  aiToolListProviderOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<AiToolProviderOption[]>;
  aiToolListRoutingPolicyOptionsForAdmin(
    input: AiToolOrganizationInput,
  ): Promise<{ id: string; name: string }[]>;
  aiToolReorder(input: ReorderAiToolEntriesInput): Promise<void>;
  templateListForUser(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  templateListForOrgAdmin(input: { organizationId: string }): Promise<IngestionTemplate[]>;
  templateGetByIdForOrg(input: { id: string; organizationId: string }): Promise<IngestionTemplate>;
  templateCreateOrg(input: CreateIngestionTemplateInput): Promise<IngestionTemplate>;
  templateUpdateOttlRules(input: UpdateIngestionTemplateOttlInput): Promise<IngestionTemplate>;
  templateArchiveOrg(input: ArchiveIngestionTemplateInput): Promise<void>;
  templateCloneFromPlatform(input: CloneIngestionTemplateInput): Promise<IngestionTemplate>;
  ingestionKeyList(input: {
    organizationId: string;
    userId: string;
  }): Promise<PersonalIngestionKeyListing[]>;
  /** No key is minted while an impersonator acts as the member. */
  ingestionKeyInstall(
    input: PersonalIngestionKeyMint & { impersonatorId?: string | undefined },
  ): Promise<IssuedIngestionKey>;
  ingestionKeyRotate(
    input: PersonalIngestionKeyMint & { impersonatorId?: string | undefined },
  ): Promise<RotatedIngestionKey>;
  ingestionKeyRevoke(input: {
    organizationId: string;
    userId: string;
    apiKeyId: string;
    surface?: GovernanceCallSurface;
  }): Promise<void>;
  sessionPolicyGet(input: { organizationId: string }): Promise<OrganizationSessionPolicyShape>;
  sessionPolicySetMaxDuration(input: {
    organizationId: string;
    maxSessionDurationDays: number;
  }): Promise<SessionCeilingApplied>;
  governanceAgentsSyncSources(input: { organizationId: string }): Promise<AgentSyncSourceListing[]>;
  governanceAgentsRequestListing(input: {
    organizationId: string;
  }): Promise<AgentListingRequestResult>;
  governanceAgentsList(input: { organizationId: string }): Promise<GovernanceAgentRow[]>;
  governanceCostSummary(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostSummary>;
  governanceCostDailyByProvider(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostProviderDayBreakdown>;
  governanceCostSpendByModel(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostModelBreakdown>;
  governanceCostPeriodRecords(
    input: GovernanceCostPeriodRecordsInput,
    by: EntitlementOperator,
  ): Promise<GovernanceCostDayRecords>;
  governanceCostSpenders(
    input: GovernanceCostWindowInput,
    by: EntitlementOperator,
  ): Promise<GovernanceSpenderBreakdown>;
  governancePeopleList(input: { organizationId: string }): Promise<PeopleScreenPerson[]>;
  governancePeopleSuggestions(input: { organizationId: string }): Promise<PeopleScreenSuggestion[]>;
  governancePeopleRunMatch(input: { organizationId: string }): Promise<IdentityMatchRun>;
  governancePeopleConfirmSuggestion(input: {
    organizationId: string;
    suggestionId: string;
  }): Promise<IdentityMatchConfirmed>;
  cliSessionListForUser(input: CliUserInput): Promise<CliSessionCard[]>;
  cliSessionRevoke(input: RevokeCliSessionInput): Promise<CliSessionRevocation>;
  cliSessionRevokeAll(input: CliUserInput): Promise<CliSessionRevocation>;
  personalWebSessionList(input: {
    userId: string;
    currentSessionId?: string | undefined;
  }): Promise<BrowserSessionInventoryEntry[]>;
  personalWebSessionEnd(input: {
    userId: string;
    sessionId: string;
    currentSessionId?: string | undefined;
  }): Promise<{ ended: number }>;
  personalWebSessionsEndForIdentifier(input: {
    userId: string;
    identifierId: string;
  }): Promise<{ ended: number }>;
  ingestionSourceList(input: { organizationId: string }): Promise<IngestionSourceDto[]>;
  ingestionSourceGet(input: { id: string; organizationId: string }): Promise<IngestionSourceDto>;
  ingestionSourceCreate(
    input: IngestionSourceCreateInput & { actorUserId: string },
  ): Promise<{ source: IngestionSourceDto; ingestSecret: string | null }>;
  ingestionSourceUpdate(input: IngestionSourceUpdateInput): Promise<IngestionSourceDto>;
  ingestionSourceRotateSecret(input: {
    id: string;
    organizationId: string;
    /** A session's impersonator: no secret is minted while one acts as a member. */
    impersonatorId?: string | undefined;
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
  /** One person's own usage against a tenant the caller resolved, as main's `/api/me/usage`. */
  personalUsage(input: PersonalUsageQueryInput): Promise<PersonalUsageRollup>;
  personalUsageDashboard(
    input: { organizationId: string; window?: PersonalUsageWindow },
    by: GovernanceCaller,
  ): Promise<PersonalUsageRollup>;
  personalBudgetOverview(
    input: { organizationId: string; includeTopModels?: boolean },
    by: GovernanceCaller,
  ): Promise<GovernanceBudgetOverviewForUser>;
  cliBootstrap(
    input: { organizationId: string },
    by: GovernanceCaller,
  ): Promise<CliBootstrapResult>;
}

export const GovernanceRestApi = moduleApi<GovernanceRestApi>()("governance");
