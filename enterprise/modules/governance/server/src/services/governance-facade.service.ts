import type {
  GovernanceOtlpPolicyInput,
  GovernanceOtlpReceiverPolicies,
} from "@langwatch/enterprise-governance-contract";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { GovernanceActivityOperationsService } from "./governance-activity-operations.service.ts";
import type { GovernanceIngestionOperationsService } from "./governance-ingestion-operations.service.ts";
import type { GovernanceLifecycleOperationsService } from "./governance-lifecycle-operations.service.ts";
import type { GovernanceRulesOperationsService } from "./governance-rules-operations.service.ts";

/**
 * The one process-owned Governance capability passed to composition callers.
 *
 * The operation services are complete internal collaborators. This class is the
 * canonical public service; it owns no transport or persistence construction.
 * Folded off the deleted `GovernanceService` contract-service (ADR-133): it
 * implements `GovernanceApi` directly rather than extending an abstract class.
 */
export class DefaultGovernanceService implements GovernanceApi {
  private constructor(
    private readonly rules: GovernanceRulesOperationsService,
    private readonly ingestion: GovernanceIngestionOperationsService,
    private readonly activity: GovernanceActivityOperationsService,
    private readonly lifecycle: GovernanceLifecycleOperationsService,
  ) {}

  static create(
    rules: GovernanceRulesOperationsService,
    ingestion: GovernanceIngestionOperationsService,
    activity: GovernanceActivityOperationsService,
    lifecycle: GovernanceLifecycleOperationsService,
  ): DefaultGovernanceService {
    return new DefaultGovernanceService(rules, ingestion, activity, lifecycle);
  }

  readonly anomalyRuleList: GovernanceApi["anomalyRuleList"] = (...args) =>
    this.rules.anomalyRuleList(...args);

  readonly tryFindAnomalyRuleById: GovernanceApi["tryFindAnomalyRuleById"] = (...args) =>
    this.rules.tryFindAnomalyRuleById(...args);

  readonly anomalyRuleGetById: GovernanceApi["anomalyRuleGetById"] = (...args) =>
    this.rules.anomalyRuleGetById(...args);

  readonly anomalyRuleCreate: GovernanceApi["anomalyRuleCreate"] = (...args) =>
    this.rules.anomalyRuleCreate(...args);

  readonly anomalyRuleUpdate: GovernanceApi["anomalyRuleUpdate"] = (...args) =>
    this.rules.anomalyRuleUpdate(...args);

  readonly anomalyRuleArchive: GovernanceApi["anomalyRuleArchive"] = (...args) =>
    this.rules.anomalyRuleArchive(...args);

  readonly departmentList: GovernanceApi["departmentList"] = (...args) =>
    this.rules.departmentList(...args);

  readonly departmentAssignments: GovernanceApi["departmentAssignments"] = (...args) =>
    this.rules.departmentAssignments(...args);

  readonly departmentCreate: GovernanceApi["departmentCreate"] = (...args) =>
    this.rules.departmentCreate(...args);

  readonly departmentResolveByNameOrCreate: GovernanceApi["departmentResolveByNameOrCreate"] = (
    ...args
  ) => this.rules.departmentResolveByNameOrCreate(...args);

  readonly departmentRename: GovernanceApi["departmentRename"] = (...args) =>
    this.rules.departmentRename(...args);

  readonly departmentArchive: GovernanceApi["departmentArchive"] = (...args) =>
    this.rules.departmentArchive(...args);

  readonly departmentAssignUser: GovernanceApi["departmentAssignUser"] = (...args) =>
    this.rules.departmentAssignUser(...args);

  readonly departmentAssignTeam: GovernanceApi["departmentAssignTeam"] = (...args) =>
    this.rules.departmentAssignTeam(...args);

  readonly departmentAssignProject: GovernanceApi["departmentAssignProject"] = (...args) =>
    this.rules.departmentAssignProject(...args);

  resolveOtlpReceiverPolicies(
    input: GovernanceOtlpPolicyInput,
  ): Promise<GovernanceOtlpReceiverPolicies> {
    return this.rules.resolveOtlpReceiverPolicies(input);
  }

  readonly resolveSourceNonBillable: GovernanceApi["resolveSourceNonBillable"] = (...args) =>
    this.rules.resolveSourceNonBillable(...args);

  readonly resolveTraceDepartment: GovernanceApi["resolveTraceDepartment"] = (...args) =>
    this.rules.resolveTraceDepartment(...args);

  readonly aiToolListForUser: GovernanceApi["aiToolListForUser"] = (...args) =>
    this.rules.aiToolListForUser(...args);

  readonly aiToolListForAdmin: GovernanceApi["aiToolListForAdmin"] = (...args) =>
    this.rules.aiToolListForAdmin(...args);

  readonly tryFindAiToolById: GovernanceApi["tryFindAiToolById"] = (...args) =>
    this.rules.tryFindAiToolById(...args);

  readonly aiToolGetById: GovernanceApi["aiToolGetById"] = (...args) =>
    this.rules.aiToolGetById(...args);

  readonly aiToolCreate: GovernanceApi["aiToolCreate"] = (...args) =>
    this.rules.aiToolCreate(...args);

  readonly aiToolUpdate: GovernanceApi["aiToolUpdate"] = (...args) =>
    this.rules.aiToolUpdate(...args);

  readonly aiToolRemove: GovernanceApi["aiToolRemove"] = (...args) =>
    this.rules.aiToolRemove(...args);

  readonly aiToolEnsureDefaultCatalog: GovernanceApi["aiToolEnsureDefaultCatalog"] = (
    ...args
  ) => this.rules.aiToolEnsureDefaultCatalog(...args);

  readonly aiToolSeedStarterPack: GovernanceApi["aiToolSeedStarterPack"] = (...args) =>
    this.rules.aiToolSeedStarterPack(...args);

  readonly aiToolListConfiguredProvidersForUser: GovernanceApi["aiToolListConfiguredProvidersForUser"] =
    (...args) => this.rules.aiToolListConfiguredProvidersForUser(...args);

  readonly aiToolListProviderOptionsForAdmin: GovernanceApi["aiToolListProviderOptionsForAdmin"] =
    (...args) => this.rules.aiToolListProviderOptionsForAdmin(...args);

  readonly aiToolListRoutingPolicyOptionsForAdmin: GovernanceApi["aiToolListRoutingPolicyOptionsForAdmin"] =
    (...args) => this.rules.aiToolListRoutingPolicyOptionsForAdmin(...args);

  readonly aiToolReorder: GovernanceApi["aiToolReorder"] = (...args) =>
    this.rules.aiToolReorder(...args);

  readonly aiToolResolvePolicyOverrides: GovernanceApi["aiToolResolvePolicyOverrides"] = (
    ...args
  ) => this.rules.aiToolResolvePolicyOverrides(...args);

  readonly aiToolResolvePolicyMap: GovernanceApi["aiToolResolvePolicyMap"] = (...args) =>
    this.rules.aiToolResolvePolicyMap(...args);

  readonly aiToolResolvePolicy: GovernanceApi["aiToolResolvePolicy"] = (...args) =>
    this.rules.aiToolResolvePolicy(...args);

  readonly aiToolResolveCliCatalogForUser: GovernanceApi["aiToolResolveCliCatalogForUser"] = (
    ...args
  ) => this.rules.aiToolResolveCliCatalogForUser(...args);

  readonly extractCanonicalCostEvents: GovernanceApi["extractCanonicalCostEvents"] = (
    ...args
  ) => this.ingestion.extractCanonicalCostEvents(...args);

  readonly ingestionConfigure: GovernanceApi["ingestionConfigure"] = (...args) =>
    this.ingestion.ingestionConfigure(...args);

  readonly ingestionDisable: GovernanceApi["ingestionDisable"] = (...args) =>
    this.ingestion.ingestionDisable(...args);

  readonly ingestionRecordRunCompleted: GovernanceApi["ingestionRecordRunCompleted"] = (
    ...args
  ) => this.ingestion.ingestionRecordRunCompleted(...args);

  readonly ingestionRecordRunFailed: GovernanceApi["ingestionRecordRunFailed"] = (...args) =>
    this.ingestion.ingestionRecordRunFailed(...args);

  readonly usageRecord: GovernanceApi["usageRecord"] = (...args) =>
    this.ingestion.usageRecord(...args);

  readonly ingestionKeyEnsureForProject: GovernanceApi["ingestionKeyEnsureForProject"] = (
    ...args
  ) => this.ingestion.ingestionKeyEnsureForProject(...args);

  readonly ingestionKeyIssueForProject: GovernanceApi["ingestionKeyIssueForProject"] = (
    ...args
  ) => this.ingestion.ingestionKeyIssueForProject(...args);

  readonly ingestionKeyEnsureForPersonalProject: GovernanceApi["ingestionKeyEnsureForPersonalProject"] =
    (...args) => this.ingestion.ingestionKeyEnsureForPersonalProject(...args);

  readonly ingestionKeyIssueForPersonalProject: GovernanceApi["ingestionKeyIssueForPersonalProject"] =
    (...args) => this.ingestion.ingestionKeyIssueForPersonalProject(...args);

  readonly ingestionKeyListForPersonalProject: GovernanceApi["ingestionKeyListForPersonalProject"] =
    (...args) => this.ingestion.ingestionKeyListForPersonalProject(...args);

  readonly tryDescribePersonalIngestionKey: GovernanceApi["tryDescribePersonalIngestionKey"] = (
    ...args
  ) => this.ingestion.tryDescribePersonalIngestionKey(...args);

  readonly ingestionSourceList: GovernanceApi["ingestionSourceList"] = (...args) =>
    this.ingestion.ingestionSourceList(...args);

  readonly tryFindIngestionSourceById: GovernanceApi["tryFindIngestionSourceById"] = (
    ...args
  ) => this.ingestion.tryFindIngestionSourceById(...args);

  readonly ingestionSourceLiveTraceProjectIds: GovernanceApi["ingestionSourceLiveTraceProjectIds"] =
    (...args) => this.ingestion.ingestionSourceLiveTraceProjectIds(...args);

  readonly ingestionSourceGetById: GovernanceApi["ingestionSourceGetById"] = (...args) =>
    this.ingestion.ingestionSourceGetById(...args);

  readonly tryFindIngestionSourceByIngestSecret: GovernanceApi["tryFindIngestionSourceByIngestSecret"] =
    (...args) => this.ingestion.tryFindIngestionSourceByIngestSecret(...args);

  readonly ingestionSourceCreate: GovernanceApi["ingestionSourceCreate"] = (...args) =>
    this.ingestion.ingestionSourceCreate(...args);

  readonly ingestionSourceUpdate: GovernanceApi["ingestionSourceUpdate"] = (...args) =>
    this.ingestion.ingestionSourceUpdate(...args);

  readonly ingestionSourceRotateSecret: GovernanceApi["ingestionSourceRotateSecret"] = (
    ...args
  ) => this.ingestion.ingestionSourceRotateSecret(...args);

  readonly ingestionSourceArchive: GovernanceApi["ingestionSourceArchive"] = (...args) =>
    this.ingestion.ingestionSourceArchive(...args);

  readonly ingestionSourceRecordEventReceived: GovernanceApi["ingestionSourceRecordEventReceived"] =
    (...args) => this.ingestion.ingestionSourceRecordEventReceived(...args);

  readonly templateListForUser: GovernanceApi["templateListForUser"] = (...args) =>
    this.ingestion.templateListForUser(...args);

  readonly templateListForOrgAdmin: GovernanceApi["templateListForOrgAdmin"] = (...args) =>
    this.ingestion.templateListForOrgAdmin(...args);

  readonly tryFindTemplateByIdForOrg: GovernanceApi["tryFindTemplateByIdForOrg"] = (...args) =>
    this.ingestion.tryFindTemplateByIdForOrg(...args);

  readonly templateGetByIdForOrg: GovernanceApi["templateGetByIdForOrg"] = (...args) =>
    this.ingestion.templateGetByIdForOrg(...args);

  readonly templateCreateOrg: GovernanceApi["templateCreateOrg"] = (...args) =>
    this.ingestion.templateCreateOrg(...args);

  readonly templateUpdateOttlRules: GovernanceApi["templateUpdateOttlRules"] = (...args) =>
    this.ingestion.templateUpdateOttlRules(...args);

  readonly templateArchiveOrg: GovernanceApi["templateArchiveOrg"] = (...args) =>
    this.ingestion.templateArchiveOrg(...args);

  readonly templateCloneFromPlatform: GovernanceApi["templateCloneFromPlatform"] = (...args) =>
    this.ingestion.templateCloneFromPlatform(...args);

  readonly templateSyncPlatformCatalog: GovernanceApi["templateSyncPlatformCatalog"] = (
    ...args
  ) => this.ingestion.templateSyncPlatformCatalog(...args);

  readonly ocsfList: GovernanceApi["ocsfList"] = (...args) => this.ingestion.ocsfList(...args);

  readonly ottlValidate: GovernanceApi["ottlValidate"] = (...args) =>
    this.ingestion.ottlValidate(...args);

  readonly ottlTransform: GovernanceApi["ottlTransform"] = (...args) =>
    this.ingestion.ottlTransform(...args);

  readonly activitySummary: GovernanceApi["activitySummary"] = (...args) =>
    this.activity.activitySummary(...args);

  readonly activitySpendByUser: GovernanceApi["activitySpendByUser"] = (...args) =>
    this.activity.activitySpendByUser(...args);

  readonly activitySpendByTeam: GovernanceApi["activitySpendByTeam"] = (...args) =>
    this.activity.activitySpendByTeam(...args);

  readonly activitySpendByDepartment: GovernanceApi["activitySpendByDepartment"] = (...args) =>
    this.activity.activitySpendByDepartment(...args);

  readonly activitySpendOverTime: GovernanceApi["activitySpendOverTime"] = (...args) =>
    this.activity.activitySpendOverTime(...args);

  readonly activityRecentAnomalies: GovernanceApi["activityRecentAnomalies"] = (...args) =>
    this.activity.activityRecentAnomalies(...args);

  readonly activityIngestionSourcesHealth: GovernanceApi["activityIngestionSourcesHealth"] = (
    ...args
  ) => this.activity.activityIngestionSourcesHealth(...args);

  readonly activityEventsForSource: GovernanceApi["activityEventsForSource"] = (...args) =>
    this.activity.activityEventsForSource(...args);

  readonly activitySourceHealthMetrics: GovernanceApi["activitySourceHealthMetrics"] = (
    ...args
  ) => this.activity.activitySourceHealthMetrics(...args);

  readonly personalUsageSummary: GovernanceApi["personalUsageSummary"] = (...args) =>
    this.activity.personalUsageSummary(...args);

  readonly personalUsageDailyBuckets: GovernanceApi["personalUsageDailyBuckets"] = (...args) =>
    this.activity.personalUsageDailyBuckets(...args);

  readonly personalUsageBreakdownByModel: GovernanceApi["personalUsageBreakdownByModel"] = (
    ...args
  ) => this.activity.personalUsageBreakdownByModel(...args);

  readonly personalBudgetOverviewForUser: GovernanceApi["personalBudgetOverviewForUser"] = (
    ...args
  ) => this.activity.personalBudgetOverviewForUser(...args);

  readonly routingPolicyList: GovernanceApi["routingPolicyList"] = (...args) =>
    this.lifecycle.routingPolicyList(...args);

  readonly tryFindRoutingPolicyById: GovernanceApi["tryFindRoutingPolicyById"] = (...args) =>
    this.lifecycle.tryFindRoutingPolicyById(...args);

  readonly routingPolicyGetById: GovernanceApi["routingPolicyGetById"] = (...args) =>
    this.lifecycle.routingPolicyGetById(...args);

  readonly routingPolicyCreate: GovernanceApi["routingPolicyCreate"] = (...args) =>
    this.lifecycle.routingPolicyCreate(...args);

  readonly routingPolicyUpdate: GovernanceApi["routingPolicyUpdate"] = (...args) =>
    this.lifecycle.routingPolicyUpdate(...args);

  readonly routingPolicySetDefault: GovernanceApi["routingPolicySetDefault"] = (...args) =>
    this.lifecycle.routingPolicySetDefault(...args);

  readonly routingPolicyDelete: GovernanceApi["routingPolicyDelete"] = (...args) =>
    this.lifecycle.routingPolicyDelete(...args);

  readonly tryResolveDefaultRoutingPolicyForUser: GovernanceApi["tryResolveDefaultRoutingPolicyForUser"] =
    (...args) => this.lifecycle.tryResolveDefaultRoutingPolicyForUser(...args);

  readonly personalVirtualKeyEnsureDefault: GovernanceApi["personalVirtualKeyEnsureDefault"] = (
    ...args
  ) => this.lifecycle.personalVirtualKeyEnsureDefault(...args);

  readonly personalVirtualKeyIssue: GovernanceApi["personalVirtualKeyIssue"] = (...args) =>
    this.lifecycle.personalVirtualKeyIssue(...args);

  readonly personalVirtualKeyList: GovernanceApi["personalVirtualKeyList"] = (...args) =>
    this.lifecycle.personalVirtualKeyList(...args);

  readonly personalVirtualKeyRevoke: GovernanceApi["personalVirtualKeyRevoke"] = (...args) =>
    this.lifecycle.personalVirtualKeyRevoke(...args);

  readonly personalVirtualKeyRevokeAllForUser: GovernanceApi["personalVirtualKeyRevokeAllForUser"] =
    (...args) => this.lifecycle.personalVirtualKeyRevokeAllForUser(...args);

  readonly cliBootstrapResolve: GovernanceApi["cliBootstrapResolve"] = (...args) =>
    this.lifecycle.cliBootstrapResolve(...args);

  readonly cliSessionListForUser: GovernanceApi["cliSessionListForUser"] = (...args) =>
    this.lifecycle.cliSessionListForUser(...args);

  readonly cliSessionRevoke: GovernanceApi["cliSessionRevoke"] = (...args) =>
    this.lifecycle.cliSessionRevoke(...args);

  readonly cliTokenRevokeForUser: GovernanceApi["cliTokenRevokeForUser"] = (...args) =>
    this.lifecycle.cliTokenRevokeForUser(...args);

  readonly adminWorkspaceRecordView: GovernanceApi["adminWorkspaceRecordView"] = (...args) =>
    this.lifecycle.adminWorkspaceRecordView(...args);

  readonly quarantineFillEvaluate: GovernanceApi["quarantineFillEvaluate"] = (...args) =>
    this.lifecycle.quarantineFillEvaluate(...args);

  readonly resolveSetupState: GovernanceApi["resolveSetupState"] = (...args) =>
    this.lifecycle.resolveSetupState(...args);
}
