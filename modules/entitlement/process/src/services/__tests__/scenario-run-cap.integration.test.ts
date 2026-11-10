/**
 * @vitest-environment node
 * The Free scenario run cap over the real billable events meter in ClickHouse: skipped when no
 * test ClickHouse is configured.
 * @see specs/licensing/cloud-free-creation-caps.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import type { Plan } from "@langwatch/entitlement-contract";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BillableEventsMeterClickHouseRepository } from "../../repositories/clickhouse/clickhouse.billable-events-meter.repository.ts";
import { DAY_MS, scenarioRunMonthOf } from "../../rules/scenario-run-cap.rules.ts";
import { ScenarioRunCapService } from "../scenario-run-cap.service.ts";

/** `TEST_CLICKHOUSE_URL` names its own database; `CI_CLICKHOUSE_URL` is the job's migrated one. */
function testClickHouseUrl(): URL | null {
  const configured = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!process.env.TEST_CLICKHOUSE_URL) url.pathname = "/test_langwatch";
  return url;
}

const clickHouseUrl = testClickHouseUrl();
const runId = randomUUID();
const pastGraceOrg = `${runId}-past-grace`;
const inGraceOrg = `${runId}-in-grace`;
const countedOrg = `${runId}-counted`;
const now = Date.UTC(2026, 10, 25, 12);
const STARTED = SIMULATION_RUN_EVENT_TYPES.STARTED;

const FREE: Plan = {
  planSource: "free",
  type: "FREE",
  name: "Free",
  free: true,
  maxMembers: 2,
  maxMembersLite: 0,
  maxMessagesPerMonth: 50_000,
  canPublish: true,
  prices: { USD: 0, EUR: 0 },
  maxScenarioRunsPerMonth: 100,
  scenarioRunGraceDays: 14,
};

let ch: ClickHouseClient;
let meter: BillableEventsMeterClickHouseRepository;

const timestamp = (at: number) => new Date(at).toISOString().replace("T", " ").replace("Z", "");

async function meterEvents(organizationId: string, events: { type: string; at: number }[]) {
  await ch.insert({
    table: "billable_events",
    format: "JSONEachRow",
    values: events.map((event, index) => ({
      OrganizationId: organizationId,
      TenantId: `${organizationId}-project`,
      EventId: `${organizationId}-${index}`,
      EventType: event.type,
      DeduplicationKey: `${organizationId}-${index}`,
      EventTimestamp: timestamp(event.at),
    })),
  });
}

const runsFrom = (firstAt: number, count: number) =>
  Array.from({ length: count }, (_, index) => ({ type: STARTED, at: firstAt + index * 60_000 }));

function capService() {
  return ScenarioRunCapService.create({
    meter,
    plans: { getActivePlan: async () => FREE },
    now: () => now,
  });
}

beforeAll(async () => {
  if (!clickHouseUrl) return;
  ch = createClient({ url: clickHouseUrl });
  meter = BillableEventsMeterClickHouseRepository.create(
    vendorQueryClient({ vendor: ch, indexes: [] }),
  );
  await meterEvents(pastGraceOrg, runsFrom(now - 20 * DAY_MS, 100));
  await meterEvents(inGraceOrg, runsFrom(now - 3 * DAY_MS, 100));
  await meterEvents(countedOrg, [
    { type: STARTED, at: Date.UTC(2026, 9, 10) },
    { type: STARTED, at: Date.UTC(2026, 9, 20) },
    ...runsFrom(Date.UTC(2026, 10, 3), 3),
    ...Array.from({ length: 4 }, (_, index) => ({
      type: "trace",
      at: Date.UTC(2026, 10, 4 + index),
    })),
  ]);
}, 60_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query: "ALTER TABLE billable_events DELETE WHERE startsWith(OrganizationId, {runId:String})",
    query_params: { runId },
  });
  await ch.close();
});

describe.skipIf(!clickHouseUrl)("ScenarioRunCapService over the ClickHouse meter", () => {
  /** @scenario Cloud Free refuses the 101st run of the month after the grace */
  it("refuses the 101st run of the month once the grace is over", async () => {
    await expect(
      capService().assertRunAllowed({ organizationId: pastGraceOrg }),
    ).rejects.toMatchObject({
      code: "resource_limit_exceeded",
      meta: { limitType: "scenarioRuns", current: 100, max: 100 },
    });
  });

  /** @scenario Cloud Free allows any number of runs during the grace */
  it("allows a run past 100 while the grace lasts", async () => {
    await expect(
      capService().assertRunAllowed({ organizationId: inGraceOrg }),
    ).resolves.toBeUndefined();
  });

  /** @scenario The month's runs are counted from the billable events meter */
  it("counts this month's run starts and finds the first run", async () => {
    const { startDate, endDate } = scenarioRunMonthOf(now);
    const [runs, firstRunAt] = await Promise.all([
      meter.countEventType({
        organizationId: countedOrg,
        eventType: STARTED,
        startDate,
        endDate,
      }),
      meter.findFirstEventAt({
        organizationId: countedOrg,
        eventType: STARTED,
      }),
    ]);

    expect(runs).toBe(3);
    expect(firstRunAt).toBe(Date.UTC(2026, 9, 10));
  });
});
