// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceApi } from "@langwatch/enterprise-governance-contract";
import type { ActivityMonitorService } from "./ingestion-source-activity.service.ts";
import type { DefaultGovernancePersonalUsageService } from "./personal-usage.service.ts";
import type { GovernanceBudgetOverviewPort } from "../ports/governance-budget-overview.port.ts";

/** Private cohesive collaborator for the activity operation set. */
export class GovernanceActivityOperationsService {
  private constructor(
    private readonly activity: ActivityMonitorService,
    private readonly personalUsage: DefaultGovernancePersonalUsageService,
    private readonly budgetOverview: GovernanceBudgetOverviewPort,
  ) {}

  static create(
    activity: ActivityMonitorService,
    personalUsage: DefaultGovernancePersonalUsageService,
    budgetOverview: GovernanceBudgetOverviewPort,
  ): GovernanceActivityOperationsService {
    return new GovernanceActivityOperationsService(activity, personalUsage, budgetOverview);
  }

  readonly activitySummary: GovernanceApi["activitySummary"] = (...args) =>
    this.activity.summary(...args);

  readonly activitySpendByUser: GovernanceApi["activitySpendByUser"] = (...args) =>
    this.activity.spendByUser(...args);

  readonly activitySpendByTeam: GovernanceApi["activitySpendByTeam"] = (...args) =>
    this.activity.spendByTeam(...args);

  readonly activitySpendByDepartment: GovernanceApi["activitySpendByDepartment"] = (...args) =>
    this.activity.spendByDepartment(...args);

  readonly activitySpendOverTime: GovernanceApi["activitySpendOverTime"] = (...args) =>
    this.activity.spendOverTime(...args);

  readonly activityRecentAnomalies: GovernanceApi["activityRecentAnomalies"] = (...args) =>
    this.activity.recentAnomalies(...args);

  readonly activityIngestionSourcesHealth: GovernanceApi["activityIngestionSourcesHealth"] = (
    ...args
  ) => this.activity.ingestionSourcesHealth(...args);

  readonly activityEventsForSource: GovernanceApi["activityEventsForSource"] = (...args) =>
    this.activity.eventsForSource(...args);

  readonly activitySourceHealthMetrics: GovernanceApi["activitySourceHealthMetrics"] = (
    ...args
  ) => this.activity.sourceHealthMetrics(...args);

  readonly personalUsageSummary: GovernanceApi["personalUsageSummary"] = (...args) =>
    this.personalUsage.summary(...args);

  readonly personalUsageDailyBuckets: GovernanceApi["personalUsageDailyBuckets"] = (...args) =>
    this.personalUsage.dailyBuckets(...args);

  readonly personalUsageBreakdownByModel: GovernanceApi["personalUsageBreakdownByModel"] = (
    ...args
  ) => this.personalUsage.breakdownByModel(...args);

  readonly personalBudgetOverviewForUser: GovernanceApi["personalBudgetOverviewForUser"] = (
    ...args
  ) => this.budgetOverview.overviewForUser(...args);
}
