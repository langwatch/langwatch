/**
 * SpendSpikeAnomalyEvaluator — I/O integration test.
 *
 * Sergey commit 3d2404170 (step 3e-i) shipped the evaluator service.
 * The pure decision logic is covered in
 * `spendSpikeAnomalyEvaluator.unit.test.ts`; this test exercises the
 * I/O orchestration layer end-to-end:
 *   governance_kpis fold (CH read) → rule match → AnomalyAlert persist
 *   → dedup invariant on re-tick → scope filter on a mismatched source.
 *
 * Test isolation strategy: seeds CH governance_kpis rows directly
 * (no fold reactor, no async pipeline delays) so the test stays
 * deterministic + sub-second. The reactor that populates
 * governance_kpis is covered separately in 3b-iii integration tests.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/anomaly-rules.feature
 *   - specs/ai-gateway/governance/anomaly-detection.feature
 *
 * Pairs with:
 *   - spendSpikeAnomalyEvaluator.unit.test.ts (pure decision logic)
 *   - 3e-ii anomalyDetectionWorker (BullMQ orchestrator, separate test)
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Organization, Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing/__tests__/integration/testContainers";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";
import { SpendSpikeAnomalyEvaluator } from "../spendSpikeAnomalyEvaluator.service";

interface SeedKpiRow {
  sourceId: string;
  sourceType: string;
  hourBucket: Date;
  spendUsd: number;
  promptTokens: number;
  completionTokens: number;
  traceId?: string;
}

async function insertGovernanceKpiRow(
  ch: ClickHouseClient,
  tenantId: string,
  row: SeedKpiRow,
): Promise<void> {
  await ch.insert({
    table: "governance_kpis",
    values: [
      {
        TenantId: tenantId,
        SourceId: row.sourceId,
        HourBucket: row.hourBucket,
        TraceId: row.traceId ?? `tr-${nanoid()}`,
        SourceType: row.sourceType,
        SpendUsd: row.spendUsd,
        PromptTokens: row.promptTokens,
        CompletionTokens: row.completionTokens,
        LastEventOccurredAt: row.hourBucket,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

describe("SpendSpikeAnomalyEvaluator — I/O integration against governance_kpis + AnomalyAlert", () => {
  const namespace = `spend-spike-${nanoid(8)}`;
  let ch: ClickHouseClient;
  let org: Organization;
  let govProject: Project;
  let primarySourceId: string;
  let unrelatedSourceId: string;
  /** Fixed evaluation moment — windowStart = NOW - 1h, baselineStart = NOW - 7h. */
  const NOW = new Date("2026-04-29T12:00:00Z");

  beforeAll(async () => {
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) {
      throw new Error("ClickHouse test container not available");
    }
    ch = maybeCh;

    org = await prisma.organization.create({
      data: {
        name: `Spend Spike Org ${namespace}`,
        slug: `spend-spike-org-${namespace}`,
      },
    });
    await prisma.team.create({
      data: {
        name: `Spend Spike Team ${namespace}`,
        slug: `spend-spike-team-${namespace}`,
        organizationId: org.id,
      },
    });
    govProject = await ensureHiddenGovernanceProject(prisma, org.id);

    primarySourceId = `is-primary-${nanoid()}`;
    unrelatedSourceId = `is-unrelated-${nanoid()}`;

    // Current window: NOW - 1h .. NOW. One trace, $10 spend, well above
    // any 2x baseline threshold given the seeded baseline.
    const inCurrentWindow = new Date(NOW.getTime() - 30 * 60 * 1000); // T-30min
    await insertGovernanceKpiRow(ch, govProject.id, {
      sourceId: primarySourceId,
      sourceType: "otel_generic",
      hourBucket: inCurrentWindow,
      spendUsd: 10.0,
      promptTokens: 1000,
      completionTokens: 500,
    });

    // Baseline windows: 6 hours of $1.00 spend each. Total $6, average
    // per window = $1. Threshold = baseline ($1) * default ratio (2.0)
    // = $2. Current ($10) ≥ $2 → fire.
    for (let i = 1; i <= 6; i++) {
      const baselineHour = new Date(
        NOW.getTime() - (60 + i * 60) * 60 * 1000,
      ); // T-2h, T-3h, … T-7h
      await insertGovernanceKpiRow(ch, govProject.id, {
        sourceId: primarySourceId,
        sourceType: "otel_generic",
        hourBucket: baselineHour,
        spendUsd: 1.0,
        promptTokens: 100,
        completionTokens: 50,
      });
    }
  });

  afterAll(async () => {
    await prisma.anomalyAlert
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.anomalyRule
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.project
      .deleteMany({ where: { id: govProject.id } })
      .catch(() => undefined);
    await prisma.team
      .deleteMany({ where: { organizationId: org.id } })
      .catch(() => undefined);
    await prisma.organization
      .deleteMany({ where: { id: org.id } })
      .catch(() => undefined);
    // governance_kpis is not in cleanupTestData's truncate set; clean it
    // manually for the tenants this test seeded.
    await ch
      .exec({
        query: `ALTER TABLE governance_kpis DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: govProject.id },
      })
      .catch(() => undefined);
    await cleanupTestData(govProject.id);
  });

  describe("when current spend exceeds baseline by the configured ratio", () => {
    it("evaluates the rule, fires the alert, and persists AnomalyAlert with the expected shape", async () => {
      const rule = await prisma.anomalyRule.create({
        data: {
          organizationId: org.id,
          scope: "organization",
          scopeId: org.id,
          name: `Spend spike org-wide ${namespace}`,
          severity: "warning",
          ruleType: "spend_spike",
          thresholdConfig: {
            windowSec: 3600,
            ratioVsBaseline: 2.0,
            minBaselineUsd: 0.5,
          },
        },
      });

      const evaluator = SpendSpikeAnomalyEvaluator.create(prisma);
      // evaluator.evaluateAll() iterates ALL active spend_spike rules in PG,
      // so its bulk counters reflect global state (other orgs' rules from
      // dogfood fixtures may be present). Assertions stay scoped to MY rule's
      // observable side effects via per-ruleId queries.
      await evaluator.evaluateAll({ now: NOW });

      const alerts = await prisma.anomalyAlert.findMany({
        where: { ruleId: rule.id },
      });
      expect(alerts).toHaveLength(1);
      const alert = alerts[0]!;
      expect(alert.organizationId).toBe(org.id);
      expect(alert.severity).toBe("warning");
      expect(alert.ruleType).toBe("spend_spike");
      expect(alert.ruleName).toBe(rule.name);
      expect(alert.state).toBe("open");
      expect(Number(alert.triggerSpendUsd)).toBeCloseTo(10.0, 2);
      expect(alert.triggerWindowEnd.getTime()).toBe(NOW.getTime());
      expect(alert.triggerWindowStart.getTime()).toBe(
        NOW.getTime() - 3600 * 1000,
      );
      const detail = alert.detail as Record<string, unknown>;
      expect(detail.baselineSpendUsd).toBeCloseTo(1.0, 2);
      expect(detail.windowSec).toBe(3600);
      expect(detail.dispatch).toBe("log_only");
      expect(typeof detail.reason).toBe("string");
    });

    describe("dedup invariant — re-running on the same window", () => {
      it("does not create a second AnomalyAlert for the same rule + window", async () => {
        const evaluator = SpendSpikeAnomalyEvaluator.create(prisma);
        await evaluator.evaluateAll({ now: NOW });

        const alerts = await prisma.anomalyAlert.findMany({
          where: { organizationId: org.id },
        });
        expect(alerts).toHaveLength(1);
      });
    });
  });

  describe("when a source-scoped rule's scopeId does not match any seeded SourceId", () => {
    it("evaluates the rule but skips below_baseline and persists no alert", async () => {
      // Add a second rule scoped to a different source. The seeded
      // governance_kpis rows are all on `primarySourceId`, so the
      // SourceId={unrelatedSourceId} predicate hits zero rows →
      // baseline 0 < minBaselineUsd → skip below_baseline.
      const scopedRule = await prisma.anomalyRule.create({
        data: {
          organizationId: org.id,
          scope: "source",
          scopeId: unrelatedSourceId,
          name: `Spend spike source-scoped ${namespace}`,
          severity: "info",
          ruleType: "spend_spike",
          thresholdConfig: {
            windowSec: 3600,
            ratioVsBaseline: 2.0,
            minBaselineUsd: 0.5,
          },
        },
      });

      const evaluator = SpendSpikeAnomalyEvaluator.create(prisma);
      await evaluator.evaluateAll({ now: NOW });

      // The source-scoped rule has zero matching governance_kpis rows
      // (its scopeId points at unrelatedSourceId), so no alert fires
      // for it regardless of what other rules in the system do.
      const scopedAlerts = await prisma.anomalyAlert.findMany({
        where: { ruleId: scopedRule.id },
      });
      expect(scopedAlerts).toHaveLength(0);
    });
  });

  describe("when a rule is archived", () => {
    it("is excluded from evaluation entirely", async () => {
      const archivedRule = await prisma.anomalyRule.create({
        data: {
          organizationId: org.id,
          scope: "organization",
          scopeId: org.id,
          name: `Archived rule ${namespace}`,
          severity: "warning",
          ruleType: "spend_spike",
          thresholdConfig: {
            windowSec: 3600,
            ratioVsBaseline: 2.0,
            minBaselineUsd: 0.5,
          },
          archivedAt: new Date(NOW.getTime() - 60 * 1000),
        },
      });

      const evaluator = SpendSpikeAnomalyEvaluator.create(prisma);
      await evaluator.evaluateAll({ now: NOW });

      // Archived rule is filtered out by the findMany WHERE clause in
      // the evaluator (archivedAt: null). It must produce zero alerts
      // regardless of governance_kpis state.
      const archivedAlerts = await prisma.anomalyAlert.findMany({
        where: { ruleId: archivedRule.id },
      });
      expect(archivedAlerts).toHaveLength(0);
    });
  });
});
