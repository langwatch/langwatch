// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The cost rollup's drift watchdog, against real ClickHouse: it re-derives one
 * day straight from `event_log` and holds it against the summary.
 *
 * The assertion is the METRIC and the log, and the absence of a repair. Wave 1
 * surfaces signals and sends nothing — a comparator that quietly rewrote the
 * row it disagreed with would erase the evidence of why the two diverged.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { register } from "prom-client";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";

import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_SOURCE,
} from "../../projections/governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
} from "../../projections/governanceCostRollup.foldProjection";
import { projectGovernanceCostRollupStateToRow } from "../../projections/governanceCostRollup.store";
import { CostRollupComparatorService } from "../costRollupComparator.service";
import { GovernanceCostRollupClickHouseRepository } from "../governanceCostRollup.clickhouse.repository";

const DAY = "2026-08-01";
const DAY_MS = Date.parse(`${DAY}T09:30:00.000Z`);

let ch: ClickHouseClient;
let repo: GovernanceCostRollupClickHouseRepository;
let comparator: CostRollupComparatorService;
let tenantId: string;

function confirmedData({
  costNanoUsd,
  requestId,
  occurredAt = DAY_MS,
}: {
  costNanoUsd: number;
  requestId: string;
  occurredAt?: number;
}) {
  return {
    gateway_request_id: requestId,
    occurred_at: occurredAt,
    tenantId,
    organization_id: "org_acme",
    virtual_key_id: "vk_1",
    principal_user_id: "user_ada",
    end_user_id: "",
    trace_id: "",
    request_type: "chat",
    labels: [],
    metadata: "",
    admitted_at: occurredAt,
    team_id: "",
    model: "openai/gpt-5-mini",
    model_provider_id: "openai",
    usage: {
      input_tokens: 100,
      output_tokens: 20,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
      reasoning_tokens: 0,
      input_audio_tokens: 0,
      output_audio_tokens: 0,
      input_chars: 0,
    },
    rate_version: "registry@2026-08-01",
    duration_ms: 120,
    cost_nano_usd: costNanoUsd,
  };
}

/**
 * Puts one gateway outcome on the durable log, the way the ingest seam does.
 *
 * `EventOccurredAt` is set to the same value as the payload's `occurred_at`
 * because that is what the write path does: spendCommands.ts passes
 * `occurredAt: data.occurred_at` into every spend event, and
 * eventStoreUtils.ts:71 writes that envelope field to the column verbatim. The
 * append clock lands on `EventTimestamp` instead. Seeding these two apart
 * would be testing a system we do not have.
 */
async function appendConfirmed({
  costNanoUsd,
  occurredAt = DAY_MS,
}: {
  costNanoUsd: number;
  occurredAt?: number;
}): Promise<void> {
  const requestId = `gwreq-${nanoid()}`;
  await ch.insert({
    table: "event_log",
    values: [
      {
        TenantId: tenantId,
        IdempotencyKey: `idem-${requestId}`,
        AggregateType: "gateway_request",
        AggregateId: requestId,
        EventId: `evt-${nanoid()}`,
        EventType: "lw.gateway.spend.confirmed",
        EventVersion: "2026-07-29",
        EventTimestamp: Date.now(),
        EventPayload: JSON.stringify(
          confirmedData({ costNanoUsd, requestId, occurredAt }),
        ),
        EventOccurredAt: occurredAt,
      },
    ],
    format: "JSONEachRow",
    clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
  });
}

/** Writes the day's summary at whatever figure the test wants it to claim. */
async function writeSummary(amountNanoUsd: number): Promise<void> {
  const projection = new GovernanceCostRollupFoldProjection({
    store: { store: async () => undefined, get: async () => null },
  });
  const state: GovernanceCostRollupState = projection.apply(projection.init(), {
    id: `evt-${nanoid()}`,
    type: "lw.gateway.spend.confirmed",
    tenantId,
    aggregateId: "seed",
    occurredAt: DAY_MS,
    data: confirmedData({ costNanoUsd: amountNanoUsd, requestId: "seed" }),
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

async function mismatchCount(): Promise<number> {
  const metric = register.getSingleMetric(
    "langwatch_governance_cost_rollup_mismatch_total",
  );
  const values = (await metric!.get()).values;
  return values
    .filter(
      (value) => value.labels.cost_source === GOVERNANCE_COST_SOURCE.GATEWAY,
    )
    .reduce((sum, value) => sum + value.value, 0);
}

describe("CostRollupComparatorService", () => {
  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
    repo = new GovernanceCostRollupClickHouseRepository(async () => ch);
    comparator = new CostRollupComparatorService(repo);
  });

  beforeEach(() => {
    tenantId = `proj-comparator-${nanoid(8)}`;
  });

  afterAll(async () => {
    await ch?.close();
  });

  describe("given a summary row that no longer matches the sum of its events", () => {
    /** @scenario "The comparator counts a summary that drifted from its events" */
    it("counts the mismatch on the drift metric and names both figures in the log", async () => {
      await appendConfirmed({ costNanoUsd: 5_000_000_000 });
      await appendConfirmed({ costNanoUsd: 7_340_000_000 });
      // The summary claims a figure the events do not add up to.
      await writeSummary(9_999_000_000);

      const before = await mismatchCount();
      const comparison = await comparator.compareDay({
        tenantId,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });

      expect(await mismatchCount()).toBe(before + 1);
      expect(comparison.mismatches).toHaveLength(1);
      // Both figures are carried out of the comparison, which is what the log
      // line renders: a counter alone cannot tell an operator which way the
      // drift went or by how much.
      expect(comparison.mismatches[0]!.summarizedNanoMinor).toBe(9_999_000_000);
      expect(comparison.mismatches[0]!.derivedNanoMinor).toBe(12_340_000_000);
    });

    it("leaves the drifted row exactly as it found it", async () => {
      await appendConfirmed({ costNanoUsd: 5_000_000_000 });
      await writeSummary(9_999_000_000);

      await comparator.compareDay({
        tenantId,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      expect(cells[0]!.AmountNanoUsd).toBe(9_999_000_000);
    });
  });

  describe("given a summary that agrees with its events", () => {
    // The counter has to be quiet on the healthy path, or the alerting it
    // exists for is noise from the first day.
    it("counts nothing", async () => {
      await appendConfirmed({ costNanoUsd: 5_000_000_000 });
      await appendConfirmed({ costNanoUsd: 7_340_000_000 });
      await writeSummary(12_340_000_000);

      const before = await mismatchCount();
      const comparison = await comparator.compareDay({
        tenantId,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });

      expect(comparison.mismatches).toEqual([]);
      expect(await mismatchCount()).toBe(before);
    });
  });

  describe("given two events either side of midnight", () => {
    /**
     * The comparator selects its events by `event_log.EventOccurredAt` while
     * the fold buckets them by the payload's own `occurred_at`. That is only
     * safe while the two carry the same value, and today they do: every spend
     * command sets `occurredAt: data.occurred_at`
     * (spendCommands.ts:81/129/177/224) and the store writes the envelope
     * field to the column unchanged (eventStoreUtils.ts:71), with the append
     * clock going to `EventTimestamp` instead. The puller lane matches
     * (pullerWorker.ts:753).
     *
     * So this is a pin, not a repair. A producer that ever set the envelope to
     * wall-clock time would put an event in one query's day and the other's
     * neighbour, and the comparator would report drift that is entirely its
     * own. That regression fails here.
     */
    it("assigns each to the day its own business time falls in", async () => {
      const lastMs = Date.parse(`${DAY}T23:59:59.999Z`);
      const firstMsNextDay = Date.parse("2026-08-02T00:00:00.000Z");
      await appendConfirmed({ costNanoUsd: 5_000_000_000, occurredAt: lastMs });
      await appendConfirmed({
        costNanoUsd: 7_340_000_000,
        occurredAt: firstMsNextDay,
      });

      // The summary for DAY claims only the event whose business day is DAY.
      await writeSummary(5_000_000_000);

      const sameDay = await comparator.compareDay({
        tenantId,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });
      // The 00:00:00.000 event next door was not pulled into this day.
      expect(sameDay.mismatches).toEqual([]);

      // ...and it was not dropped on the floor either: it turns up on its own
      // day, where no summary explains it.
      const nextDay = await comparator.compareDay({
        tenantId,
        day: "2026-08-02",
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });
      expect(nextDay.mismatches).toHaveLength(1);
      expect(nextDay.mismatches[0]!.derivedNanoMinor).toBe(7_340_000_000);
    });
  });

  describe("given a summary cell no event on the log explains", () => {
    // Money on a screen that nothing accounts for is the more alarming
    // direction, and the one a naive comparator iterating only over derived
    // cells would be blind to.
    it("counts it too", async () => {
      await writeSummary(9_999_000_000);

      const before = await mismatchCount();
      const comparison = await comparator.compareDay({
        tenantId,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });

      expect(comparison.mismatches).toHaveLength(1);
      expect(comparison.mismatches[0]!.derivedNanoMinor).toBe(null);
      expect(await mismatchCount()).toBe(before + 1);
    });
  });

  describe("when the comparator runs", () => {
    it("measures how far the summary is behind the log", async () => {
      await appendConfirmed({ costNanoUsd: 5_000_000_000 });

      const comparison = await comparator.compareDay({
        tenantId,
        day: DAY,
        costSource: GOVERNANCE_COST_SOURCE.GATEWAY,
      });

      // Nothing summarized, one event at 09:30 on the sampled day: the summary
      // is behind by the whole elapsed part of the window.
      expect(comparison.lagMs).toBe(
        DAY_MS - Date.parse(`${DAY}T00:00:00.000Z`),
      );
    });
  });
});
