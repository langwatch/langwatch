// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Ported from main: a read that stopped halfway, restarted later from the period's
 * start, records each day once. Events come from the real ingest seam and fold
 * into the real rollup store over ClickHouse. Spec: pulled-usage-cost-reporting.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import {
  PULLED_USAGE_AGGREGATE_TYPE,
  PULLED_USAGE_EVENT_TYPES,
  PULLED_USAGE_EVENT_VERSIONS,
  pulledUsageObservedEventSchema,
} from "@langwatch/enterprise-governance-contract";
import { createTenantId } from "@langwatch/eventing";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/test-harness/clickhouse";
import { type Instant, Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { GovernanceCostRollupFoldProjection } from "../../eventing/governance-cost-rollup.projection.ts";
import { GovernanceCostRollupStore } from "../../eventing/governance-cost-rollup.store.ts";
import { ClickHouseGovernanceCostRollupRepository } from "../../repositories/clickhouse/clickhouse.governance-cost-rollup.repository.ts";
import { type AzureDailyCost, azureCostEvents } from "../../rules/azure-cost-management.rules.ts";
import { PulledUsagePricingService } from "../pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../pulled-usage-record.service.ts";

const PERIOD = ["2026-01-13", "2026-01-14", "2026-01-15"] as const;
/** What the provider reported for each day: one dollar, in nano-dollars. */
const PROVIDER_DAILY_NANO_USD = 1_000_000_000;
const OBSERVED_AT = Temporal.Instant.from("2026-01-16T09:00:00.000Z");
/** Later than the first read: a restart, not a re-delivery of the first. */
const RESTARTED_AT = Temporal.Instant.from("2026-01-16T11:00:00.000Z");

let clickhouse: ClickHouseClient;
let repository: ClickHouseGovernanceCostRollupRepository;
let tenantId: string;

const records = PulledUsageRecordService.create(
  PulledUsagePricingService.create({ rate: () => ({ costNanoUsd: 0, rateVersion: "test" }) }),
);

function billFor(day: string): AzureDailyCost {
  return {
    day,
    meterCategory: "Foundry Models",
    costMinor: "1.00",
    costUsd: null,
    currencyCode: "USD",
  };
}

/** The cycle the fold executor runs for one event: read the cell, apply, store. */
async function fold(data: unknown): Promise<void> {
  const event = pulledUsageObservedEventSchema.parse({
    id: nanoid(),
    aggregateType: PULLED_USAGE_AGGREGATE_TYPE,
    type: PULLED_USAGE_EVENT_TYPES.OBSERVED,
    version: PULLED_USAGE_EVENT_VERSIONS.OBSERVED,
    tenantId,
    aggregateId: nanoid(),
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

async function readDays({ days, observedAt }: { days: readonly string[]; observedAt: Instant }) {
  for (const event of azureCostEvents({
    days: days.map(billFor),
    subscriptionId: "sub_test_0000",
  })) {
    const record = records.findBuilt({
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
    await fold(record);
  }
}

async function amountFor(day: string): Promise<number> {
  const groups = await repository.sumDaysByProvider({ tenantId, fromDay: day, toDay: day });
  return groups.reduce((total, group) => total + (group.amountNanoUsd ?? 0), 0);
}

describe("given a read that recorded part of a period and then failed", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-pulled-usage-rerun",
      names: ["rerun"],
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the rerun suite");
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
  }, 600_000);

  beforeEach(() => {
    tenantId = `proj-rerun-${nanoid(8)}`;
  });

  afterAll(async () => {
    await clickhouse?.close();
  });

  describe("when a later read covers that period again from the start", () => {
    /** @scenario "Restarting after a read that stopped halfway does not record the spend twice" */
    it("counts each day once, at the figure the provider reported", async () => {
      await readDays({ days: PERIOD.slice(0, 2), observedAt: OBSERVED_AT });
      await readDays({ days: PERIOD, observedAt: RESTARTED_AT });

      for (const day of PERIOD) {
        expect(await amountFor(day)).toBe(PROVIDER_DAILY_NANO_USD);
      }
    });
  });
});
