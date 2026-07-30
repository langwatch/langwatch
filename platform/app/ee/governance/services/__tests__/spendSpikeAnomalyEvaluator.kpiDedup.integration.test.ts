// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * SpendSpikeAnomalyEvaluator — read-time dedup of `governance_kpis`.
 *
 * `governance_kpis` is a ReplacingMergeTree. Until a background merge runs,
 * every re-derivation of a contribution sits in the table as an extra row
 * under the same sorting key, and a bare `sum(SpendUsd)` adds them all
 * together. The number that comes out of that sum is what fires a
 * customer-facing anomaly alert and what lands in `AnomalyAlert.triggerSpendUsd`.
 *
 * Both grains are covered, because migration 00063 only narrows the defect:
 *
 *   - post-00063 event grain: a re-derived span writes a byte-identical row
 *     under the same key. Identical rows still SUM.
 *   - pre-00063 trace grain: rows carry the trace's RUNNING totals under one
 *     key, all stamped with the same `LastEventOccurredAt` (00063's header
 *     records that the version is constant across firings), so the duplicates
 *     are not even equal — the sum is running-total-plus-running-total.
 *
 * Merges are stopped for the duration so the unmerged state the read has to
 * cope with is the state under test, rather than something a background merge
 * may or may not have cleaned up first. Integration files run sequentially
 * (`fileParallelism: false`), so the stop is not visible to other suites.
 *
 * Spec contracts:
 *   - specs/ai-gateway/governance/anomaly-detection.feature
 *   - dev/docs/best_practices/clickhouse-queries.md
 */
import type { ClickHouseClient } from "@clickhouse/client";
import type { Organization, Project } from "@prisma/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { prisma } from "~/server/db";
import {
  cleanupTestData,
  getTestClickHouseClient,
} from "~/server/event-sourcing.old/__tests__/integration/testContainers";
import { ensureHiddenGovernanceProject } from "../governanceProject.service";
import { SpendSpikeAnomalyEvaluator } from "../spendSpikeAnomalyEvaluator.service";

interface SeedKpiRow {
  sourceId: string;
  hourBucket: Date;
  spendUsd: number;
  traceId: string;
  eventId: string;
  /** Defaults to hourBucket, matching what the map projection stamps. */
  lastEventOccurredAt?: Date;
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
        TraceId: row.traceId,
        EventId: row.eventId,
        SourceType: "otel_generic",
        SpendUsd: row.spendUsd,
        PromptTokens: 100,
        CompletionTokens: 50,
        LastEventOccurredAt: row.lastEventOccurredAt ?? row.hourBucket,
      },
    ],
    format: "JSONEachRow",
    // One insert -> one part, so the duplicates below really are unmerged
    // separate parts rather than a single deduplicated block.
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

describe("SpendSpikeAnomalyEvaluator — unmerged governance_kpis duplicates", () => {
  const namespace = `kpi-dedup-${nanoid(8)}`;
  // Optional on purpose: seeding can fail at any of these steps, and teardown
  // has to be able to tell what exists from what never did.
  let ch: ClickHouseClient | undefined;
  let org: Organization | undefined;
  let govProject: Project | undefined;
  let sourceId: string;
  /** Fixed evaluation moment — windowStart = NOW - 1h, baselineStart = NOW - 7h. */
  const NOW = new Date("2026-04-29T12:00:00Z");

  beforeAll(async () => {
    const maybeCh = getTestClickHouseClient();
    if (!maybeCh) {
      throw new Error("ClickHouse test container not available");
    }
    ch = maybeCh;
    await maybeCh.command({ query: "SYSTEM STOP MERGES governance_kpis" });

    const organization = await prisma.organization.create({
      data: {
        name: `KPI Dedup Org ${namespace}`,
        slug: `kpi-dedup-org-${namespace}`,
      },
    });
    org = organization;
    await prisma.team.create({
      data: {
        name: `KPI Dedup Team ${namespace}`,
        slug: `kpi-dedup-team-${namespace}`,
        organizationId: organization.id,
      },
    });
    const project = await ensureHiddenGovernanceProject(
      prisma,
      organization.id,
    );
    govProject = project;
    sourceId = `is-dedup-${nanoid()}`;

    const inCurrentWindow = new Date(NOW.getTime() - 30 * 60 * 1000);

    // Post-00063 event grain: ONE $6 span contribution, re-derived twice.
    // The two rows are byte-identical under one key — the exact shape 00063
    // makes rebuilds produce.
    for (let attempt = 0; attempt < 2; attempt++) {
      await insertGovernanceKpiRow(maybeCh, project.id, {
        sourceId,
        hourBucket: inCurrentWindow,
        spendUsd: 6.0,
        traceId: `${namespace}-tr-event-grain`,
        eventId: `${namespace}-span-1`,
      });
    }

    // Pre-00063 trace grain: EventId = '' and the trace's RUNNING totals
    // written on successive firings, all stamped with the same version. Only
    // the $4 total is real — it is the trace's final one, and the read's
    // tie-break has to elect it deterministically rather than pick whichever
    // tied row ClickHouse happened to reach first.
    for (const runningTotal of [1.5, 4.0]) {
      await insertGovernanceKpiRow(maybeCh, project.id, {
        sourceId,
        hourBucket: inCurrentWindow,
        spendUsd: runningTotal,
        traceId: `${namespace}-tr-trace-grain`,
        eventId: "",
        lastEventOccurredAt: inCurrentWindow,
      });
    }

    // Baseline: 6 windows of $1.00, each written exactly once.
    for (let i = 1; i <= 6; i++) {
      await insertGovernanceKpiRow(maybeCh, project.id, {
        sourceId,
        hourBucket: new Date(NOW.getTime() - (60 + i * 60) * 60 * 1000),
        spendUsd: 1.0,
        traceId: `${namespace}-tr-baseline-${i}`,
        eventId: `${namespace}-baseline-span-${i}`,
      });
    }
  });

  afterAll(async () => {
    // Merges are a GLOBAL setting: restore them first, before anything that
    // could fail, and skip only when there is no client because seeding never
    // got far enough to stop them.
    if (!ch) return;
    await ch.command({ query: "SYSTEM START MERGES governance_kpis" });

    // Nothing below swallows. A rejection here is a tenancy-guard or cleanup
    // bug, and those are exactly the failures worth seeing. What teardown does
    // instead is check that a thing exists before deleting it, so a seeding
    // failure surfaces as its own error rather than a TypeError that aborts
    // the rest of the cleanup.
    if (org) {
      await prisma.anomalyAlert.deleteMany({
        where: { organizationId: org.id },
      });
      await prisma.anomalyRule.deleteMany({
        where: { organizationId: org.id },
      });
    }
    if (govProject) {
      await prisma.project.deleteMany({ where: { id: govProject.id } });
    }
    if (org) {
      await prisma.team.deleteMany({ where: { organizationId: org.id } });
      await prisma.organization.deleteMany({ where: { id: org.id } });
    }
    if (govProject) {
      await ch.exec({
        query: `ALTER TABLE governance_kpis DELETE WHERE TenantId = {tenantId:String}`,
        query_params: { tenantId: govProject.id },
      });
      await cleanupTestData(govProject.id);
    }
  });

  describe("given the fold holds unmerged duplicates of a contribution", () => {
    describe("when the spend spike rule is evaluated", () => {
      it("reports each contribution once, not the sum of the duplicates", async () => {
        const rule = await prisma.anomalyRule.create({
          data: {
            organizationId: org!.id,
            scope: "source",
            scopeId: sourceId,
            name: `Spend spike dedup ${namespace}`,
            severity: "warning",
            ruleType: "spend_spike",
            thresholdConfig: {
              windowSec: 3600,
              ratioVsBaseline: 2.0,
              minBaselineUsd: 0.5,
            },
          },
        });

        await SpendSpikeAnomalyEvaluator.create(prisma).evaluateAll({
          now: NOW,
        });

        const alerts = await prisma.anomalyAlert.findMany({
          where: { ruleId: rule.id },
        });
        expect(alerts).toHaveLength(1);

        // Deduped: $6 (the span, counted once) + $4 (the trace's final
        // running total) = $10. Summing the raw rows gives
        // $6 + $6 + $1.50 + $4 = $17.50, a 75% over-report on the figure
        // shown to the customer.
        expect(Number(alerts[0]!.triggerSpendUsd)).toBeCloseTo(10.0, 2);
      });
    });
  });

  describe("given the baseline windows hold no duplicates", () => {
    describe("when the rule is evaluated", () => {
      it("reports the baseline average unchanged", async () => {
        const rule = await prisma.anomalyRule.create({
          data: {
            organizationId: org!.id,
            scope: "source",
            scopeId: sourceId,
            name: `Spend spike dedup baseline ${namespace}`,
            severity: "info",
            ruleType: "spend_spike",
            thresholdConfig: {
              windowSec: 3600,
              ratioVsBaseline: 2.0,
              minBaselineUsd: 0.5,
            },
          },
        });

        await SpendSpikeAnomalyEvaluator.create(prisma).evaluateAll({
          now: NOW,
        });

        const alerts = await prisma.anomalyAlert.findMany({
          where: { ruleId: rule.id },
        });
        expect(alerts).toHaveLength(1);
        const detail = alerts[0]!.detail as Record<string, unknown>;
        // 6 windows x $1.00 / 6 — the dedup must not swallow distinct rows
        // that merely share a key prefix.
        expect(detail.baselineSpendUsd).toBeCloseTo(1.0, 2);
      });
    });
  });
});
