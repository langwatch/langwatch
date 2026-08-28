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

import { GovernanceCostRollupClickHouseRepository } from "../../services/governanceCostRollup.clickhouse.repository";
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

function observed({
  costNanoUsd,
  observedAtMs,
  restatementKey = "bucket-hash",
  costStatus = "estimate",
  id = nanoid(),
}: {
  costNanoUsd: number;
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
          costNanoUsd: 12_340_000_000,
          observedAtMs: Date.parse("2026-08-02T04:00:00.000Z"),
        }),
      );
      await foldThroughExecutor(
        observed({
          costNanoUsd: 9_000_000_000,
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
