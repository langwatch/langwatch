/**
 * anomalyDetection reactor — fires after the activityEventStorage map
 * projection writes a row to gateway_activity_events. Loads applicable
 * AnomalyRule rows for the event's org+scope, evaluates the per-rule
 * threshold against the current event stream, and upserts AnomalyAlert
 * rows when a rule trips.
 *
 * v1 scope: only `spend_spike` rule type. Other rule types
 * (`after_hours`, `rate_limit`, …) are recognised but skipped — they
 * ship in follow-up reactor slices. Dispatch is log-only in this slice
 * (C3 adds Slack / SIEM / webhook / PagerDuty / email destinations
 * via the shared triggerActionDispatch helper from PR #3351).
 *
 * Spec: specs/ai-gateway/governance/anomaly-detection.feature
 *
 * Dedup is structural via AnomalyAlert's @@unique([ruleId,
 * triggerWindowStart]) — re-evaluating the same window upserts the
 * existing row rather than spawning duplicates.
 */
import type { AnomalyRule, PrismaClient } from "@prisma/client";
import { Prisma } from "@prisma/client";

import type { ClickHouseClientResolver } from "~/server/clickhouse/clickhouseClient";
import { createLogger } from "~/utils/logger/server";

import type { ReactorDefinition } from "../../../reactors/reactor.types";
import type { ActivityMonitorProcessingEvent } from "../schemas/events";

const logger = createLogger(
  "langwatch:activity-monitor:anomaly-detection-reactor",
);

export interface AnomalyDetectionReactorDeps {
  prisma: PrismaClient;
  resolveClickHouseClient: ClickHouseClientResolver | null;
}

interface SpendSpikeConfig {
  /** Window length in seconds. Default 24h. */
  windowSec?: number;
  /** Ratio threshold of current/baseline. Default 2.0 (2x). */
  ratioVsBaseline?: number;
  /** Minimum baseline spend in USD to trigger. Default 1.00. */
  minBaselineUsd?: number;
  /** Baseline reference window offset (seconds ago). Default 7d. */
  baselineOffsetSec?: number;
}

const DEFAULT_WINDOW_SEC = 24 * 60 * 60;
const DEFAULT_RATIO = 2.0;
const DEFAULT_MIN_BASELINE = 1.0;
const DEFAULT_BASELINE_OFFSET_SEC = 7 * 24 * 60 * 60;

export function createAnomalyDetectionReactor(
  deps: AnomalyDetectionReactorDeps,
): ReactorDefinition<ActivityMonitorProcessingEvent> {
  return {
    name: "anomalyDetection",
    options: {
      runIn: ["worker"],
      makeJobId: (payload) =>
        `anomaly-detection:${payload.event.tenantId}:${payload.event.aggregateId}`,
      // Same event won't re-evaluate within 60s. Keeps the reactor
      // cheap under burst traffic — the rule's own dedup
      // (ruleId, triggerWindowStart) catches in-window collapses.
      ttl: 60_000,
    },

    async handle(event: ActivityMonitorProcessingEvent): Promise<void> {
      if (event.type !== "lw.activity_event.received") return;

      const data = event.data;
      const orgId = data.organizationId;

      const rules = await deps.prisma.anomalyRule.findMany({
        where: {
          organizationId: orgId,
          status: "active",
          archivedAt: null,
          OR: [
            { scope: "organization", scopeId: orgId },
            { scope: "source", scopeId: data.sourceId },
            { scope: "source_type", scopeId: data.sourceType },
          ],
        },
      });

      if (rules.length === 0) return;

      for (const rule of rules) {
        try {
          if (rule.ruleType === "spend_spike") {
            await evaluateSpendSpike({
              rule,
              orgId,
              prisma: deps.prisma,
              resolveClickHouseClient: deps.resolveClickHouseClient,
            });
          } else {
            // Recognised but not yet implemented (after_hours,
            // rate_limit, tool_mismatch, unusual_model, pii_leak,
            // custom). Each ships in its own reactor slice.
            logger.debug(
              { ruleId: rule.id, ruleType: rule.ruleType },
              "rule type not yet evaluated by anomaly reactor (v1: spend_spike only)",
            );
          }
        } catch (err) {
          logger.error(
            { ruleId: rule.id, err: String(err) },
            "anomaly rule evaluation failed",
          );
        }
      }
    },
  };
}

interface SpendSpikeContext {
  rule: AnomalyRule;
  orgId: string;
  prisma: PrismaClient;
  resolveClickHouseClient: ClickHouseClientResolver | null;
}

async function evaluateSpendSpike({
  rule,
  orgId,
  prisma,
  resolveClickHouseClient,
}: SpendSpikeContext): Promise<void> {
  if (!resolveClickHouseClient) return;
  const cfg = parseSpendSpikeConfig(rule.thresholdConfig);

  const now = Date.now();
  const windowStart = now - cfg.windowSec * 1000;
  const baselineEnd = now - cfg.baselineOffsetSec * 1000;
  const baselineStart = baselineEnd - cfg.windowSec * 1000;

  const client = await resolveClickHouseClient(orgId);

  // Current-window spend and baseline-window spend in one query — both
  // scoped to the rule's org via OrganizationId. Scope further if the
  // rule is source/source_type-narrowed (org-wide rules don't add an
  // extra filter).
  const scopeFilter = buildScopeFilter(rule);
  const result = await client.query({
    query: `
      SELECT
        coalesce(sum(if(EventTimestamp >= toDateTime64({windowStart:String}, 3), CostUSD, 0)), 0) AS current_spend,
        coalesce(sum(if(EventTimestamp >= toDateTime64({baselineStart:String}, 3) AND EventTimestamp < toDateTime64({baselineEnd:String}, 3), CostUSD, 0)), 0) AS baseline_spend,
        countIf(EventTimestamp >= toDateTime64({windowStart:String}, 3)) AS current_events
      FROM gateway_activity_events
      WHERE OrganizationId = {orgId:String}
        AND EventTimestamp >= toDateTime64({baselineStart:String}, 3)
        ${scopeFilter.clause}
    `,
    query_params: {
      orgId,
      windowStart: msToClickhouseTime(windowStart),
      baselineStart: msToClickhouseTime(baselineStart),
      baselineEnd: msToClickhouseTime(baselineEnd),
      ...scopeFilter.params,
    },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{
    current_spend: string | number;
    baseline_spend: string | number;
    current_events: string | number;
  }>;
  const row = rows[0];
  if (!row) return;

  const currentSpend = Number(row.current_spend) || 0;
  const baselineSpend = Number(row.baseline_spend) || 0;
  const currentEvents = Number(row.current_events) || 0;

  if (baselineSpend < cfg.minBaselineUsd) {
    // Baseline too small — not a meaningful spike to alert on.
    return;
  }
  const ratio = currentSpend / baselineSpend;
  if (ratio < cfg.ratioVsBaseline) return;

  // Trigger. Upsert AnomalyAlert keyed by (ruleId, triggerWindowStart)
  // so re-evaluations within the same window collapse into one row.
  const triggerWindowStart = new Date(windowStart);
  const triggerWindowEnd = new Date(now);

  const alert = await prisma.anomalyAlert.upsert({
    where: {
      ruleId_triggerWindowStart: {
        ruleId: rule.id,
        triggerWindowStart,
      },
    },
    create: {
      organizationId: orgId,
      ruleId: rule.id,
      severity: rule.severity,
      ruleName: rule.name,
      ruleType: rule.ruleType,
      triggerWindowStart,
      triggerWindowEnd,
      triggerSpendUsd: new Prisma.Decimal(currentSpend.toFixed(6)),
      triggerEventCount: currentEvents,
      detail: {
        currentSpendUsd: currentSpend,
        baselineSpendUsd: baselineSpend,
        ratio,
        ratioThreshold: cfg.ratioVsBaseline,
        minBaselineUsd: cfg.minBaselineUsd,
        windowSec: cfg.windowSec,
      } as Prisma.InputJsonValue,
      state: "open",
    },
    update: {
      triggerWindowEnd,
      triggerSpendUsd: new Prisma.Decimal(currentSpend.toFixed(6)),
      triggerEventCount: currentEvents,
      detail: {
        currentSpendUsd: currentSpend,
        baselineSpendUsd: baselineSpend,
        ratio,
        ratioThreshold: cfg.ratioVsBaseline,
        minBaselineUsd: cfg.minBaselineUsd,
        windowSec: cfg.windowSec,
      } as Prisma.InputJsonValue,
    },
  });

  // Log-only dispatch (C3 adds Slack / SIEM / webhook / PagerDuty /
  // email via the shared triggerActionDispatch helper).
  logger.warn(
    {
      alertId: alert.id,
      ruleId: rule.id,
      ruleName: rule.name,
      severity: rule.severity,
      ruleType: rule.ruleType,
      orgId,
      currentSpendUsd: currentSpend,
      baselineSpendUsd: baselineSpend,
      ratio,
    },
    "[anomaly] spend_spike rule fired",
  );
}

function parseSpendSpikeConfig(raw: unknown): Required<SpendSpikeConfig> {
  const cfg = (raw as SpendSpikeConfig) ?? {};
  return {
    windowSec: cfg.windowSec ?? DEFAULT_WINDOW_SEC,
    ratioVsBaseline: cfg.ratioVsBaseline ?? DEFAULT_RATIO,
    minBaselineUsd: cfg.minBaselineUsd ?? DEFAULT_MIN_BASELINE,
    baselineOffsetSec: cfg.baselineOffsetSec ?? DEFAULT_BASELINE_OFFSET_SEC,
  };
}

function buildScopeFilter(rule: AnomalyRule): {
  clause: string;
  params: Record<string, string>;
} {
  switch (rule.scope) {
    case "source":
      return {
        clause: "AND TenantId = {sourceId:String}",
        params: { sourceId: rule.scopeId },
      };
    case "source_type":
      return {
        clause: "AND SourceType = {sourceType:String}",
        params: { sourceType: rule.scopeId },
      };
    case "organization":
    default:
      // org-wide: no additional filter beyond OrganizationId.
      return { clause: "", params: {} };
  }
}

function msToClickhouseTime(ms: number): string {
  return new Date(ms).toISOString().replace("T", " ").replace("Z", "");
}
