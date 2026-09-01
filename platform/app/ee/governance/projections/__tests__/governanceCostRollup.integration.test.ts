// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The daily cost rollup against real ClickHouse — the rules that are only
 * decidable with a ReplacingMergeTree underneath: what survives a compaction,
 * what a version-aware read returns before one, and whether a redelivered
 * event doubles the money.
 *
 * Every seed sits inside the table's 13-month TTL horizon. Outside it the
 * background delete removes the rows mid-test and the assertions pass or fail
 * for reasons that have nothing to do with the code.
 *
 * Spec: specs/governance/governance-cost-rollup.feature
 * Decision: ADR-128.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import type { FoldProjectionDefinition } from "~/server/event-sourcing/projections/foldProjection.types";
import { FoldProjectionExecutor } from "~/server/event-sourcing/projections/foldProjectionExecutor";
import type { ProjectionStoreContext } from "~/server/event-sourcing/projections/projectionStoreContext";

import {
  GovernanceCostRollupClickHouseRepository,
  type GovernanceCostRollupRow,
} from "../../services/governanceCostRollup.clickhouse.repository";
import {
  GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
  GOVERNANCE_COST_ROLLUP_TABLE,
  GOVERNANCE_COST_SOURCE,
} from "../governanceCostRollup.constants";
import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
  governanceCostRollupKey,
} from "../governanceCostRollup.foldProjection";
import {
  GovernanceCostRollupStore,
  projectGovernanceCostRollupStateToRow,
} from "../governanceCostRollup.store";

/** Well inside the 13-month TTL horizon, so nothing is swept mid-test. */
const DAY = "2026-08-01";
const DAY_MS = Date.parse(`${DAY}T09:30:00.000Z`);

let ch: ClickHouseClient;
let repo: GovernanceCostRollupClickHouseRepository;
let store: GovernanceCostRollupStore;
let tenantId: string;

function confirmed({
  costNanoUsd,
  principalUserId = "user_ada",
  model = "openai/gpt-5-mini",
  id = nanoid(),
  occurredAt = DAY_MS,
}: {
  costNanoUsd: number;
  principalUserId?: string;
  model?: string;
  id?: string;
  occurredAt?: number;
}) {
  return {
    id,
    type: "lw.gateway.spend.confirmed",
    tenantId,
    aggregateId: `gwreq-${id}`,
    occurredAt,
    data: {
      gateway_request_id: `gwreq-${id}`,
      occurred_at: occurredAt,
      tenantId,
      organization_id: "org_acme",
      virtual_key_id: "vk_1",
      principal_user_id: principalUserId,
      end_user_id: "",
      trace_id: "",
      request_type: "chat",
      labels: [],
      metadata: "",
      admitted_at: occurredAt,
      team_id: "",
      model,
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
    },
  };
}

/**
 * One pulled observation.
 *
 * `costNanoMinor` and `currencyCode` are both spelled out because the fold
 * does not validate its events: a helper that omitted the money would hand it
 * `undefined`, the cell's amount would be `NaN`, and its key would carry a
 * null currency — while every assertion downstream still appeared to pass.
 */
function observed({
  costNanoMinor,
  currencyCode = "USD",
  costNanoUsd = null,
  observedAtMs,
  restatementKey = "bucket-hash",
  costStatus = "estimate",
  id = nanoid(),
}: {
  costNanoMinor: number;
  currencyCode?: string;
  costNanoUsd?: number | null;
  observedAtMs: number;
  restatementKey?: string;
  costStatus?: "exact" | "estimate";
  id?: string;
}) {
  return {
    id,
    type: "lw.obs.pulled_usage.observed",
    tenantId,
    aggregateId: restatementKey,
    occurredAt: DAY_MS,
    data: {
      itemKey: `usage_report:${DAY}:1d`,
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
      currencyCode,
      costNanoUsd,
      rateVersion: "registry@2026-08-01",
      costBasis: "computed",
      costStatus,
      occurredAtMs: DAY_MS,
      observedAtMs,
    },
  };
}

/** Folds an event through the real executor, so redelivery dedup is exercised. */
async function foldThroughExecutor(
  event: ReturnType<typeof confirmed> | ReturnType<typeof observed>,
  { deliveryAttempt = 1 }: { deliveryAttempt?: number } = {},
): Promise<void> {
  const projection = new GovernanceCostRollupFoldProjection({ store });
  const context: ProjectionStoreContext = {
    aggregateId: event.aggregateId,
    tenantId: tenantId as never,
    key: governanceCostRollupKey(event as never),
    deliveryAttempt,
  };
  await new FoldProjectionExecutor().execute(
    projection as unknown as FoldProjectionDefinition<
      GovernanceCostRollupState,
      never
    >,
    event as never,
    context,
  );
}

/** What a naive reader would get: no version awareness at all. */
async function plainSumOfDay(): Promise<number> {
  const result = await ch.query({
    query: `
      SELECT sum(AmountNanoUsd) AS Total
      FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
      WHERE TenantId = {tenantid:String} AND Day = {day:String}
    `,
    query_params: { tenantid: tenantId, day: DAY },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ Total: unknown }>;
  return Number(rows[0]?.Total ?? 0);
}

async function compact(): Promise<void> {
  await ch.command({
    query: `OPTIMIZE TABLE ${GOVERNANCE_COST_ROLLUP_TABLE} FINAL`,
  });
}

async function rawRowCount(): Promise<number> {
  const result = await ch.query({
    query: `
      SELECT count() AS N
      FROM ${GOVERNANCE_COST_ROLLUP_TABLE}
      WHERE TenantId = {tenantid:String} AND Day = {day:String}
    `,
    query_params: { tenantid: tenantId, day: DAY },
    format: "JSONEachRow",
  });
  const rows = (await result.json()) as Array<{ N: unknown }>;
  return Number(rows[0]?.N ?? 0);
}

/** One cell's dimensions, fixed so the seed and the read address the same row. */
function withdrawnCellDimensions() {
  return {
    tenantId,
    day: DAY,
    costSource: GOVERNANCE_COST_SOURCE.PULLED,
    ingestionSourceId: "src_1",
    provider: "anthropic",
    model: "claude-sonnet-4",
    agentId: "",
    currencyCode: "USD",
    rawActorId: "",
  };
}

/**
 * A stored row carrying a price, written straight to the table. The fold is
 * not involved on purpose: this exercises what the READ does with two versions
 * of one cell, which is a property of the query rather than of the fold.
 */
function pricedCell({
  amountNanoUsd,
  at,
}: {
  amountNanoUsd: number | null;
  at: number;
}): GovernanceCostRollupRow {
  const d = withdrawnCellDimensions();
  return {
    TenantId: d.tenantId,
    Day: d.day,
    CostSource: d.costSource,
    IngestionSourceId: d.ingestionSourceId,
    Provider: d.provider,
    Model: d.model,
    AgentId: d.agentId,
    CurrencyCode: d.currencyCode,
    RawActorId: d.rawActorId,
    OrganizationId: "org_acme",
    ExactOrEstimate: "exact",
    AmountNanoUsd: amountNanoUsd,
    AmountNanoMinor: amountNanoUsd ?? 0,
    TokensInput: 100,
    TokensOutput: 20,
    TokensCacheRead: 0,
    TokensCacheWrite: 0,
    RequestCount: 1,
    RevisionCount: 0,
    PreviousAmountNanoUsd: null,
    PulledItemsJson: "{}",
    Version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
    AppliedEventIds: [],
    CreatedAt: DAY_MS,
    LastEventOccurredAt: DAY_MS,
    EventTimestamp: at,
  };
}

describe("governance cost rollup", () => {
  beforeAll(() => {
    const client = getTestClickHouseClient();
    if (!client) throw new Error("Test ClickHouse is not available");
    ch = client;
    repo = new GovernanceCostRollupClickHouseRepository(async () => ch);
    store = new GovernanceCostRollupStore(repo);
  });

  beforeEach(() => {
    // A fresh tenant per test: the table is shared and OPTIMIZE ... FINAL is
    // table-wide, so tests that compact must not be able to see each other.
    tenantId = `proj-costrollup-${nanoid(8)}`;
  });

  afterAll(async () => {
    await ch?.close();
  });

  describe("given cost events for one day and one dimension combination", () => {
    /** @scenario "A day's spend lands as one summary row per dimension combination" */
    it("holds exactly one row whose amount is the sum of those events", async () => {
      await foldThroughExecutor(confirmed({ costNanoUsd: 5_000_000_000 }));
      await foldThroughExecutor(confirmed({ costNanoUsd: 7_340_000_000 }));

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      expect(cells).toHaveLength(1);
      expect(cells[0]!.AmountNanoUsd).toBe(12_340_000_000);
      expect(cells[0]!.RequestCount).toBe(2);
      expect(cells[0]!.Version).toBe(
        GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
      );
    });
  });

  describe("given two different spenders with the same provider, model, day, and amount", () => {
    /** @scenario "Two spenders with identical numbers stay two rows after compaction" */
    it("still holds a separate row for each spender", async () => {
      await foldThroughExecutor(
        confirmed({ costNanoUsd: 5_000_000_000, principalUserId: "user_ada" }),
      );
      await foldThroughExecutor(
        confirmed({
          costNanoUsd: 5_000_000_000,
          principalUserId: "user_grace",
        }),
      );

      // Force the merge BEFORE asserting. Without it both rows survive even
      // when the spender is missing from the dedup key, and the first real
      // merge in production then deletes one spender's money.
      await compact();

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      expect(cells.map((cell) => cell.RawActorId).sort()).toEqual([
        "user_ada",
        "user_grace",
      ]);
      expect(cells.every((cell) => cell.AmountNanoUsd === 5_000_000_000)).toBe(
        true,
      );
    });
  });

  describe("given one day has events in two currencies", () => {
    /** @scenario "Amounts in different currencies stay separate rows after compaction" */
    it("keeps each currency's own total and produces no combined figure", async () => {
      // Both wave-1 producers emit USD, so the second currency is written
      // through the same projection function the fold writes with — what is
      // under test is the dedup KEY, which is what the first non-USD producer
      // will arrive to.
      const base = new GovernanceCostRollupFoldProjection({ store }).apply(
        new GovernanceCostRollupFoldProjection({ store }).init(),
        confirmed({ costNanoUsd: 5_000_000_000 }) as never,
      );
      for (const [currencyCode, amount] of [
        ["USD", 5_000_000_000],
        ["EUR", 4_200_000_000],
      ] as const) {
        await repo.upsert(
          projectGovernanceCostRollupStateToRow({
            state: {
              ...base,
              currencyCode,
              gatewayAmountNanoMinor: amount,
            },
            tenantId,
            version: GOVERNANCE_COST_ROLLUP_PROJECTION_VERSION_LATEST,
            appliedEventIds: [],
          }),
        );
      }

      await compact();

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      expect(cells).toHaveLength(2);
      const byCurrency = Object.fromEntries(
        cells.map((cell) => [cell.CurrencyCode, cell.AmountNanoMinor]),
      );
      expect(byCurrency).toEqual({ USD: 5_000_000_000, EUR: 4_200_000_000 });
      // No combined single figure: the dollar total counts the dollar row and
      // nothing else, and the euro row is reported as holding no dollar figure
      // rather than being folded in as if it did.
      const summed = await repo.sumDay({ tenantId, day: DAY });
      expect(summed.amountNanoUsd).toBe(5_000_000_000);
      expect(summed.cellsWithoutAmount).toBe(1);
    });
  });

  describe("given a day was summarized and the provider then restates it", () => {
    /** @scenario "A restated day reads as the restated amount even before compaction" */
    it("returns only the restated amount, and says what it was before", async () => {
      await foldThroughExecutor(
        observed({
          costNanoMinor: 12_340_000_000,
          observedAtMs: Date.parse("2026-08-02T04:00:00.000Z"),
        }),
      );
      await foldThroughExecutor(
        observed({
          costNanoMinor: 9_000_000_000,
          observedAtMs: Date.parse("2026-08-03T04:00:00.000Z"),
          costStatus: "exact",
        }),
      );

      // Deliberately NOT compacted: both versions of the row are still there.
      expect(await rawRowCount()).toBe(2);

      // The counterexample. A naive reader adds the superseded figure to the
      // one that replaced it and reports money nobody spent.
      expect(await plainSumOfDay()).toBe(21_340_000_000);

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      expect(cells).toHaveLength(1);
      expect(cells[0]!.AmountNanoUsd).toBe(9_000_000_000);
      // The revision stays visible rather than being quietly overwritten.
      expect(cells[0]!.RevisionCount).toBe(1);
      expect(cells[0]!.PreviousAmountNanoUsd).toBe(12_340_000_000);
      expect(cells[0]!.ExactOrEstimate).toBe("exact");
    });
  });

  describe("given a priced cell is restated to carry no figure at all", () => {
    /**
     * The other half of the restatement rule, and the one an aggregate-level
     * dedup gets wrong on its own. `argMax` ignores rows whose FIRST argument
     * is NULL, so a cell that went priced -> unpriced reads back at its old
     * price: the newest version is skipped for being NULL and the superseded
     * one wins by default. That resurrects a figure the provider withdrew.
     *
     * Wrapping the value in a tuple is what fixes it. A tuple is never NULL,
     * so no version is ever skipped, and `.1` unwraps the NULL the winning
     * version actually held.
     */
    it("reports no figure, rather than resurrecting the withdrawn one", async () => {
      const priced = pricedCell({ amountNanoUsd: 12_340_000_000, at: 1_000 });
      await repo.upsert(priced);
      await repo.upsert({
        ...priced,
        AmountNanoUsd: null,
        PreviousAmountNanoUsd: 12_340_000_000,
        RevisionCount: 1,
        EventTimestamp: 2_000,
      });

      // Deliberately NOT compacted: both versions are still on disk, which is
      // the window this whole class of bug lives in.
      expect(await rawRowCount()).toBe(2);

      const cell = await repo.findCellWithApplied(withdrawnCellDimensions());
      expect(cell?.AmountNanoUsd).toBeNull();
      // The withdrawal is a restatement like any other, so what it replaced
      // stays readable.
      expect(cell?.PreviousAmountNanoUsd).toBe(12_340_000_000);

      const day = await repo.sumDay({ tenantId, day: DAY });
      expect(day.amountNanoUsd).toBeNull();
      expect(day.cellsWithoutAmount).toBe(1);

      const lanes = await repo.sumDaysByLane({
        tenantId,
        fromDay: DAY,
        toDay: DAY,
      });
      expect(lanes).toHaveLength(1);
      expect(lanes[0]!.amountNanoUsd).toBeNull();
      expect(lanes[0]!.cellsWithoutAmount).toBe(1);
    });
  });

  describe("given a restated day read through the screen's range query", () => {
    it("totals only the surviving version, and keeps the two lanes apart", async () => {
      await foldThroughExecutor(
        observed({
          costNanoMinor: 12_340_000_000,
          observedAtMs: Date.parse("2026-08-02T04:00:00.000Z"),
        }),
      );
      await foldThroughExecutor(
        observed({
          costNanoMinor: 9_000_000_000,
          observedAtMs: Date.parse("2026-08-03T04:00:00.000Z"),
          costStatus: "exact",
        }),
      );
      await foldThroughExecutor(confirmed({ costNanoUsd: 5_000_000_000 }));

      // Deliberately NOT compacted: the superseded version is still there, so
      // the read has to survive it rather than wait for a merge.
      // Deliberately NOT compacted. The self-check: the table must still hold
      // more physical rows than the read returns cells, or this test would be
      // asserting dedup against data that has nothing left to dedup.
      const rawRows = await rawRowCount();
      expect(rawRows).toBe(3);

      const lanes = await repo.sumDaysByLane({
        tenantId,
        fromDay: DAY,
        toDay: DAY,
      });

      expect(rawRows).toBeGreaterThan(lanes.length);

      const pulled = lanes.find((lane) => lane.costSource === "pulled");
      const gateway = lanes.find((lane) => lane.costSource === "gateway");
      expect(pulled?.amountNanoUsd).toBe(9_000_000_000);
      expect(gateway?.amountNanoUsd).toBe(5_000_000_000);
      // The lanes are never combined — a summed figure is the defect.
      expect(lanes).toHaveLength(2);
      expect(pulled?.day).toBe(DAY);
    });

    it("answers null, never zero, for a window nothing reported", async () => {
      const lanes = await repo.sumDaysByLane({
        tenantId,
        fromDay: DAY,
        toDay: DAY,
      });
      expect(lanes).toEqual([]);
    });

    /** @scenario "Rows written by an older summary shape are not counted" */
    it("counts the current version only, and drops the older stamp", async () => {
      // Two DIFFERENT cells, so neither can replace the other: an older-shape
      // row that shared a key would be beaten by the dedup anyway, which would
      // let a read with no version filter at all pass this test.
      const current = pricedCell({ amountNanoUsd: 9_000_000_000, at: 2_000 });
      await repo.upsert(current);
      await repo.upsert({
        ...current,
        Model: "claude-opus-4",
        AmountNanoUsd: 4_000_000_000,
        Version: "1999-01-01",
        EventTimestamp: 3_000,
      });

      // Self-check: both rows really are on disk, so "the older one is not
      // counted" is a statement about the read rather than about a seed that
      // never landed. The newer EventTimestamp on the stale row is what would
      // make a version-blind read prefer it.
      expect(await rawRowCount()).toBe(2);

      const lanes = await repo.sumDaysByLane({
        tenantId,
        fromDay: DAY,
        toDay: DAY,
      });

      expect(lanes).toHaveLength(1);
      expect(lanes[0]!.amountNanoUsd).toBe(9_000_000_000);
      // Not 13_000_000_000: the older shape's money is not this build's money.
      expect(lanes[0]!.cellsWithoutAmount).toBe(0);
    });

    it("names the currencies of the cells it holds no dollar figure for", async () => {
      const priced = pricedCell({ amountNanoUsd: 9_000_000_000, at: 1_000 });
      await repo.upsert(priced);
      for (const currencyCode of ["EUR", "JPY"]) {
        await repo.upsert({
          ...priced,
          CurrencyCode: currencyCode,
          AmountNanoUsd: null,
          AmountNanoMinor: 4_200_000_000,
          EventTimestamp: 1_000,
        });
      }

      const lanes = await repo.sumDaysByLane({
        tenantId,
        fromDay: DAY,
        toDay: DAY,
      });

      expect(lanes).toHaveLength(1);
      expect(lanes[0]!.cellsWithoutAmount).toBe(2);
      // Sorted and USD-free: USD names no currency the screen could report,
      // and an unstable order would make the rendered sentence flap.
      expect(lanes[0]!.currenciesWithoutUsdAmount).toEqual(["EUR", "JPY"]);
    });
  });

  describe("given the same event is redelivered after its state was stored", () => {
    // Queue delivery is at-least-once and this fold ACCUMULATES: without the
    // applied-event-id watermark riding on the row, a retry that reaches a
    // cold cache re-adds the same money and the day silently doubles.
    it("does not count the money twice", async () => {
      const event = confirmed({ costNanoUsd: 5_000_000_000 });
      await foldThroughExecutor(event);
      await foldThroughExecutor(event, { deliveryAttempt: 2 });

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      expect(cells[0]!.AmountNanoUsd).toBe(5_000_000_000);
      expect(cells[0]!.RequestCount).toBe(1);
    });
  });

  describe("given a populated summary and the events it came from", () => {
    /** @scenario "Rebuilding the summary from history reproduces it exactly" */
    it("reproduces every row when rebuilt from the event history", async () => {
      const history = [
        confirmed({ costNanoUsd: 5_000_000_000, principalUserId: "user_ada" }),
        confirmed({ costNanoUsd: 7_340_000_000, principalUserId: "user_ada" }),
        confirmed({
          costNanoUsd: 1_000_000_000,
          principalUserId: "user_grace",
        }),
      ];
      for (const event of history) await foldThroughExecutor(event);
      const original = await repo.findCellsForDay({ tenantId, day: DAY });

      // Rebuild into a second tenant from the same history, which is what a
      // replay of the log does: the projection is a pure consequence of the
      // events, so the same events must produce the same numbers.
      const rebuiltTenant = `${tenantId}-rebuilt`;
      const previousTenant = tenantId;
      tenantId = rebuiltTenant;
      for (const event of history) {
        await foldThroughExecutor({
          ...event,
          tenantId: rebuiltTenant,
        } as never);
      }
      const rebuilt = await repo.findCellsForDay({
        tenantId: rebuiltTenant,
        day: DAY,
      });
      tenantId = previousTenant;

      expect(rebuilt).toHaveLength(original.length);
      const comparable = (rows: typeof original) =>
        rows.map((row) => ({
          RawActorId: row.RawActorId,
          Provider: row.Provider,
          Model: row.Model,
          CurrencyCode: row.CurrencyCode,
          AmountNanoUsd: row.AmountNanoUsd,
          TokensInput: row.TokensInput,
          TokensOutput: row.TokensOutput,
          RequestCount: row.RequestCount,
        }));
      expect(comparable(rebuilt)).toEqual(comparable(original));
    });
  });

  describe("given the organization has trace cost for a day", () => {
    /** @scenario "Trace cost stays out of the rollup" */
    it("summarizes the day without any row carrying trace cost", async () => {
      await ch.insert({
        table: "trace_summaries",
        values: [
          {
            ProjectionId: `proj-${nanoid()}`,
            TenantId: tenantId,
            TraceId: `trace-${nanoid()}`,
            Version: "v1",
            Attributes: {},
            OccurredAt: new Date(DAY_MS),
            CreatedAt: new Date(DAY_MS),
            UpdatedAt: new Date(DAY_MS),
            ComputedIOSchemaVersion: "",
            TotalDurationMs: 100,
            SpanCount: 1,
            ContainsErrorStatus: 0,
            ContainsOKStatus: 1,
            Models: ["claude-sonnet-5"],
            TotalCost: 42.5,
            TokensEstimated: false,
            TotalPromptTokenCount: 10,
            TotalCompletionTokenCount: 5,
            OutputFromRootSpan: 0,
            OutputSpanEndTimeMs: 0,
            BlockedByGuardrail: 0,
          },
        ],
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
      });

      await foldThroughExecutor(confirmed({ costNanoUsd: 5_000_000_000 }));

      const cells = await repo.findCellsForDay({ tenantId, day: DAY });
      // The trace's 42.5 USD is nowhere in the summary, under any label: the
      // only row is the gateway one, and the lane vocabulary has no third
      // value for a trace to hide behind.
      expect(cells).toHaveLength(1);
      expect(cells[0]!.CostSource).toBe(GOVERNANCE_COST_SOURCE.GATEWAY);
      expect(cells[0]!.AmountNanoUsd).toBe(5_000_000_000);
      expect(cells.some((cell) => cell.CostSource.includes("trace"))).toBe(
        false,
      );
    });
  });
});
