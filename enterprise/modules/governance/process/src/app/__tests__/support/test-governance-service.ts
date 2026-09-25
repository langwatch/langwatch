import type { GovernanceApi } from "@langwatch/enterprise-governance-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/**
 * Complete Governance boundary for tests that only exercise a few methods,
 * shaped like {@link ../support/test-project-api.ts}: every member is
 * present and refuses, so an unintended call fails loudly, not `undefined`.
 */
export class TestGovernanceService implements GovernanceApi {
  activityEventsForSource = unsupported<GovernanceApi["activityEventsForSource"]>();
  activityIngestionSourcesHealth = unsupported<GovernanceApi["activityIngestionSourcesHealth"]>();
  activityRecentAnomalies = unsupported<GovernanceApi["activityRecentAnomalies"]>();
  activitySourceHealthMetrics = unsupported<GovernanceApi["activitySourceHealthMetrics"]>();
  activitySpendByDepartment = unsupported<GovernanceApi["activitySpendByDepartment"]>();
  activitySpendByTeam = unsupported<GovernanceApi["activitySpendByTeam"]>();
  activitySpendByUser = unsupported<GovernanceApi["activitySpendByUser"]>();
  activitySpendOverTime = unsupported<GovernanceApi["activitySpendOverTime"]>();
  activitySummary = unsupported<GovernanceApi["activitySummary"]>();
  adminWorkspaceRecordView = unsupported<GovernanceApi["adminWorkspaceRecordView"]>();
  aiToolCreate = unsupported<GovernanceApi["aiToolCreate"]>();
  aiToolEnsureDefaultCatalog = unsupported<GovernanceApi["aiToolEnsureDefaultCatalog"]>();
  aiToolGetById = unsupported<GovernanceApi["aiToolGetById"]>();
  aiToolListConfiguredProvidersForUser =
    unsupported<GovernanceApi["aiToolListConfiguredProvidersForUser"]>();
  aiToolListForAdmin = unsupported<GovernanceApi["aiToolListForAdmin"]>();
  aiToolListForUser = unsupported<GovernanceApi["aiToolListForUser"]>();
  aiToolListProviderOptionsForAdmin =
    unsupported<GovernanceApi["aiToolListProviderOptionsForAdmin"]>();
  aiToolListRoutingPolicyOptionsForAdmin =
    unsupported<GovernanceApi["aiToolListRoutingPolicyOptionsForAdmin"]>();
  aiToolRemove = unsupported<GovernanceApi["aiToolRemove"]>();
  aiToolReorder = unsupported<GovernanceApi["aiToolReorder"]>();
  aiToolResolveCliCatalogForUser = unsupported<GovernanceApi["aiToolResolveCliCatalogForUser"]>();
  aiToolResolvePolicy = unsupported<GovernanceApi["aiToolResolvePolicy"]>();
  aiToolResolvePolicyMap = unsupported<GovernanceApi["aiToolResolvePolicyMap"]>();
  aiToolResolvePolicyOverrides = unsupported<GovernanceApi["aiToolResolvePolicyOverrides"]>();
  aiToolSeedStarterPack = unsupported<GovernanceApi["aiToolSeedStarterPack"]>();
  aiToolUpdate = unsupported<GovernanceApi["aiToolUpdate"]>();
  anomalyRuleArchive = unsupported<GovernanceApi["anomalyRuleArchive"]>();
  anomalyRuleCreate = unsupported<GovernanceApi["anomalyRuleCreate"]>();
  anomalyRuleGetById = unsupported<GovernanceApi["anomalyRuleGetById"]>();
  anomalyRuleList = unsupported<GovernanceApi["anomalyRuleList"]>();
  anomalyRuleUpdate = unsupported<GovernanceApi["anomalyRuleUpdate"]>();
  cliBootstrapResolve = unsupported<GovernanceApi["cliBootstrapResolve"]>();
  cliSessionListForUser = unsupported<GovernanceApi["cliSessionListForUser"]>();
  cliSessionRevoke = unsupported<GovernanceApi["cliSessionRevoke"]>();
  cliTokenRevokeForUser = unsupported<GovernanceApi["cliTokenRevokeForUser"]>();
  departmentArchive = unsupported<GovernanceApi["departmentArchive"]>();
  departmentAssignProject = unsupported<GovernanceApi["departmentAssignProject"]>();
  departmentAssignTeam = unsupported<GovernanceApi["departmentAssignTeam"]>();
  departmentAssignUser = unsupported<GovernanceApi["departmentAssignUser"]>();
  departmentAssignments = unsupported<GovernanceApi["departmentAssignments"]>();
  departmentCreate = unsupported<GovernanceApi["departmentCreate"]>();
  departmentList = unsupported<GovernanceApi["departmentList"]>();
  departmentRename = unsupported<GovernanceApi["departmentRename"]>();
  departmentResolveByNameOrCreate = unsupported<GovernanceApi["departmentResolveByNameOrCreate"]>();
  extractCanonicalCostEvents = unsupported<GovernanceApi["extractCanonicalCostEvents"]>();
  ingestionConfigure = unsupported<GovernanceApi["ingestionConfigure"]>();
  ingestionDisable = unsupported<GovernanceApi["ingestionDisable"]>();
  ingestionKeyIssueForProject = unsupported<GovernanceApi["ingestionKeyIssueForProject"]>();
  ingestionKeyIssueForPersonalProject =
    unsupported<GovernanceApi["ingestionKeyIssueForPersonalProject"]>();
  ingestionKeyListForPersonalProject =
    unsupported<GovernanceApi["ingestionKeyListForPersonalProject"]>();
  getPersonalIngestionKeyState = unsupported<GovernanceApi["getPersonalIngestionKeyState"]>();
  ingestionRecordRunCompleted = unsupported<GovernanceApi["ingestionRecordRunCompleted"]>();
  ingestionRecordRunFailed = unsupported<GovernanceApi["ingestionRecordRunFailed"]>();
  ingestionSourceArchive = unsupported<GovernanceApi["ingestionSourceArchive"]>();
  ingestionSourceCreate = unsupported<GovernanceApi["ingestionSourceCreate"]>();
  ingestionSourceGetById = unsupported<GovernanceApi["ingestionSourceGetById"]>();
  ingestionSourceList = unsupported<GovernanceApi["ingestionSourceList"]>();
  ingestionSourceLiveTraceProjectIds =
    unsupported<GovernanceApi["ingestionSourceLiveTraceProjectIds"]>();
  ingestionSourceRecordEventReceived =
    unsupported<GovernanceApi["ingestionSourceRecordEventReceived"]>();
  ingestionSourceRotateSecret = unsupported<GovernanceApi["ingestionSourceRotateSecret"]>();
  ingestionSourceUpdate = unsupported<GovernanceApi["ingestionSourceUpdate"]>();
  ocsfList = unsupported<GovernanceApi["ocsfList"]>();
  ottlTransform = unsupported<GovernanceApi["ottlTransform"]>();
  ottlValidate = unsupported<GovernanceApi["ottlValidate"]>();
  personalBudgetOverviewForUser = unsupported<GovernanceApi["personalBudgetOverviewForUser"]>();
  personalUsageBreakdownByModel = unsupported<GovernanceApi["personalUsageBreakdownByModel"]>();
  personalUsageDailyBuckets = unsupported<GovernanceApi["personalUsageDailyBuckets"]>();
  personalUsageSummary = unsupported<GovernanceApi["personalUsageSummary"]>();
  quarantineFillEvaluate = unsupported<GovernanceApi["quarantineFillEvaluate"]>();
  resolveSetupState = unsupported<GovernanceApi["resolveSetupState"]>();
  resolveOtlpReceiverPolicies = unsupported<GovernanceApi["resolveOtlpReceiverPolicies"]>();
  resolveSourceNonBillable = unsupported<GovernanceApi["resolveSourceNonBillable"]>();
  resolveTraceDepartment = unsupported<GovernanceApi["resolveTraceDepartment"]>();
  templateArchiveOrg = unsupported<GovernanceApi["templateArchiveOrg"]>();
  templateCloneFromPlatform = unsupported<GovernanceApi["templateCloneFromPlatform"]>();
  templateCreateOrg = unsupported<GovernanceApi["templateCreateOrg"]>();
  templateGetByIdForOrg = unsupported<GovernanceApi["templateGetByIdForOrg"]>();
  templateListForOrgAdmin = unsupported<GovernanceApi["templateListForOrgAdmin"]>();
  templateListForUser = unsupported<GovernanceApi["templateListForUser"]>();
  templateSyncPlatformCatalog = unsupported<GovernanceApi["templateSyncPlatformCatalog"]>();
  templateUpdateOttlRules = unsupported<GovernanceApi["templateUpdateOttlRules"]>();
  findAiToolById = unsupported<GovernanceApi["findAiToolById"]>();
  findAnomalyRuleById = unsupported<GovernanceApi["findAnomalyRuleById"]>();
  findIngestionSourceById = unsupported<GovernanceApi["findIngestionSourceById"]>();
  findIngestionSourceByIngestSecret =
    unsupported<GovernanceApi["findIngestionSourceByIngestSecret"]>();
  findTemplateByIdForOrg = unsupported<GovernanceApi["findTemplateByIdForOrg"]>();
  usageRecord = unsupported<GovernanceApi["usageRecord"]>();
}
