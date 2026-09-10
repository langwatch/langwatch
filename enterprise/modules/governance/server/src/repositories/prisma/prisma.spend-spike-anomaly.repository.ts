import {
  anomalyRuleSchema,
  type AnomalyAlertDispatchRecord,
  type AnomalyRule,
  type SpendSpikeEvaluationResult,
} from "@langwatch/enterprise-governance-contract";
import type { Prisma, PrismaClient } from "@langwatch/prisma-client/generated";
import { SpendSpikeAnomalyRepository } from "../policy/spend-spike-anomaly.repository.ts";
import { toDate, type Instant } from "@langwatch/time";

const GOVERNANCE_PROJECT_KIND = "internal_governance";

/**
 * Only what this repository touches, so composition names the slice it needs
 * rather than the whole generated client.
 */
export type SpendSpikeAnomalyDatabase = Pick<
  PrismaClient,
  "anomalyAlert" | "anomalyRule" | "project"
>;

export class PrismaSpendSpikeAnomalyRepository extends SpendSpikeAnomalyRepository {
  private constructor(private readonly prisma: SpendSpikeAnomalyDatabase) {
    super();
  }

  static create(database: SpendSpikeAnomalyDatabase): PrismaSpendSpikeAnomalyRepository {
    return new PrismaSpendSpikeAnomalyRepository(database);
  }

  async listActiveRules(): Promise<AnomalyRule[]> {
    const rows = await this.prisma.anomalyRule.findMany({
      where: {
        ruleType: "spend_spike",
        archivedAt: null,
        status: "active",
      },
    });
    return rows.map((row) => anomalyRuleSchema.parse(row));
  }

  async findGovernanceTenantId(organizationId: string): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: {
        kind: GOVERNANCE_PROJECT_KIND,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    return project?.id ?? null;
  }

  async hasOpenAlert(input: { ruleId: string; since: Instant }): Promise<boolean> {
    return (
      (await this.prisma.anomalyAlert.count({
        where: {
          ruleId: input.ruleId,
          state: "open",
          triggerWindowEnd: { gte: toDate(input.since) },
        },
      })) > 0
    );
  }

  async createAlert(input: {
    rule: AnomalyRule;
    result: SpendSpikeEvaluationResult;
  }): Promise<AnomalyAlertDispatchRecord> {
    const detail = {
      baselineSpendUsd: input.result.baselineSpendUsd,
      windowSec: (input.result.windowEnd.getTime() - input.result.windowStart.getTime()) / 1_000,
      reason: input.result.reason,
      dispatch: "pending",
    };
    const alert = await this.prisma.anomalyAlert.create({
      data: {
        organizationId: input.rule.organizationId,
        ruleId: input.rule.id,
        severity: input.rule.severity,
        ruleName: input.rule.name,
        ruleType: input.rule.ruleType,
        triggerWindowStart: input.result.windowStart,
        triggerWindowEnd: input.result.windowEnd,
        triggerSpendUsd: input.result.currentSpendUsd,
        triggerEventCount: null,
        detail,
        state: "open",
      },
    });
    return {
      id: alert.id,
      triggerWindowStart: alert.triggerWindowStart,
      triggerWindowEnd: alert.triggerWindowEnd,
      triggerSpendUsd: alert.triggerSpendUsd?.toString() ?? null,
      triggerEventCount: alert.triggerEventCount,
      detail: alert.detail,
      detectedAt: alert.detectedAt,
    };
  }

  async recordDispatch(input: { alertId: string; detail: Record<string, unknown> }): Promise<void> {
    await this.prisma.anomalyAlert.update({
      where: { id: input.alertId },
      data: { detail: input.detail as Prisma.InputJsonValue },
    });
  }
}
