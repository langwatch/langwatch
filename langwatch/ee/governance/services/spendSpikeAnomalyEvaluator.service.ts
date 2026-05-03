// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * SpendSpikeAnomalyEvaluator — evaluates spend_spike AnomalyRules
 * against the governance_kpis fold (3b) and creates AnomalyAlert
 * rows in Postgres when thresholds are exceeded.
 *
 * Spec: specs/ai-gateway/governance/anomaly-rules.feature +
 *       specs/ai-gateway/governance/anomaly-detection.feature
 *
 * Threshold config shape (per-rule-type schema, stored as Json on
 * AnomalyRule.thresholdConfig):
 *
 *   spend_spike: {
 *     windowSec: number,         // e.g. 3600 = last 1 hour
 *     ratioVsBaseline: number,   // e.g. 2.0 = current ≥ 2× baseline
 *     minBaselineUsd: number,    // e.g. 1.0 = don't fire on tiny baselines
 *   }
 *
 * Algorithm:
 *   1. Current window: sum SpendUsd from governance_kpis for the
 *      last windowSec. Filter by rule.scope/scopeId.
 *   2. Baseline window: sum SpendUsd from the 6 prior windows of
 *      same windowSec width. Average per-window.
 *   3. If baseline < minBaselineUsd → skip (signal is too small).
 *   4. If current ≥ baseline × ratioVsBaseline → fire AnomalyAlert.
 *   5. Dedup: don't re-fire if an open AnomalyAlert exists for the
 *      same rule whose triggerWindowEnd is within the current window.
 *
 * Log-only dispatch: alerts land as AnomalyAlert rows in Postgres.
 * Slack / PagerDuty / email / webhook destinations are tracked C3
 * follow-up (per the license-split decision — alert destinations
 * are ee/-only).
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { AnomalyRule, PrismaClient } from "@prisma/client";
import type { Prisma } from "@prisma/client";

import { getClickHouseClientForOrganization } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";
import { AnomalyAlertDispatcherService } from "./activity-monitor/anomalyAlertDispatcher.service";
import { safeParseSpendSpikeThresholdConfig } from "./activity-monitor/thresholdConfig.schema";
import { PROJECT_KIND } from "./governanceProject.service";

const logger = createLogger(
  "langwatch:governance:spend-spike-anomaly-evaluator",
);

export interface SpendSpikeThresholdConfig {
  windowSec: number;
  ratioVsBaseline: number;
  minBaselineUsd: number;
}

export const DEFAULT_SPEND_SPIKE_CONFIG: SpendSpikeThresholdConfig = {
  windowSec: 3600,
  ratioVsBaseline: 2.0,
  minBaselineUsd: 1.0,
};

const BASELINE_WINDOWS = 6; // average over previous 6 windows

export interface SpendSpikeEvaluationResult {
  ruleId: string;
  organizationId: string;
  decision:
    | "fire"
    | "skip_below_baseline"
    | "skip_below_threshold"
    | "skip_dedup"
    | "skip_no_data"
    | "skip_invalid_config";
  reason: string;
  currentSpendUsd: number;
  baselineSpendUsd: number;
  windowStart: Date;
  windowEnd: Date;
}

/**
 * Pure-function evaluator: given the per-window spend numbers, decides
 * whether to fire. Separated from I/O so it's trivially unit-testable.
 */
export function evaluateSpendSpike(input: {
  ruleId: string;
  organizationId: string;
  config: SpendSpikeThresholdConfig;
  currentSpendUsd: number;
  baselineSpendUsd: number;
  hasOpenAlertInWindow: boolean;
  windowStart: Date;
  windowEnd: Date;
}): SpendSpikeEvaluationResult {
  const base = {
    ruleId: input.ruleId,
    organizationId: input.organizationId,
    currentSpendUsd: input.currentSpendUsd,
    baselineSpendUsd: input.baselineSpendUsd,
    windowStart: input.windowStart,
    windowEnd: input.windowEnd,
  };

  if (input.hasOpenAlertInWindow) {
    return {
      ...base,
      decision: "skip_dedup",
      reason:
        "Existing open alert for this rule covers the current window — not re-firing.",
    };
  }

  if (input.baselineSpendUsd < input.config.minBaselineUsd) {
    return {
      ...base,
      decision: "skip_below_baseline",
      reason: `Baseline ${input.baselineSpendUsd.toFixed(4)} USD < minBaselineUsd ${input.config.minBaselineUsd} — signal too small to trigger.`,
    };
  }

  const threshold = input.baselineSpendUsd * input.config.ratioVsBaseline;
  if (input.currentSpendUsd < threshold) {
    return {
      ...base,
      decision: "skip_below_threshold",
      reason: `Current ${input.currentSpendUsd.toFixed(4)} USD < threshold ${threshold.toFixed(4)} USD (baseline ${input.baselineSpendUsd.toFixed(4)} × ratio ${input.config.ratioVsBaseline}).`,
    };
  }

  return {
    ...base,
    decision: "fire",
    reason: `Current ${input.currentSpendUsd.toFixed(4)} USD ≥ threshold ${threshold.toFixed(4)} USD (baseline ${input.baselineSpendUsd.toFixed(4)} × ratio ${input.config.ratioVsBaseline}).`,
  };
}

/**
 * I/O layer: queries governance_kpis + prisma.anomalyAlert + writes
 * the alert row when the pure evaluator says fire.
 */
export class SpendSpikeAnomalyEvaluator {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly dispatcher: AnomalyAlertDispatcherService = AnomalyAlertDispatcherService.create(),
  ) {}

  static create(prisma: PrismaClient): SpendSpikeAnomalyEvaluator {
    return new SpendSpikeAnomalyEvaluator(prisma);
  }

  async evaluateAll(input: { now?: Date } = {}): Promise<{
    rulesEvaluated: number;
    alertsFired: number;
    skipped: Record<string, number>;
  }> {
    const now = input.now ?? new Date();
    const rules = await this.prisma.anomalyRule.findMany({
      where: {
        ruleType: "spend_spike",
        archivedAt: null,
        status: "active",
      },
    });

    const skipped: Record<string, number> = {};
    let alertsFired = 0;

    for (const rule of rules) {
      try {
        const result = await this.evaluateRule(rule, now);
        if (result.decision === "fire") {
          await this.persistAlert(rule, result);
          alertsFired += 1;
        } else {
          skipped[result.decision] = (skipped[result.decision] ?? 0) + 1;
        }
      } catch (error) {
        logger.error(
          {
            ruleId: rule.id,
            organizationId: rule.organizationId,
            error: error instanceof Error ? error.message : String(error),
          },
          "spend_spike rule evaluation failed",
        );
      }
    }

    return { rulesEvaluated: rules.length, alertsFired, skipped };
  }

  private async evaluateRule(
    rule: AnomalyRule,
    now: Date,
  ): Promise<SpendSpikeEvaluationResult> {
    // Strict validation. Stale rows that pre-date the schema (Phase 2C
    // structured threshold-config) are quarantined: skipped + warning
    // logged so the misconfiguration surfaces in observability instead
    // of silently substituting DEFAULT_SPEND_SPIKE_CONFIG and firing on
    // the wrong threshold. Spec:
    // specs/ai-gateway/governance/anomaly-rule-threshold-schema.feature.
    const parsed = safeParseSpendSpikeThresholdConfig(rule.thresholdConfig);
    if (!parsed.ok) {
      logger.warn(
        {
          ruleId: rule.id,
          organizationId: rule.organizationId,
          ruleType: rule.ruleType,
          issues: parsed.error.issues.map((i) => ({
            path: i.path.join("."),
            message: i.message,
          })),
        },
        "spend_spike rule has invalid thresholdConfig — skipping evaluation. Re-save the rule from the admin UI to repair, or archive it.",
      );
      return {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        decision: "skip_invalid_config",
        reason:
          "thresholdConfig failed strict validation — see logged issues; rule is quarantined until repaired",
        currentSpendUsd: 0,
        baselineSpendUsd: 0,
        windowStart: now,
        windowEnd: now,
      };
    }
    const config = parsed.data;
    const windowMs = config.windowSec * 1000;
    const windowEnd = now;
    const windowStart = new Date(now.getTime() - windowMs);
    const baselineStart = new Date(
      windowStart.getTime() - BASELINE_WINDOWS * windowMs,
    );

    const govProjectId = await this.resolveGovProjectId(rule.organizationId);
    if (!govProjectId) {
      return {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        decision: "skip_no_data",
        reason:
          "Organization has no internal_governance Project — no governance ingest yet.",
        currentSpendUsd: 0,
        baselineSpendUsd: 0,
        windowStart,
        windowEnd,
      };
    }

    const ch = await getClickHouseClientForOrganization(rule.organizationId);
    if (!ch) {
      return {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        decision: "skip_no_data",
        reason: "ClickHouse not configured for this organization.",
        currentSpendUsd: 0,
        baselineSpendUsd: 0,
        windowStart,
        windowEnd,
      };
    }

    const { currentSpend, baselineSpend } = await this.queryGovernanceKpis({
      ch,
      tenantId: govProjectId,
      windowStart,
      windowEnd,
      baselineStart,
      sourceFilter: buildSourceFilter(rule),
    });

    const baselineAverage = baselineSpend / BASELINE_WINDOWS;

    const hasOpenAlertInWindow =
      (await this.prisma.anomalyAlert.count({
        where: {
          ruleId: rule.id,
          state: "open",
          triggerWindowEnd: { gte: windowStart },
        },
      })) > 0;

    return evaluateSpendSpike({
      ruleId: rule.id,
      organizationId: rule.organizationId,
      config,
      currentSpendUsd: currentSpend,
      baselineSpendUsd: baselineAverage,
      hasOpenAlertInWindow,
      windowStart,
      windowEnd,
    });
  }

  private async resolveGovProjectId(
    organizationId: string,
  ): Promise<string | null> {
    const project = await this.prisma.project.findFirst({
      where: {
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
        team: { organizationId },
        archivedAt: null,
      },
      select: { id: true },
    });
    return project?.id ?? null;
  }

  private async queryGovernanceKpis(input: {
    ch: ClickHouseClient;
    tenantId: string;
    windowStart: Date;
    windowEnd: Date;
    baselineStart: Date;
    sourceFilter: { sql: string; params: Record<string, unknown> };
  }): Promise<{ currentSpend: number; baselineSpend: number }> {
    const result = await input.ch.query({
      query: `
        SELECT
          sumIf(SpendUsd, HourBucket >= fromUnixTimestamp64Milli({windowStartMs:UInt64})) AS currentSpend,
          sumIf(SpendUsd, HourBucket < fromUnixTimestamp64Milli({windowStartMs:UInt64}) AND HourBucket >= fromUnixTimestamp64Milli({baselineStartMs:UInt64})) AS baselineSpend
        FROM governance_kpis
        WHERE TenantId = {tenantId:String}
          AND HourBucket >= fromUnixTimestamp64Milli({baselineStartMs:UInt64})
          AND HourBucket < fromUnixTimestamp64Milli({windowEndMs:UInt64})
          ${input.sourceFilter.sql}
      `,
      query_params: {
        tenantId: input.tenantId,
        windowStartMs: input.windowStart.getTime(),
        windowEndMs: input.windowEnd.getTime(),
        baselineStartMs: input.baselineStart.getTime(),
        ...input.sourceFilter.params,
      },
      format: "JSONEachRow",
    });
    const rows = (await result.json()) as Array<{
      currentSpend: number | string | null;
      baselineSpend: number | string | null;
    }>;
    const row = rows[0];
    return {
      currentSpend: Number(row?.currentSpend ?? 0),
      baselineSpend: Number(row?.baselineSpend ?? 0),
    };
  }

  private async persistAlert(
    rule: AnomalyRule,
    result: SpendSpikeEvaluationResult,
  ): Promise<void> {
    // Persist the alert FIRST so the authoritative signal lands
    // regardless of dispatch outcome. Dispatch is best-effort
    // observability layered on top — see C3 contract:
    // specs/ai-gateway/governance/c3-alert-dispatch.feature.
    const alert = await this.prisma.anomalyAlert.create({
      data: {
        organizationId: rule.organizationId,
        ruleId: rule.id,
        severity: rule.severity,
        ruleName: rule.name,
        ruleType: rule.ruleType,
        triggerWindowStart: result.windowStart,
        triggerWindowEnd: result.windowEnd,
        triggerSpendUsd: result.currentSpendUsd,
        triggerEventCount: null,
        detail: {
          baselineSpendUsd: result.baselineSpendUsd,
          windowSec:
            (result.windowEnd.getTime() - result.windowStart.getTime()) / 1000,
          reason: result.reason,
          // Filled in by the dispatch step below; kept as a
          // placeholder so partial reads (e.g. concurrent dashboard
          // queries between persist + dispatch) see something
          // sensible instead of the field being absent.
          dispatch: "pending",
        },
        state: "open",
      },
    });
    logger.info(
      {
        ruleId: rule.id,
        organizationId: rule.organizationId,
        currentSpendUsd: result.currentSpendUsd,
        baselineSpendUsd: result.baselineSpendUsd,
      },
      "spend_spike anomaly fired",
    );

    // Dispatch fan-out (C3). Failures here are logged + recorded in
    // the alert's detail.dispatch but never propagate up — the
    // evaluator stays log-only-equivalent on permanent webhook
    // failures.
    let dispatchTag = "log_only";
    let dispatchOutcomes: Prisma.InputJsonValue = [];
    try {
      const dispatchResult = await this.dispatcher.dispatchAlert({ rule, alert });
      dispatchTag = dispatchResult.dispatchTag;
      dispatchOutcomes = dispatchResult.outcomes as unknown as Prisma.InputJsonValue;
    } catch (err) {
      logger.error(
        {
          ruleId: rule.id,
          alertId: alert.id,
          error: err instanceof Error ? err.message : String(err),
        },
        "anomaly alert dispatcher threw unexpectedly — alert is persisted, dispatch state recorded as failed",
      );
      dispatchTag = "failed_dispatcher_error";
    }

    // Patch the alert detail with the dispatch result so the dashboard
    // / audit trail reflects the actual outcome.
    await this.prisma.anomalyAlert.update({
      where: { id: alert.id },
      data: {
        detail: {
          ...(alert.detail as Record<string, unknown>),
          dispatch: dispatchTag,
          dispatchOutcomes,
        },
      },
    });
  }
}

/**
 * Per-rule-scope filter on the governance_kpis query. Note: the
 * governance_kpis fold is keyed on (TenantId, SourceId, HourBucket)
 * so filtering by source is direct; org/team/project scope is implicit
 * via the TenantId predicate (every governance trace lands on the
 * org's hidden Gov Project).
 */
function buildSourceFilter(rule: AnomalyRule): {
  sql: string;
  params: Record<string, unknown>;
} {
  if (rule.scope === "source") {
    return {
      sql: "AND SourceId = {sourceId:String}",
      params: { sourceId: rule.scopeId },
    };
  }
  if (rule.scope === "source_type") {
    return {
      sql: "AND SourceType = {sourceType:String}",
      params: { sourceType: rule.scopeId },
    };
  }
  // organization / team / project all reduce to "all sources for this
  // tenant" since the org's hidden Gov Project IS the tenant.
  return { sql: "", params: {} };
}
