// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { GovernanceService } from "@langwatch/enterprise-governance-contract";
import type { ActivityMonitorService } from "./ingestion-source-activity.service";
import type { DefaultGovernancePersonalUsageService } from "./personal-usage.service";
import type { GovernanceBudgetOverviewPort } from "../ports/governance-budget-overview.port";

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

  readonly activitySummary: GovernanceService["activitySummary"] = (...args) =>
    this.activity.summary(...args);

  readonly activitySpendByUser: GovernanceService["activitySpendByUser"] = (...args) =>
    this.activity.spendByUser(...args);

  readonly activitySpendByTeam: GovernanceService["activitySpendByTeam"] = (...args) =>
    this.activity.spendByTeam(...args);

  readonly activitySpendByDepartment: GovernanceService["activitySpendByDepartment"] = (...args) =>
    this.activity.spendByDepartment(...args);

  readonly activitySpendOverTime: GovernanceService["activitySpendOverTime"] = (...args) =>
    this.activity.spendOverTime(...args);

  readonly activityRecentAnomalies: GovernanceService["activityRecentAnomalies"] = (...args) =>
    this.activity.recentAnomalies(...args);

  readonly activityIngestionSourcesHealth: GovernanceService["activityIngestionSourcesHealth"] = (
    ...args
  ) => this.activity.ingestionSourcesHealth(...args);

  readonly activityEventsForSource: GovernanceService["activityEventsForSource"] = (...args) =>
    this.activity.eventsForSource(...args);

  readonly activitySourceHealthMetrics: GovernanceService["activitySourceHealthMetrics"] = (
    ...args
  ) => this.activity.sourceHealthMetrics(...args);

  readonly personalUsageSummary: GovernanceService["personalUsageSummary"] = (...args) =>
    this.personalUsage.summary(...args);

  readonly personalUsageDailyBuckets: GovernanceService["personalUsageDailyBuckets"] = (...args) =>
    this.personalUsage.dailyBuckets(...args);

  readonly personalUsageBreakdownByModel: GovernanceService["personalUsageBreakdownByModel"] = (
    ...args
  ) => this.personalUsage.breakdownByModel(...args);

  readonly personalBudgetOverviewForUser: GovernanceService["personalBudgetOverviewForUser"] = (
    ...args
  ) => this.budgetOverview.overviewForUser(...args);
}
