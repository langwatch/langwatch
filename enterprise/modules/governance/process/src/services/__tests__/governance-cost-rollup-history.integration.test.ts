// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The cost summary over a real ClickHouse: a restated day read before storage compacts, the
 * summary replayed from its recorded events. Events come from the real ingest seam and fold
 * into the real rollup store.
 * Spec: specs/governance/governance-cost-rollup.feature, governance-cost-restatement-markers.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
  pulledUsageObservedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import { createTenantId } from "@langwatch/eventing";
import { type Instant, Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { GovernanceCostRollupFoldProjection } from "../../eventing/governance-cost-rollup.projection.ts";
import { GovernanceCostRollupStore } from "../../eventing/governance-cost-rollup.store.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../../repositories/clickhouse/clickhouse.governance-cost-rollup.repository.ts";
import { type AzureDailyCost, azureCostEvents } from "../../rules/azure-cost-management.rules.ts";
import { PulledUsagePricingService } from "../pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../pulled-usage-record.service.ts";

const DAY = "2026-01-14";
const OTHER_DAY = "2026-01-15";
const FIRST_READ = Temporal.Instant.from("2026-01-16T09:00:00.000Z");
const RESTATED_READ = Temporal.Instant.from("2026-01-17T09:00:00.000Z");
const NANO = 1_000_000_000;

let clickhouse: ClickHouseClient;
let repository: ClickHouseGovernanceCostRollupRepository;

const records = PulledUsageRecordService.create(
  PulledUsagePricingService.create({ rate: () => ({ costNanoUsd: 0, rateVersion: "test" }) }),
);

function bill({ day, costMinor }: { day: string; costMinor: string }): AzureDailyCost {
  return { day, meterCategory: "Foundry Models", costMinor, costUsd: null, currencyCode: "USD" };
}

type ObservedData = NonNullable<ReturnType<typeof records.findBuilt>>;

/** The pulled-usage records one read of these bills produces, in the order they were read. */
function readOf({
  tenantId,
  bills,
  observedAt,
}: {
  tenantId: string;
  bills: AzureDailyCost[];
  observedAt: Instant;
}): ObservedData[] {
  return azureCostEvents({ days: bills, subscriptionId: "sub_test_0000" }).map((event) => {
    const record = records.findBuilt({
      event,
      source: {
        ingestionSourceId: "src_a",
        sourceType: "copilot_studio_dataverse",
        organizationId: "org_test_history",
        teamId: null,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
      },
      governanceProjectId: tenantId,
      observedAt,
    });
    if (!record) throw new Error("test bug: the bill produced no usage record");

    return record;
  });
}

/** The cycle the fold executor runs for one event: read the cell, apply, store. */
async function fold({
  tenantId,
  eventId,
  data,
}: {
  tenantId: string;
  eventId: string;
  data: ObservedData;
}): Promise<void> {
  const event = pulledUsageObservedEventSchema.parse({
    id: eventId,
    aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
    type: PULLED_USAGE_EVENT_TYPES.OBSERVED,
    version: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
    tenantId,
    aggregateId: `agg-${eventId}`,
    createdAt: Date.now(),
    occurredAt: Date.now(),
    data,
  });
  const store = GovernanceCostRollupStore.create(repository);
  const projection = GovernanceCostRollupFoldProjection.create({
    store,
    actorIds: { actorIdForRollupWrite: ({ rawActorId }) => rawActorId },
  });
  const context = {
    aggregateId: event.aggregateId,
    tenantId: createTenantId(tenantId),
    key: projection.key(event),
  };
  const read = await store.getWithApplied(event.aggregateId, context);
  const state = projection.apply(read.state ?? projection.init(), event);
  await store.store(state, { ...context, appliedEventIds: [...read.appliedEventIds, event.id] });
}

type RecordedEvent = { eventId: string; data: ObservedData };

/** Events with identities of their own, so replaying them is replaying the same history. */
function recorded({ label, reads }: { label: string; reads: ObservedData[][] }): RecordedEvent[] {
  return reads.flat().map((data, index) => ({ eventId: `${label}-${index}`, data }));
}

async function foldAll({ tenantId, events }: { tenantId: string; events: RecordedEvent[] }) {
  for (const { eventId, data } of events) {
    await fold({ tenantId, eventId, data });
  }
}

/** What the summary holds for a day, with the columns that name a tenant or a moment removed. */
async function summaryOf({ tenantId, day }: { tenantId: string; day: string }) {
  const rows = await repository.findCellsForDay({
    tenantId,
    day,
    costSource: "pulled",
  });

  return rows.map(
    ({
      TenantId: _tenant,
      CreatedAt: _created,
      EventTimestamp: _timestamp,
      LastEventOccurredAt: _occurred,
      AppliedEventIds: _applied,
      OrganizationId: _organization,
      ...held
    }) => held,
  );
}

describe.skipIf(
  !(
    process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
    process.env.TEST_CLICKHOUSE_URL ??
    process.env.CI_CLICKHOUSE_URL
  ),
)("the cost summary over a real ClickHouse", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-cost-history",
      names: ["history"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the history suite");
    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: {
              buildTime: false,
              skipped: false,
              sharedUrl: endpoint.url,
              privateEndpoints: [],
              settings: {
                coldStorageEnabled: false,
                hotDayOverrides: {},
                childEnvironment: { PATH: process.env.PATH, HOME: process.env.HOME },
              },
            },
          }).execute();
        } finally {
          if (previousCluster !== undefined) process.env.CLICKHOUSE_CLUSTER = previousCluster;
        }
      },
    });
    clickhouse = createClient({ url: endpoint.url });
    repository = ClickHouseGovernanceCostRollupRepository.create(async () => clickhouse);
    await clickhouse.command({ query: "SYSTEM STOP MERGES governance_cost_rollup_1d" });
  }, 600_000);

  afterAll(async () => {
    if (!clickhouse) return;
    await clickhouse.command({ query: "SYSTEM START MERGES governance_cost_rollup_1d" });
    await clickhouse.close();
  });

  describe("given a day that was restated", () => {
    /** @scenario The markers survive a read taken before storage compacts */
    it("reads only the newest revision marker and last-observed time before the store compacts", async () => {
      const tenantId = `proj-markers-${nanoid(8)}`;
      await foldAll({
        tenantId,
        events: recorded({
          label: "markers",
          reads: [
            readOf({
              tenantId,
              bills: [bill({ day: DAY, costMinor: "1.00" })],
              observedAt: FIRST_READ,
            }),
            readOf({
              tenantId,
              bills: [bill({ day: DAY, costMinor: "2.00" })],
              observedAt: RESTATED_READ,
            }),
          ],
        }),
      });

      const stored = await clickhouse.query({
        query:
          "SELECT count() AS versions FROM governance_cost_rollup_1d WHERE TenantId = {tenantId:String}",
        query_params: { tenantId },
        format: "JSONEachRow",
      });
      const [cell] = await repository.findCellsForDay({ tenantId, day: DAY, costSource: "pulled" });

      expect(Number((await stored.json<{ versions: string }>())[0]?.versions)).toBeGreaterThan(1);
      expect(cell).toMatchObject({
        AmountNanoUsd: 2 * NANO,
        PreviousAmountNanoUsd: NANO,
        RevisionCount: 1,
        LastObservedAt: RESTATED_READ.epochMilliseconds / 1000,
        RevisedAt: RESTATED_READ.epochMilliseconds / 1000,
      });
    });
  });

  describe("given the organization has trace cost for a day", () => {
    describe("when that day is summarized and read", () => {
      /** @scenario Trace cost stays out of the rollup */
      it("holds no row for trace cost under any lane", async () => {
        const tenantId = `proj-trace-cost-${nanoid(8)}`;
        await clickhouse.insert({
          table: "trace_summaries",
          values: [
            {
              ProjectionId: `projn-${nanoid()}`,
              TenantId: tenantId,
              TraceId: `trace-${nanoid()}`,
              Version: "v1",
              OccurredAt: `${DAY} 10:00:00.000`,
              TotalDurationMs: 250,
              SpanCount: 1,
              ContainsErrorStatus: false,
              ContainsOKStatus: true,
              Models: ["gpt-5-mini"],
              TotalCost: 7.5,
              TokensEstimated: false,
            },
          ],
          format: "JSONEachRow",
          clickhouse_settings: { date_time_input_format: "best_effort" },
        });
        await foldAll({
          tenantId,
          events: recorded({
            label: "trace-cost",
            reads: [
              readOf({
                tenantId,
                bills: [bill({ day: DAY, costMinor: "1.00" })],
                observedAt: FIRST_READ,
              }),
            ],
          }),
        });

        const lanes = await repository.sumDaysByLane({ tenantId, fromDay: DAY, toDay: DAY });

        expect(lanes.map(({ costSource }) => costSource)).toEqual(["pulled"]);
        expect(lanes[0]?.amountNanoUsd).toBe(NANO);
      });
    });
  });

  describe("given a populated summary", () => {
    const historyOf = (tenantId: string) =>
      recorded({
        label: "history",
        reads: [
          readOf({
            tenantId,
            bills: [
              bill({ day: DAY, costMinor: "1.00" }),
              bill({ day: OTHER_DAY, costMinor: "3.00" }),
            ],
            observedAt: FIRST_READ,
          }),
          readOf({
            tenantId,
            bills: [bill({ day: DAY, costMinor: "2.00" })],
            observedAt: RESTATED_READ,
          }),
        ],
      });

    describe("when the summary is rebuilt from the event history", () => {
      /** @scenario Rebuilding the summary from history reproduces it exactly */
      it("holds the same rows as the original summary", async () => {
        const original = `proj-original-${nanoid(8)}`;
        const rebuilt = `proj-rebuilt-${nanoid(8)}`;
        await foldAll({ tenantId: original, events: historyOf(original) });
        await foldAll({ tenantId: rebuilt, events: historyOf(rebuilt) });

        for (const day of [DAY, OTHER_DAY]) {
          const before = await summaryOf({ tenantId: original, day });
          expect(before.length).toBeGreaterThan(0);
          expect(await summaryOf({ tenantId: rebuilt, day })).toEqual(before);
        }
      });
    });
  });
});
