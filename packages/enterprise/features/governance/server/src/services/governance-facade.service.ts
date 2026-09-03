// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { GovernanceActivityOperationsService } from "./governance-activity-operations.service";
import type { GovernanceIngestionOperationsService } from "./governance-ingestion-operations.service";
import type { GovernanceLifecycleOperationsService } from "./governance-lifecycle-operations.service";
import type { GovernanceRulesOperationsService } from "./governance-rules-operations.service";

/**
 * The one process-owned Governance capability passed to composition callers.
 *
 * The operation services are complete internal collaborators. This class is the
 * canonical public service; it owns no transport or persistence construction.
 */
export class DefaultGovernanceService extends GovernanceService {
  private constructor(
    private readonly rules: GovernanceRulesOperationsService,
    private readonly ingestion: GovernanceIngestionOperationsService,
    private readonly activity: GovernanceActivityOperationsService,
    private readonly lifecycle: GovernanceLifecycleOperationsService,
  ) {
    super();
  }

  static create(
    rules: GovernanceRulesOperationsService,
    ingestion: GovernanceIngestionOperationsService,
    activity: GovernanceActivityOperationsService,
    lifecycle: GovernanceLifecycleOperationsService,
  ): DefaultGovernanceService {
    return new DefaultGovernanceService(rules, ingestion, activity, lifecycle);
  }

  readonly anomalyRuleList: GovernanceService["anomalyRuleList"] = (...args) =>
    this.rules.anomalyRuleList(...args);

  readonly tryFindAnomalyRuleById: GovernanceService["tryFindAnomalyRuleById"] = (...args) =>
    this.rules.tryFindAnomalyRuleById(...args);

  readonly anomalyRuleGetById: GovernanceService["anomalyRuleGetById"] = (...args) =>
    this.rules.anomalyRuleGetById(...args);

  readonly anomalyRuleCreate: GovernanceService["anomalyRuleCreate"] = (...args) =>
    this.rules.anomalyRuleCreate(...args);

  readonly anomalyRuleUpdate: GovernanceService["anomalyRuleUpdate"] = (...args) =>
    this.rules.anomalyRuleUpdate(...args);

  readonly anomalyRuleArchive: GovernanceService["anomalyRuleArchive"] = (...args) =>
    this.rules.anomalyRuleArchive(...args);

  readonly departmentList: GovernanceService["departmentList"] = (...args) =>
    this.rules.departmentList(...args);

  readonly departmentAssignments: GovernanceService["departmentAssignments"] = (...args) =>
    this.rules.departmentAssignments(...args);

  readonly departmentCreate: GovernanceService["departmentCreate"] = (...args) =>
    this.rules.departmentCreate(...args);

  readonly departmentResolveByNameOrCreate: GovernanceService["departmentResolveByNameOrCreate"] = (
    ...args
  ) => this.rules.departmentResolveByNameOrCreate(...args);

  readonly departmentRename: GovernanceService["departmentRename"] = (...args) =>
    this.rules.departmentRename(...args);

  readonly departmentArchive: GovernanceService["departmentArchive"] = (...args) =>
    this.rules.departmentArchive(...args);

  readonly departmentAssignUser: GovernanceService["departmentAssignUser"] = (...args) =>
    this.rules.departmentAssignUser(...args);

  readonly departmentAssignTeam: GovernanceService["departmentAssignTeam"] = (...args) =>
    this.rules.departmentAssignTeam(...args);

  readonly departmentAssignProject: GovernanceService["departmentAssignProject"] = (...args) =>
    this.rules.departmentAssignProject(...args);

  readonly resolveSourceNonBillable: GovernanceService["resolveSourceNonBillable"] = (...args) =>
    this.rules.resolveSourceNonBillable(...args);

  readonly resolveTraceDepartment: GovernanceService["resolveTraceDepartment"] = (...args) =>
    this.rules.resolveTraceDepartment(...args);

  readonly aiToolListForUser: GovernanceService["aiToolListForUser"] = (...args) =>
    this.rules.aiToolListForUser(...args);

  readonly aiToolListForAdmin: GovernanceService["aiToolListForAdmin"] = (...args) =>
    this.rules.aiToolListForAdmin(...args);

  readonly tryFindAiToolById: GovernanceService["tryFindAiToolById"] = (...args) =>
    this.rules.tryFindAiToolById(...args);

  readonly aiToolGetById: GovernanceService["aiToolGetById"] = (...args) =>
    this.rules.aiToolGetById(...args);

  readonly aiToolCreate: GovernanceService["aiToolCreate"] = (...args) =>
    this.rules.aiToolCreate(...args);

  readonly aiToolUpdate: GovernanceService["aiToolUpdate"] = (...args) =>
    this.rules.aiToolUpdate(...args);

  readonly aiToolRemove: GovernanceService["aiToolRemove"] = (...args) =>
    this.rules.aiToolRemove(...args);

  readonly aiToolEnsureDefaultCatalog: GovernanceService["aiToolEnsureDefaultCatalog"] = (
    ...args
  ) => this.rules.aiToolEnsureDefaultCatalog(...args);

  readonly aiToolSeedStarterPack: GovernanceService["aiToolSeedStarterPack"] = (...args) =>
    this.rules.aiToolSeedStarterPack(...args);

  readonly aiToolListConfiguredProvidersForUser: GovernanceService["aiToolListConfiguredProvidersForUser"] =
    (...args) => this.rules.aiToolListConfiguredProvidersForUser(...args);

  readonly aiToolListProviderOptionsForAdmin: GovernanceService["aiToolListProviderOptionsForAdmin"] =
    (...args) => this.rules.aiToolListProviderOptionsForAdmin(...args);

  readonly aiToolListRoutingPolicyOptionsForAdmin: GovernanceService["aiToolListRoutingPolicyOptionsForAdmin"] =
    (...args) => this.rules.aiToolListRoutingPolicyOptionsForAdmin(...args);

  readonly aiToolReorder: GovernanceService["aiToolReorder"] = (...args) =>
    this.rules.aiToolReorder(...args);

  readonly aiToolResolvePolicyOverrides: GovernanceService["aiToolResolvePolicyOverrides"] = (
    ...args
  ) => this.rules.aiToolResolvePolicyOverrides(...args);

  readonly aiToolResolvePolicyMap: GovernanceService["aiToolResolvePolicyMap"] = (...args) =>
    this.rules.aiToolResolvePolicyMap(...args);

  readonly aiToolResolvePolicy: GovernanceService["aiToolResolvePolicy"] = (...args) =>
    this.rules.aiToolResolvePolicy(...args);

  readonly aiToolResolveCliCatalogForUser: GovernanceService["aiToolResolveCliCatalogForUser"] = (
    ...args
  ) => this.rules.aiToolResolveCliCatalogForUser(...args);

  readonly extractCanonicalCostEvents: GovernanceService["extractCanonicalCostEvents"] = (
    ...args
  ) => this.ingestion.extractCanonicalCostEvents(...args);

  readonly ingestionConfigure: GovernanceService["ingestionConfigure"] = (...args) =>
    this.ingestion.ingestionConfigure(...args);

  readonly ingestionDisable: GovernanceService["ingestionDisable"] = (...args) =>
    this.ingestion.ingestionDisable(...args);

  readonly ingestionRecordRunCompleted: GovernanceService["ingestionRecordRunCompleted"] = (
    ...args
  ) => this.ingestion.ingestionRecordRunCompleted(...args);

  readonly ingestionRecordRunFailed: GovernanceService["ingestionRecordRunFailed"] = (...args) =>
    this.ingestion.ingestionRecordRunFailed(...args);

  readonly usageRecord: GovernanceService["usageRecord"] = (...args) =>
    this.ingestion.usageRecord(...args);

  readonly ingestionKeyEnsureForProject: GovernanceService["ingestionKeyEnsureForProject"] = (
    ...args
  ) => this.ingestion.ingestionKeyEnsureForProject(...args);

  readonly ingestionKeyIssueForProject: GovernanceService["ingestionKeyIssueForProject"] = (
    ...args
  ) => this.ingestion.ingestionKeyIssueForProject(...args);

  readonly ingestionKeyEnsureForPersonalProject: GovernanceService["ingestionKeyEnsureForPersonalProject"] =
    (...args) => this.ingestion.ingestionKeyEnsureForPersonalProject(...args);

  readonly ingestionKeyListForPersonalProject: GovernanceService["ingestionKeyListForPersonalProject"] =
    (...args) => this.ingestion.ingestionKeyListForPersonalProject(...args);

  readonly ingestionSourceList: GovernanceService["ingestionSourceList"] = (...args) =>
    this.ingestion.ingestionSourceList(...args);

  readonly tryFindIngestionSourceById: GovernanceService["tryFindIngestionSourceById"] = (
    ...args
  ) => this.ingestion.tryFindIngestionSourceById(...args);

  readonly ingestionSourceLiveTraceProjectIds: GovernanceService["ingestionSourceLiveTraceProjectIds"] =
    (...args) => this.ingestion.ingestionSourceLiveTraceProjectIds(...args);

  readonly ingestionSourceGetById: GovernanceService["ingestionSourceGetById"] = (...args) =>
    this.ingestion.ingestionSourceGetById(...args);

  readonly tryFindIngestionSourceByIngestSecret: GovernanceService["tryFindIngestionSourceByIngestSecret"] =
    (...args) => this.ingestion.tryFindIngestionSourceByIngestSecret(...args);

  readonly ingestionSourceCreate: GovernanceService["ingestionSourceCreate"] = (...args) =>
    this.ingestion.ingestionSourceCreate(...args);

  readonly ingestionSourceUpdate: GovernanceService["ingestionSourceUpdate"] = (...args) =>
    this.ingestion.ingestionSourceUpdate(...args);

  readonly ingestionSourceRotateSecret: GovernanceService["ingestionSourceRotateSecret"] = (
    ...args
  ) => this.ingestion.ingestionSourceRotateSecret(...args);

  readonly ingestionSourceArchive: GovernanceService["ingestionSourceArchive"] = (...args) =>
    this.ingestion.ingestionSourceArchive(...args);

  readonly ingestionSourceRecordEventReceived: GovernanceService["ingestionSourceRecordEventReceived"] =
    (...args) => this.ingestion.ingestionSourceRecordEventReceived(...args);

  readonly templateListForUser: GovernanceService["templateListForUser"] = (...args) =>
    this.ingestion.templateListForUser(...args);

  readonly templateListForOrgAdmin: GovernanceService["templateListForOrgAdmin"] = (...args) =>
    this.ingestion.templateListForOrgAdmin(...args);

  readonly tryFindTemplateByIdForOrg: GovernanceService["tryFindTemplateByIdForOrg"] = (...args) =>
    this.ingestion.tryFindTemplateByIdForOrg(...args);

  readonly templateGetByIdForOrg: GovernanceService["templateGetByIdForOrg"] = (...args) =>
    this.ingestion.templateGetByIdForOrg(...args);

  readonly templateCreateOrg: GovernanceService["templateCreateOrg"] = (...args) =>
    this.ingestion.templateCreateOrg(...args);

  readonly templateUpdateOttlRules: GovernanceService["templateUpdateOttlRules"] = (...args) =>
    this.ingestion.templateUpdateOttlRules(...args);

  readonly templateArchiveOrg: GovernanceService["templateArchiveOrg"] = (...args) =>
    this.ingestion.templateArchiveOrg(...args);

  readonly templateCloneFromPlatform: GovernanceService["templateCloneFromPlatform"] = (...args) =>
    this.ingestion.templateCloneFromPlatform(...args);

  readonly templateSyncPlatformCatalog: GovernanceService["templateSyncPlatformCatalog"] = (
    ...args
  ) => this.ingestion.templateSyncPlatformCatalog(...args);

  readonly ocsfList: GovernanceService["ocsfList"] = (...args) => this.ingestion.ocsfList(...args);

  readonly ottlValidate: GovernanceService["ottlValidate"] = (...args) =>
    this.ingestion.ottlValidate(...args);

  readonly ottlTransform: GovernanceService["ottlTransform"] = (...args) =>
    this.ingestion.ottlTransform(...args);

  readonly activitySummary: GovernanceService["activitySummary"] = (...args) =>
    this.activity.activitySummary(...args);

  readonly activitySpendByUser: GovernanceService["activitySpendByUser"] = (...args) =>
    this.activity.activitySpendByUser(...args);

  readonly activitySpendByTeam: GovernanceService["activitySpendByTeam"] = (...args) =>
    this.activity.activitySpendByTeam(...args);

  readonly activitySpendByDepartment: GovernanceService["activitySpendByDepartment"] = (...args) =>
    this.activity.activitySpendByDepartment(...args);

  readonly activitySpendOverTime: GovernanceService["activitySpendOverTime"] = (...args) =>
    this.activity.activitySpendOverTime(...args);

  readonly activityRecentAnomalies: GovernanceService["activityRecentAnomalies"] = (...args) =>
    this.activity.activityRecentAnomalies(...args);

  readonly activityIngestionSourcesHealth: GovernanceService["activityIngestionSourcesHealth"] = (
    ...args
  ) => this.activity.activityIngestionSourcesHealth(...args);

  readonly activityEventsForSource: GovernanceService["activityEventsForSource"] = (...args) =>
    this.activity.activityEventsForSource(...args);

  readonly activitySourceHealthMetrics: GovernanceService["activitySourceHealthMetrics"] = (
    ...args
  ) => this.activity.activitySourceHealthMetrics(...args);

  readonly personalUsageSummary: GovernanceService["personalUsageSummary"] = (...args) =>
    this.activity.personalUsageSummary(...args);

  readonly personalUsageDailyBuckets: GovernanceService["personalUsageDailyBuckets"] = (...args) =>
    this.activity.personalUsageDailyBuckets(...args);

  readonly personalUsageBreakdownByModel: GovernanceService["personalUsageBreakdownByModel"] = (
    ...args
  ) => this.activity.personalUsageBreakdownByModel(...args);

  readonly personalBudgetOverviewForUser: GovernanceService["personalBudgetOverviewForUser"] = (
    ...args
  ) => this.activity.personalBudgetOverviewForUser(...args);

  readonly routingPolicyList: GovernanceService["routingPolicyList"] = (...args) =>
    this.lifecycle.routingPolicyList(...args);

  readonly tryFindRoutingPolicyById: GovernanceService["tryFindRoutingPolicyById"] = (...args) =>
    this.lifecycle.tryFindRoutingPolicyById(...args);

  readonly routingPolicyGetById: GovernanceService["routingPolicyGetById"] = (...args) =>
    this.lifecycle.routingPolicyGetById(...args);

  readonly routingPolicyCreate: GovernanceService["routingPolicyCreate"] = (...args) =>
    this.lifecycle.routingPolicyCreate(...args);

  readonly routingPolicyUpdate: GovernanceService["routingPolicyUpdate"] = (...args) =>
    this.lifecycle.routingPolicyUpdate(...args);

  readonly routingPolicySetDefault: GovernanceService["routingPolicySetDefault"] = (...args) =>
    this.lifecycle.routingPolicySetDefault(...args);

  readonly routingPolicyDelete: GovernanceService["routingPolicyDelete"] = (...args) =>
    this.lifecycle.routingPolicyDelete(...args);

  readonly tryResolveDefaultRoutingPolicyForUser: GovernanceService["tryResolveDefaultRoutingPolicyForUser"] =
    (...args) => this.lifecycle.tryResolveDefaultRoutingPolicyForUser(...args);

  readonly personalVirtualKeyEnsureDefault: GovernanceService["personalVirtualKeyEnsureDefault"] = (
    ...args
  ) => this.lifecycle.personalVirtualKeyEnsureDefault(...args);

  readonly personalVirtualKeyIssue: GovernanceService["personalVirtualKeyIssue"] = (...args) =>
    this.lifecycle.personalVirtualKeyIssue(...args);

  readonly personalVirtualKeyList: GovernanceService["personalVirtualKeyList"] = (...args) =>
    this.lifecycle.personalVirtualKeyList(...args);

  readonly personalVirtualKeyRevoke: GovernanceService["personalVirtualKeyRevoke"] = (...args) =>
    this.lifecycle.personalVirtualKeyRevoke(...args);

  readonly personalVirtualKeyRevokeAllForUser: GovernanceService["personalVirtualKeyRevokeAllForUser"] =
    (...args) => this.lifecycle.personalVirtualKeyRevokeAllForUser(...args);

  readonly cliBootstrapResolve: GovernanceService["cliBootstrapResolve"] = (...args) =>
    this.lifecycle.cliBootstrapResolve(...args);

  readonly cliSessionListForUser: GovernanceService["cliSessionListForUser"] = (...args) =>
    this.lifecycle.cliSessionListForUser(...args);

  readonly cliSessionRevoke: GovernanceService["cliSessionRevoke"] = (...args) =>
    this.lifecycle.cliSessionRevoke(...args);

  readonly cliTokenRevokeForUser: GovernanceService["cliTokenRevokeForUser"] = (...args) =>
    this.lifecycle.cliTokenRevokeForUser(...args);

  readonly adminWorkspaceRecordView: GovernanceService["adminWorkspaceRecordView"] = (...args) =>
    this.lifecycle.adminWorkspaceRecordView(...args);

  readonly quarantineFillEvaluate: GovernanceService["quarantineFillEvaluate"] = (...args) =>
    this.lifecycle.quarantineFillEvaluate(...args);

  readonly resolveSetupState: GovernanceService["resolveSetupState"] = (...args) =>
    this.lifecycle.resolveSetupState(...args);
}
