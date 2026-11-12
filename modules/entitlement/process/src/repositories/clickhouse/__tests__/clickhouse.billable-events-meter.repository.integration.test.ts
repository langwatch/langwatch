/**
 * @vitest-environment node
 * The meter's reads against the migrated billable_events table: skipped when no test ClickHouse
 * is configured. Spec: modules/entitlement/specs/entitlement-meter-counts.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "@langwatch/log-contract";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "@langwatch/metric-contract";
import { Temporal } from "@langwatch/time";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { metricSeriesHourKey } from "../../../rules/billable-event.rules.ts";
import type { BillableEventRecord } from "../../billable-events-meter.repository.ts";
import { BillableEventsMeterClickHouseRepository } from "../clickhouse.billable-events-meter.repository.ts";

/**
 * `TEST_CLICKHOUSE_URL` names its own database; the native test server
 * (`LANGWATCH_TEST_CLICKHOUSE_URL`) and the CI job's server carry the migrated `test_langwatch`.
 */
function testClickHouseUrl(): URL | null {
  if (process.env.TEST_CLICKHOUSE_URL) return new URL(process.env.TEST_CLICKHOUSE_URL);
  const server = process.env.LANGWATCH_TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!server) return null;
  const url = new URL(server);
  url.pathname = "/test_langwatch";
  return url;
}

const clickHouseUrl = testClickHouseUrl();
const organizationId = `${randomUUID()}-meter`;
const projectId = `${organizationId}-a`;
const SERIES_A = "a".repeat(64);
const SERIES_B = "b".repeat(64);
const window = { startDate: "2026-10-01 00:00:00.000", endDate: "2026-11-01 00:00:00.000" };

let ch: ClickHouseClient;
let meter: BillableEventsMeterClickHouseRepository;

function at(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

function metricRow({ seriesId, iso }: { seriesId: string; iso: string }): BillableEventRecord {
  const keyed = metricSeriesHourKey({
    tenantId: projectId,
    data: { seriesId },
    receivedAtMs: at(iso),
  });
  if (keyed.outcome !== "keyed") throw new Error("expected a series-hour key");
  return {
    organizationId,
    tenantId: projectId,
    eventId: randomUUID(),
    eventType: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
    deduplicationKey: keyed.key,
    eventTimestamp: at(iso),
  };
}

beforeAll(async () => {
  if (!clickHouseUrl) return;
  // The managed client parses ISO timestamps the same way; a server default may not.
  ch = createClient({
    url: clickHouseUrl,
    clickhouse_settings: { date_time_input_format: "best_effort" },
  });
  meter = BillableEventsMeterClickHouseRepository.create(
    vendorQueryClient({ vendor: ch, indexes: [] }),
  );
  // Three points of series-a in the 14:00 hour are one event; its 15:00 point is a second;
  // series-b at 14:00 is a third; two log records are two more.
  const records: BillableEventRecord[] = [
    metricRow({ seriesId: SERIES_A, iso: "2026-10-14T14:00:05Z" }),
    metricRow({ seriesId: SERIES_A, iso: "2026-10-14T14:30:00Z" }),
    metricRow({ seriesId: SERIES_A, iso: "2026-10-14T14:59:59Z" }),
    metricRow({ seriesId: SERIES_A, iso: "2026-10-14T15:00:00Z" }),
    metricRow({ seriesId: SERIES_B, iso: "2026-10-14T14:10:00Z" }),
    ...["record-1", "record-2"].map((recordId) => ({
      organizationId,
      tenantId: projectId,
      eventId: randomUUID(),
      eventType: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
      deduplicationKey: `${projectId}:${recordId}`,
      eventTimestamp: at("2026-10-14T14:20:00Z"),
    })),
  ];
  for (const record of records) await meter.insert({ record, organizationId });
}, 60_000);

afterAll(async () => {
  if (!ch) return;
  await ch.command({
    query: "ALTER TABLE billable_events DELETE WHERE OrganizationId = {organizationId:String}",
    query_params: { organizationId },
  });
  await ch.close();
});

describe.skipIf(clickHouseUrl === null)(
  "BillableEventsMeterClickHouseRepository on ClickHouse",
  () => {
    describe("given repeated metric rows of one series-hour and two log records", () => {
      /** @scenario "ClickHouse counts repeated metric rows of one series-hour once in every read" */
      it("counts each series-hour and each log record once in every read", async () => {
        await expect(meter.findTotal({ organizationId, ...window })).resolves.toBe(5);
        await expect(
          meter.countByProjects({ organizationId, projectIds: [projectId], window }),
        ).resolves.toEqual([{ projectId, count: 5 }]);
        await expect(
          meter.countByDay({ organizationId, projectIds: [projectId], window }),
        ).resolves.toEqual([{ day: "2026-10-14", count: 5 }]);
        await expect(
          meter.countByType({ organizationId, projectIds: [projectId], window }),
        ).resolves.toEqual([
          { eventType: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE, count: 2 },
          { eventType: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE, count: 3 },
        ]);
      });
    });
  },
);
