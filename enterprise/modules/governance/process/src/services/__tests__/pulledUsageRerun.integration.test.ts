// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What a restart does to money a half-finished read had already recorded.
 *
 * A read can stop before the end without failing — a page limit, a deadline,
 * or a failure after some pages have already landed. All three leave money
 * recorded for part of a period and the rest of it unread, and the run that
 * follows covers the period again from the start. If the second pass ADDED
 * rather than replaced, every restart would inflate the days the first pass
 * reached, and the customer's own console would be the only place the real
 * figure existed.
 *
 * The events are built by the real ingest seam rather than hand-written: the
 * restatement key is a hash of the adapter's own coordinates, and a key typed
 * out here would prove the test agrees with itself and nothing more.
 *
 * Spec: specs/governance/pulled-usage-cost-reporting.feature
 * Decision: ADR-128.
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import {
  FoldProjectionExecutor,
  type FoldProjectionDefinition,
  type ProjectionStoreContext,
} from "@langwatch/eventing";
import { migrateTestClickHouseOnce, startTestClickHouseEndpoints } from "@langwatch/test-harness/clickhouse";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import {
  GovernanceCostRollupFoldProjection,
  type GovernanceCostRollupState,
  governanceCostRollupKey,
} from "../../../projections/governanceCostRollup.foldProjection";
import { GovernanceCostRollupStore } from "../../../projections/governanceCostRollup.store";
import { GovernanceCostRollupClickHouseRepository } from "../../governanceCostRollup.clickhouse.repository";
import { type AzureDailyCost, azureCostEvents } from "../azure-cost-management.service";
import { buildPulledUsageRecord } from "../pulledUsageRecord";

/** Well inside the table's retention horizon, so nothing is swept mid-test. */
const PERIOD = ["2026-01-13", "2026-01-14", "2026-01-15"] as const;
/** What the provider reported for each day. One dollar, in nano-dollars. */
const PROVIDER_DAILY_NANO_USD = 1_000_000_000;

const SUBSCRIPTION_ID = "sub_test_0000";
/** When the read that stopped halfway looked. */
const OBSERVED_AT = new Date("2026-01-16T09:00:00.000Z");
/**
 * When the restarted read looked — LATER, and that is the point.
 *
 * The fold ranks an observation against the one an item already holds and
 * declines anything not newer. A second pass stamped with the same instant is
 * therefore a re-delivery of the first, which proves the log collapses
 * duplicates and says nothing at all about a genuinely later run covering the
 * period again.
 */
const RESTARTED_AT = new Date("2026-01-16T11:00:00.000Z");

let ch: ClickHouseClient;
let repo: GovernanceCostRollupClickHouseRepository;
let store: GovernanceCostRollupStore;
let tenantId: string;

function billFor(day: string): AzureDailyCost {
  return {
    day,
    meterCategory: "Foundry Models",
    costMinor: "1.00",
    costUsd: null,
    currencyCode: "USD",
  };
}

/**
 * One read of a span of days, all the way through the real ingest seam:
 * adapter events, then the priced record each becomes, then the fold.
 */
async function readDays({
  days,
  observedAt,
}: {
  days: readonly string[];
  observedAt: Date;
}): Promise<void> {
  const events = azureCostEvents({
    days: days.map(billFor),
    subscriptionId: SUBSCRIPTION_ID,
  });
  for (const event of events) {
    const record = buildPulledUsageRecord({
      event,
      source: {
        ingestionSourceId: "src_a",
        sourceType: "copilot_studio_dataverse",
        organizationId: "org_test_rerun",
        teamId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      governanceProjectId: tenantId,
      observedAt,
    });
    if (!record) throw new Error("test bug: the bill produced no usage record");
    await foldThroughExecutor({
      id: nanoid(),
      type: "lw.obs.pulled_usage.observed",
      tenantId,
      aggregateId: record.restatementKey,
      occurredAt: record.occurredAtMs,
      data: record,
    });
  }
}

async function foldThroughExecutor(event: {
  id: string;
  type: string;
  tenantId: string;
  aggregateId: string;
  occurredAt: number;
  data: unknown;
}): Promise<void> {
  const projection = new GovernanceCostRollupFoldProjection({ store });
  const context: ProjectionStoreContext = {
    aggregateId: event.aggregateId,
    tenantId: tenantId as never,
    key: governanceCostRollupKey(event as never),
    deliveryAttempt: 1,
  };
  await new FoldProjectionExecutor().execute(
    projection as unknown as FoldProjectionDefinition<GovernanceCostRollupState, never>,
    event as never,
    context,
  );
}

async function amountFor(day: string): Promise<number> {
  const cells = await repo.findCellsForDay({ tenantId, day });
  return cells.reduce((total, cell) => total + Number(cell.AmountNanoUsd), 0);
}

describe("given a read that recorded part of a period and then failed", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-pulled-usage-rerun",
      names: ["rollup"],
    });
    if (!endpoint)
      throw new Error("No ClickHouse endpoint was provisioned for the pulled-usage-rerun suite");

    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        // CLICKHOUSE_CLUSTER switches every engine to its Replicated form,
        // which needs a Keeper no test server has.
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: {
              buildTime: false,
              skipped: false,
              sharedUrl: endpoint.url,
              privateEndpoints: [],
            },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });

    ch = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    repo = new GovernanceCostRollupClickHouseRepository(async () => ch);
    store = new GovernanceCostRollupStore(repo);
  });

  beforeEach(() => {
    // A fresh tenant per test: the table is shared, so tests must not be able
    // to see each other's rows.
    tenantId = `proj-rerun-${nanoid(8)}`;
  });

  afterAll(async () => {
    await ch?.close();
  });

  describe("when a later read covers that period again from the start", () => {
    /** @scenario "Restarting after a read that stopped halfway does not record the spend twice" */
    it("counts each day once, at the figure the provider reported", async () => {
      // The read that stopped halfway: it reached the first two days.
      await readDays({ days: PERIOD.slice(0, 2), observedAt: OBSERVED_AT });
      // The restart: the whole period again, from its start, and looking at a
      // later moment — which is what makes the second pass a restarted run
      // rather than a re-delivery of the first.
      await readDays({ days: PERIOD, observedAt: RESTARTED_AT });

      for (const day of PERIOD) {
        expect(await amountFor(day)).toBe(PROVIDER_DAILY_NANO_USD);
      }
      const total = (await Promise.all(PERIOD.map((day) => amountFor(day)))).reduce(
        (sum, amount) => sum + amount,
        0,
      );
      // Three days at the provider's figure — not the five day-reads it took
      // to get there.
      expect(total).toBe(3 * PROVIDER_DAILY_NANO_USD);
    });
  });
});
