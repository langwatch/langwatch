// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The seat read against a real ClickHouse: which report of a licence pool
 * answers is decided by the query, so a mock cannot prove it.
 *
 * Spec: specs/governance/governance-cost-screen.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { GovernanceOcsfEvent } from "../../governance.repositories.ts";
import {
  ClickHouseOcsfEventsRepository,
  OCSF_ACTIVITY,
  OCSF_SEVERITY,
} from "../clickhouse.ocsf-events.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const SEAT_REPORT_ACTION = "seat_report";
const SOURCE_ID = `is-${run}`;
const SKU = "AGENT_SEAT_USL";

let client: ClickHouseClient;
let repository: ClickHouseOcsfEventsRepository;

function seatReport({
  tenantId,
  eventId,
  day,
  seatsBought,
  seatsAssigned,
  actionName = SEAT_REPORT_ACTION,
}: {
  tenantId: string;
  eventId: string;
  day: string;
  seatsBought: number;
  seatsAssigned: number;
  actionName?: string;
}): GovernanceOcsfEvent {
  return {
    tenantId,
    eventId,
    traceId: `trace-${eventId}`,
    sourceId: SOURCE_ID,
    sourceType: "microsoft_graph",
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: Temporal.Instant.from(`${day}T06:00:00.000Z`),
    actorUserId: "",
    actorEmail: "",
    actorEnduserId: "",
    actionName,
    targetName: SKU,
    anomalyAlertId: "",
    rawOcsfJson: JSON.stringify({
      class_uid: 6003,
      api: { operation: actionName },
      metadata: {
        product: { name: "LangWatch", vendor_name: "LangWatch" },
        extension: {
          uid: "langwatch.governance",
          ingest_mode: "pull",
          cost_usd: "0",
          skuPartNumber: SKU,
          seatsBought,
          seatsAssigned,
          perPerson: true,
          live: true,
          free: false,
          seatStem: true,
        },
      },
    }),
  };
}

const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

describe.skipIf(!enabled)("the seat read against a real ClickHouse", () => {
  const tenants = { pool: `gov-pool-${run}`, twice: `gov-twice-${run}` };

  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-seat-reports",
      names: ["seats"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the seat suite");

    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        // CLICKHOUSE_CLUSTER switches every engine to a Replicated form no test server can run.
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

    client = createClient({
      url: endpoint.url,
      clickhouse_settings: { date_time_input_format: "best_effort" },
    });
    repository = ClickHouseOcsfEventsRepository.create(async () => client);
    await client.command({ query: "SYSTEM STOP MERGES governance_ocsf_events" });
  }, 180_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES governance_ocsf_events" });
    await client.close();
  }, 60_000);

  describe("given a licence pool recorded on an earlier day and again on a later day", () => {
    /** @scenario A pool that was read on several days reports its newest day only */
    it("reports the pool once, dated the later day, with that day's counts", async () => {
      const tenantId = tenants.pool;
      await repository.insertEvents([
        seatReport({
          tenantId,
          eventId: `evt-early-${run}`,
          day: "2026-08-01",
          seatsBought: 3,
          seatsAssigned: 1,
        }),
      ]);
      await repository.insertEvents([
        seatReport({
          tenantId,
          eventId: `evt-late-${run}`,
          day: "2026-08-02",
          seatsBought: 5,
          seatsAssigned: 4,
        }),
      ]);

      const rows = await repository.findLatestSeatReports({
        tenantId,
        actionName: SEAT_REPORT_ACTION,
      });

      expect(rows).toEqual([
        expect.objectContaining({
          sourceId: SOURCE_ID,
          skuPartNumber: SKU,
          day: "2026-08-02",
          seatsBought: 5,
          seatsAssigned: 4,
        }),
      ]);
    });
  });

  describe("given a day recorded once and then recorded again with different counts", () => {
    /** @scenario A day read twice answers the same before and after a compaction */
    it("reports the second recording's counts both before and after the store compacts", async () => {
      const tenantId = tenants.twice;
      const eventId = `evt-day-${run}`;
      await repository.insertEvents([
        seatReport({ tenantId, eventId, day: "2026-08-05", seatsBought: 2, seatsAssigned: 1 }),
      ]);
      await pause();
      await repository.insertEvents([
        seatReport({ tenantId, eventId, day: "2026-08-05", seatsBought: 7, seatsAssigned: 6 }),
      ]);

      const before = await repository.findLatestSeatReports({
        tenantId,
        actionName: SEAT_REPORT_ACTION,
      });
      await client.command({ query: "SYSTEM START MERGES governance_ocsf_events" });
      await client.command({ query: "OPTIMIZE TABLE governance_ocsf_events FINAL" });
      const after = await repository.findLatestSeatReports({
        tenantId,
        actionName: SEAT_REPORT_ACTION,
      });

      expect(before).toEqual([expect.objectContaining({ seatsBought: 7, seatsAssigned: 6 })]);
      expect(after).toEqual(before);
    });
  });
});
