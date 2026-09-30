// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * The ClickHouse side of the drift check's integration suites: the log the
 * comparison derives from, the summary it compares against, and the two
 * counters that say what it found.
 *
 * Kept apart from `costRollupWatch.integration.harness.ts`, which owns the
 * process-manager substrate. Every function here takes the client, the
 * repository and the tenant it works on rather than reading them off module
 * state, so the harness can bind them to whichever organization the current
 * test minted without either module holding the other's mutable state.
 *
 * @see specs/governance/cost-rollup-watch.feature
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
} from "@ee/event-sourcing/pipelines/pulled-usage-processing/schemas/constants";
import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "@ee/governance/projections/governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
} from "@ee/governance/projections/governanceCostRollup.foldProjection";
import { projectGovernanceCostRollupStateToRow } from "@ee/governance/projections/governanceCostRollup.store";
import { nanoid } from "nanoid";
import { register } from "prom-client";

import type { GovernanceCostRollupClickHouseRepository } from "../../services/governanceCostRollup.clickhouse.repository";
import { COST_ROLLUP_WATCH_PROCESS_NAME } from "../costRollupWatch.process";

/** An ordinary working morning, hours after that day's slot has passed. */
export const NOW = Date.UTC(2026, 8, 10, 8, 0, 0);
export const TODAY = "2026-09-10";
export const YESTERDAY = "2026-09-09";
export const YESTERDAY_MS = Date.UTC(2026, 8, 9, 22, 0, 0);

/** The slot every charge recorded at `NOW` arms, and the one after it. */
export const TONIGHT = Date.UTC(2026, 8, 11, 4, 23, 0);
export const TOMORROW_NIGHT = Date.UTC(2026, 8, 12, 4, 23, 0);

/**
 * One pulled observation's payload, as the puller worker writes it. The shape
 * mirrors `costRollupComparator.service.integration.test.ts`, which is the
 * suite that owns what the fold reads out of it.
 */
export function observedData({
  tenantId,
  costNanoMinor,
  occurredAtMs,
  restatementKey,
}: {
  tenantId: string;
  costNanoMinor: number;
  occurredAtMs: number;
  restatementKey: string;
}) {
  return {
    itemKey: `usage_report:${TODAY}:1d`,
    restatementKey,
    source: "anthropic_admin",
    ingestionSourceId: "src_1",
    organizationId: "org_acme",
    teamId: "team_platform",
    projectId: tenantId,
    model: "anthropic/claude-sonnet-5",
    tokensInput: 1_000,
    tokensOutput: 200,
    tokensCacheRead: 0,
    tokensCacheWrite: 0,
    costNanoMinor,
    currencyCode: "USD",
    costNanoUsd: null,
    rawActorId: "",
    rateVersion: "registry@2026-08-01",
    costBasis: "computed",
    costStatus: "estimate",
    occurredAtMs,
    observedAtMs: occurredAtMs,
  };
}

/**
 * Puts one observation on the durable log, dated to the day its business time
 * falls in — the envelope time is the column the comparator selects by, and
 * the puller writes the item's own moment to it.
 */
export async function appendObserved({
  ch,
  tenantId,
  costNanoMinor,
  occurredAtMs = NOW,
}: {
  ch: ClickHouseClient;
  tenantId: string;
  costNanoMinor: number;
  occurredAtMs?: number;
}): Promise<void> {
  const restatementKey = `bucket-${nanoid(6)}`;
  await ch.insert({
    table: "event_log",
    values: [
      {
        TenantId: tenantId,
        IdempotencyKey: `idem-${nanoid()}`,
        AggregateType: "pulled_usage",
        AggregateId: restatementKey,
        EventId: `evt-${nanoid()}`,
        EventType: PULLED_USAGE_EVENT_TYPES.OBSERVED,
        EventVersion: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
        EventTimestamp: Date.now(),
        EventPayload: JSON.stringify(
          observedData({
            tenantId,
            costNanoMinor,
            occurredAtMs,
            restatementKey,
          }),
        ),
        EventOccurredAt: occurredAtMs,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/**
 * Writes the day's summary at whatever figure the test wants it to claim, by
 * folding one observation through the real projection. Hand-writing the row
 * would let the comparison agree with a summary the fold could never produce.
 *
 * `occurredAtMs` is the moment of the newest charge the summary has folded,
 * and it is a parameter because that is the whole of what tells a summary
 * that has caught up from one that has not. Stamping it always at `NOW` would
 * make every summary look current no matter which charges the log holds.
 */
export async function writeSummary({
  repo,
  tenantId,
  amountNanoMinor,
  occurredAtMs = NOW,
}: {
  repo: GovernanceCostRollupClickHouseRepository;
  tenantId: string;
  amountNanoMinor: number;
  occurredAtMs?: number;
}): Promise<void> {
  const projection = new GovernanceCostRollupFoldProjection({
    store: { store: async () => undefined, get: async () => null },
  });
  const state: GovernanceCostRollupState = projection.apply(projection.init(), {
    id: `evt-${nanoid()}`,
    type: PULLED_USAGE_EVENT_TYPES.OBSERVED,
    tenantId,
    aggregateId: "seed",
    occurredAt: occurredAtMs,
    data: observedData({
      tenantId,
      costNanoMinor: amountNanoMinor,
      occurredAtMs,
      restatementKey: "seed",
    }),
  } as never);
  await repo.upsert(
    projectGovernanceCostRollupStateToRow({
      state,
      tenantId,
      version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      appliedEventIds: [],
    }),
  );
}

export async function summarizedAmountsFor({
  repo,
  tenantId,
  day,
}: {
  repo: GovernanceCostRollupClickHouseRepository;
  tenantId: string;
  day: string;
}): Promise<number[]> {
  const cells = await repo.findCellsForDay({
    tenantId,
    day,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
  });
  return cells.map((cell) => cell.AmountNanoMinor).sort((a, b) => a - b);
}

/** How many events this organization's log holds, of any type. */
export async function eventLogCount({
  ch,
  tenantId,
}: {
  ch: ClickHouseClient;
  tenantId: string;
}): Promise<number> {
  const result = await ch.query({
    query:
      "SELECT count() AS total FROM event_log WHERE TenantId = {tenantid:String}",
    query_params: { tenantid: tenantId },
    format: "JSONEachRow",
  });
  const rows = await result.json<{ total: string }>();
  return Number(rows[0]?.total ?? 0);
}

/** The drift counter, summed over the billed lane. */
export async function mismatchCount(): Promise<number> {
  const metric = register.getSingleMetric(
    "langwatch_governance_cost_rollup_mismatch_total",
  );
  const values = (await metric!.get()).values;
  return values
    .filter(
      (value) => value.labels.cost_source === GOVERNANCE_COST_SOURCE.PULLED,
    )
    .reduce((sum, value) => sum + value.value, 0);
}

/** How many wakes this process answered, and how late they were in total. */
export async function wakeLag(): Promise<{ count: number; sumMs: number }> {
  const metric = register.getSingleMetric("es_process_wake_lag_milliseconds");
  const values = (await metric!.get()).values;
  const mine = values.filter(
    (value) => value.labels.process_name === COST_ROLLUP_WATCH_PROCESS_NAME,
  );
  // A histogram's `_sum` and `_count` rows carry the derived metric name at
  // runtime; prom-client's value type does not declare it.
  const of = (suffix: string) =>
    mine.find((value) =>
      (value as { metricName?: string }).metricName?.endsWith(suffix),
    )?.value ?? 0;
  return { count: of("_count"), sumMs: of("_sum") };
}
