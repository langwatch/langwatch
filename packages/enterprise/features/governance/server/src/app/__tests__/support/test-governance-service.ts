import { GovernanceService } from "@langwatch/enterprise-governance-contract";

const unsupported = <Method>(): Method =>
  (() => Promise.reject(new Error("not used by this test"))) as Method;

/**
 * Complete Governance boundary for tests that only exercise a few methods.
 *
 * The same shape as {@link ../support/test-project-service.ts}: every member
 * of the contract is present and refuses, so a test that reaches one it did
 * not mean to reach fails loudly instead of reading `undefined`.
 */
export class TestGovernanceService extends GovernanceService {
  activityEventsForSource = unsupported<GovernanceService["activityEventsForSource"]>();
  activityIngestionSourcesHealth =
    unsupported<GovernanceService["activityIngestionSourcesHealth"]>();
  activityRecentAnomalies = unsupported<GovernanceService["activityRecentAnomalies"]>();
  activitySourceHealthMetrics = unsupported<GovernanceService["activitySourceHealthMetrics"]>();
  activitySpendByDepartment = unsupported<GovernanceService["activitySpendByDepartment"]>();
  activitySpendByTeam = unsupported<GovernanceService["activitySpendByTeam"]>();
  activitySpendByUser = unsupported<GovernanceService["activitySpendByUser"]>();
  activitySpendOverTime = unsupported<GovernanceService["activitySpendOverTime"]>();
  activitySummary = unsupported<GovernanceService["activitySummary"]>();
  adminWorkspaceRecordView = unsupported<GovernanceService["adminWorkspaceRecordView"]>();
  aiToolCreate = unsupported<GovernanceService["aiToolCreate"]>();
  aiToolEnsureDefaultCatalog = unsupported<GovernanceService["aiToolEnsureDefaultCatalog"]>();
  aiToolGetById = unsupported<GovernanceService["aiToolGetById"]>();
  aiToolListConfiguredProvidersForUser =
    unsupported<GovernanceService["aiToolListConfiguredProvidersForUser"]>();
  aiToolListForAdmin = unsupported<GovernanceService["aiToolListForAdmin"]>();
  aiToolListForUser = unsupported<GovernanceService["aiToolListForUser"]>();
  aiToolListProviderOptionsForAdmin =
    unsupported<GovernanceService["aiToolListProviderOptionsForAdmin"]>();
  aiToolListRoutingPolicyOptionsForAdmin =
    unsupported<GovernanceService["aiToolListRoutingPolicyOptionsForAdmin"]>();
  aiToolRemove = unsupported<GovernanceService["aiToolRemove"]>();
  aiToolReorder = unsupported<GovernanceService["aiToolReorder"]>();
  aiToolResolveCliCatalogForUser =
    unsupported<GovernanceService["aiToolResolveCliCatalogForUser"]>();
  aiToolResolvePolicy = unsupported<GovernanceService["aiToolResolvePolicy"]>();
  aiToolResolvePolicyMap = unsupported<GovernanceService["aiToolResolvePolicyMap"]>();
  aiToolResolvePolicyOverrides = unsupported<GovernanceService["aiToolResolvePolicyOverrides"]>();
  aiToolSeedStarterPack = unsupported<GovernanceService["aiToolSeedStarterPack"]>();
  aiToolUpdate = unsupported<GovernanceService["aiToolUpdate"]>();
  anomalyRuleArchive = unsupported<GovernanceService["anomalyRuleArchive"]>();
  anomalyRuleCreate = unsupported<GovernanceService["anomalyRuleCreate"]>();
  anomalyRuleGetById = unsupported<GovernanceService["anomalyRuleGetById"]>();
  anomalyRuleList = unsupported<GovernanceService["anomalyRuleList"]>();
  anomalyRuleUpdate = unsupported<GovernanceService["anomalyRuleUpdate"]>();
  cliBootstrapResolve = unsupported<GovernanceService["cliBootstrapResolve"]>();
  cliSessionListForUser = unsupported<GovernanceService["cliSessionListForUser"]>();
  cliSessionRevoke = unsupported<GovernanceService["cliSessionRevoke"]>();
  cliTokenRevokeForUser = unsupported<GovernanceService["cliTokenRevokeForUser"]>();
  departmentArchive = unsupported<GovernanceService["departmentArchive"]>();
  departmentAssignProject = unsupported<GovernanceService["departmentAssignProject"]>();
  departmentAssignTeam = unsupported<GovernanceService["departmentAssignTeam"]>();
  departmentAssignUser = unsupported<GovernanceService["departmentAssignUser"]>();
  departmentAssignments = unsupported<GovernanceService["departmentAssignments"]>();
  departmentCreate = unsupported<GovernanceService["departmentCreate"]>();
  departmentList = unsupported<GovernanceService["departmentList"]>();
  departmentRename = unsupported<GovernanceService["departmentRename"]>();
  departmentResolveByNameOrCreate =
    unsupported<GovernanceService["departmentResolveByNameOrCreate"]>();
  extractCanonicalCostEvents = unsupported<GovernanceService["extractCanonicalCostEvents"]>();
  ingestionConfigure = unsupported<GovernanceService["ingestionConfigure"]>();
  ingestionDisable = unsupported<GovernanceService["ingestionDisable"]>();
  ingestionKeyEnsureForPersonalProject =
    unsupported<GovernanceService["ingestionKeyEnsureForPersonalProject"]>();
  ingestionKeyEnsureForProject = unsupported<GovernanceService["ingestionKeyEnsureForProject"]>();
  ingestionKeyIssueForProject = unsupported<GovernanceService["ingestionKeyIssueForProject"]>();
  ingestionKeyListForPersonalProject =
    unsupported<GovernanceService["ingestionKeyListForPersonalProject"]>();
  ingestionRecordRunCompleted = unsupported<GovernanceService["ingestionRecordRunCompleted"]>();
  ingestionRecordRunFailed = unsupported<GovernanceService["ingestionRecordRunFailed"]>();
  ingestionSourceArchive = unsupported<GovernanceService["ingestionSourceArchive"]>();
  ingestionSourceCreate = unsupported<GovernanceService["ingestionSourceCreate"]>();
  ingestionSourceGetById = unsupported<GovernanceService["ingestionSourceGetById"]>();
  ingestionSourceList = unsupported<GovernanceService["ingestionSourceList"]>();
  ingestionSourceLiveTraceProjectIds =
    unsupported<GovernanceService["ingestionSourceLiveTraceProjectIds"]>();
  ingestionSourceRecordEventReceived =
    unsupported<GovernanceService["ingestionSourceRecordEventReceived"]>();
  ingestionSourceRotateSecret = unsupported<GovernanceService["ingestionSourceRotateSecret"]>();
  ingestionSourceUpdate = unsupported<GovernanceService["ingestionSourceUpdate"]>();
  ocsfList = unsupported<GovernanceService["ocsfList"]>();
  ottlTransform = unsupported<GovernanceService["ottlTransform"]>();
  ottlValidate = unsupported<GovernanceService["ottlValidate"]>();
  personalBudgetOverviewForUser = unsupported<GovernanceService["personalBudgetOverviewForUser"]>();
  personalUsageBreakdownByModel = unsupported<GovernanceService["personalUsageBreakdownByModel"]>();
  personalUsageDailyBuckets = unsupported<GovernanceService["personalUsageDailyBuckets"]>();
  personalUsageSummary = unsupported<GovernanceService["personalUsageSummary"]>();
  personalVirtualKeyEnsureDefault =
    unsupported<GovernanceService["personalVirtualKeyEnsureDefault"]>();
  personalVirtualKeyIssue = unsupported<GovernanceService["personalVirtualKeyIssue"]>();
  personalVirtualKeyList = unsupported<GovernanceService["personalVirtualKeyList"]>();
  personalVirtualKeyRevoke = unsupported<GovernanceService["personalVirtualKeyRevoke"]>();
  personalVirtualKeyRevokeAllForUser =
    unsupported<GovernanceService["personalVirtualKeyRevokeAllForUser"]>();
  quarantineFillEvaluate = unsupported<GovernanceService["quarantineFillEvaluate"]>();
  resolveSetupState = unsupported<GovernanceService["resolveSetupState"]>();
  resolveSourceNonBillable = unsupported<GovernanceService["resolveSourceNonBillable"]>();
  resolveTraceDepartment = unsupported<GovernanceService["resolveTraceDepartment"]>();
  routingPolicyCreate = unsupported<GovernanceService["routingPolicyCreate"]>();
  routingPolicyDelete = unsupported<GovernanceService["routingPolicyDelete"]>();
  routingPolicyGetById = unsupported<GovernanceService["routingPolicyGetById"]>();
  routingPolicyList = unsupported<GovernanceService["routingPolicyList"]>();
  routingPolicySetDefault = unsupported<GovernanceService["routingPolicySetDefault"]>();
  routingPolicyUpdate = unsupported<GovernanceService["routingPolicyUpdate"]>();
  templateArchiveOrg = unsupported<GovernanceService["templateArchiveOrg"]>();
  templateCloneFromPlatform = unsupported<GovernanceService["templateCloneFromPlatform"]>();
  templateCreateOrg = unsupported<GovernanceService["templateCreateOrg"]>();
  templateGetByIdForOrg = unsupported<GovernanceService["templateGetByIdForOrg"]>();
  templateListForOrgAdmin = unsupported<GovernanceService["templateListForOrgAdmin"]>();
  templateListForUser = unsupported<GovernanceService["templateListForUser"]>();
  templateSyncPlatformCatalog = unsupported<GovernanceService["templateSyncPlatformCatalog"]>();
  templateUpdateOttlRules = unsupported<GovernanceService["templateUpdateOttlRules"]>();
  tryFindAiToolById = unsupported<GovernanceService["tryFindAiToolById"]>();
  tryFindAnomalyRuleById = unsupported<GovernanceService["tryFindAnomalyRuleById"]>();
  tryFindIngestionSourceById = unsupported<GovernanceService["tryFindIngestionSourceById"]>();
  tryFindIngestionSourceByIngestSecret =
    unsupported<GovernanceService["tryFindIngestionSourceByIngestSecret"]>();
  tryFindRoutingPolicyById = unsupported<GovernanceService["tryFindRoutingPolicyById"]>();
  tryFindTemplateByIdForOrg = unsupported<GovernanceService["tryFindTemplateByIdForOrg"]>();
  tryResolveDefaultRoutingPolicyForUser =
    unsupported<GovernanceService["tryResolveDefaultRoutingPolicyForUser"]>();
  usageRecord = unsupported<GovernanceService["usageRecord"]>();
}
