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

function confirmedData(costNanoUsd: number, requestId: string) {
  return {
    gateway_request_id: requestId,
    occurred_at: DAY_MS,
    tenantId,
    organization_id: "org_acme",
    virtual_key_id: "vk_1",
    principal_user_id: "user_ada",
    end_user_id: "",
    trace_id: "",
    request_type: "chat",
    labels: [],
    metadata: "",
    admitted_at: DAY_MS,
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

/** Puts one gateway outcome on the durable log, the way the ingest seam does. */
async function appendConfirmed(costNanoUsd: number): Promise<void> {
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
        EventPayload: JSON.stringify(confirmedData(costNanoUsd, requestId)),
        EventOccurredAt: DAY_MS,
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
    data: confirmedData(amountNanoUsd, "seed"),
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
      await appendConfirmed(5_000_000_000);
      await appendConfirmed(7_340_000_000);
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
      expect(comparison.mismatches[0]!.summarizedNanoUsd).toBe(9_999_000_000);
      expect(comparison.mismatches[0]!.derivedNanoUsd).toBe(12_340_000_000);
    });

    it("leaves the drifted row exactly as it found it", async () => {
      await appendConfirmed(5_000_000_000);
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
      await appendConfirmed(5_000_000_000);
      await appendConfirmed(7_340_000_000);
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
      expect(comparison.mismatches[0]!.derivedNanoUsd).toBe(null);
      expect(await mismatchCount()).toBe(before + 1);
    });
  });

  describe("when the comparator runs", () => {
    it("measures how far the summary is behind the log", async () => {
      await appendConfirmed(5_000_000_000);

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
