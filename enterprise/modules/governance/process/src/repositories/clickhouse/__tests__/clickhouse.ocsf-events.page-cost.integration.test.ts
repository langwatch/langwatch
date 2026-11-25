// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * What one page of `governance_ocsf_events` costs, read off ClickHouse's own
 * query log. A page that deduplicates every version past its cursor, or that
 * reads every payload to keep a handful, is correct and still too slow, so a
 * mock cannot prove these: only the server knows what it read.
 *
 * Spec: enterprise/modules/governance/specs/ocsf-event-pages.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { PrismaActivityMonitorRepository } from "../../prisma/prisma.ingestion-source-activity.repository.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const SOURCE_ID = `is-${run}`;
const PAYLOAD_CHARS = 1_000;
/**
 * The export's and the drawer's default page sizes. Above ten rows, so the
 * server's lazy reading of a small LIMIT does not hide what the query asks for.
 */
const EXPORT_PAGE = 500;
const DRAWER_PAGE = 50;

let endpointUrl: string;
let client: ClickHouseClient;

/** `count` events of one tenant per month, from `firstMonth`, each with a heavy payload. */
async function seedMonths({
  tenantId,
  firstMonth,
  perMonth,
}: {
  tenantId: string;
  firstMonth: string;
  perMonth: number[];
}): Promise<void> {
  for (const [offset, count] of perMonth.entries()) {
    await client.command({
      query: `
        INSERT INTO governance_ocsf_events
          (TenantId, EventId, TraceId, SourceId, SourceType, TypeUid, EventTime,
           ActorUserId, ActorEmail, ActorEnduserId, ActionName, TargetName,
           AnomalyAlertId, RawOcsfJson)
        SELECT
          {tenantId:String},
          concat('http_polling:', {sourceId:String}, ':', toString(cityHash64(number, {offset:UInt32}))),
          concat('pull:', toString(number)),
          {sourceId:String}, 'http_polling', 600306,
          addMonths(toDateTime64({firstMonth:String}, 3), {offset:UInt32})
            + toIntervalSecond(number * 60),
          '', '', '', 'completion', 'gpt-5', '',
          concat('{"raw_event":"', randomPrintableASCII({payloadChars:UInt32}), '"}')
        FROM numbers({count:UInt32})
      `,
      query_params: {
        tenantId,
        sourceId: SOURCE_ID,
        firstMonth,
        offset,
        count,
        payloadChars: PAYLOAD_CHARS,
      },
    });
  }
}

/** One read through a client stamped with its own log comment, and what the server read for it. */
async function measured<T>(
  read: (stamped: ClickHouseClient) => Promise<T>,
): Promise<{ result: T; readRows: number; readBytes: number }> {
  const comment = `ocsf-page-cost-${nanoid(10)}`;
  const stamped = createClient({ url: endpointUrl, clickhouse_settings: { log_comment: comment } });
  try {
    const result = await read(stamped);
    await client.command({ query: "SYSTEM FLUSH LOGS" });
    const logged = await client.query({
      query: `
        SELECT count() AS statements, sum(read_rows) AS readRows, sum(read_bytes) AS readBytes
        FROM system.query_log
        WHERE log_comment = {comment:String} AND type = 'QueryFinish' AND query_kind = 'Select'
      `,
      query_params: { comment },
      format: "JSONEachRow",
    });
    const [row] = (await logged.json()) as {
      statements: string;
      readRows: string;
      readBytes: string;
    }[];
    // No logged statement would read as zero cost and pass every bound unmeasured.
    if (!row || Number(row.statements) === 0) {
      throw new Error(`system.query_log holds no finished SELECT for ${comment}`);
    }
    return { result, readRows: Number(row.readRows), readBytes: Number(row.readBytes) };
  } finally {
    await stamped.close();
  }
}

async function storedPayloadBytes(tenantId: string): Promise<number> {
  const result = await client.query({
    query: `SELECT sum(length(RawOcsfJson)) AS bytes FROM governance_ocsf_events
            WHERE TenantId = {tenantId:String}`,
    query_params: { tenantId },
    format: "JSONEachRow",
  });
  const [row] = (await result.json()) as { bytes: string }[];
  return Number(row?.bytes);
}

/**
 * Writes the tenant's 13th event (by time) again, a second later, with a new payload:
 * the newest version every dedup must answer with. Returns its event id.
 */
async function rewriteTheThirteenthEvent(tenantId: string): Promise<string> {
  const [target] = (await (
    await client.query({
      query: `SELECT EventId FROM governance_ocsf_events WHERE TenantId = {tenantId:String}
              ORDER BY EventTime LIMIT 1 OFFSET 12`,
      query_params: { tenantId },
      format: "JSONEachRow",
    })
  ).json()) as { EventId: string }[];
  if (!target) throw new Error(`tenant ${tenantId} holds fewer than 13 events`);
  await client.command({
    query: `
      INSERT INTO governance_ocsf_events
        (TenantId, EventId, TraceId, SourceId, SourceType, TypeUid, EventTime, ActorUserId,
         ActorEmail, ActorEnduserId, ActionName, TargetName, AnomalyAlertId, RawOcsfJson,
         LastUpdatedAt)
      SELECT TenantId, EventId, TraceId, SourceId, SourceType, TypeUid, EventTime, ActorUserId,
             ActorEmail, ActorEnduserId, ActionName, TargetName, AnomalyAlertId,
             '{"rewritten":true}', LastUpdatedAt + toIntervalSecond(1)
      FROM governance_ocsf_events
      WHERE TenantId = {tenantId:String} AND EventId = {eventId:String}
    `,
    query_params: { tenantId, eventId: target.EventId },
  });
  return target.EventId;
}

describe.skipIf(!enabled)("the cost of one governance_ocsf_events page", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-ocsf-page-cost",
      names: ["pages"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the page suite");
    endpointUrl = endpoint.url;

    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
        // CLICKHOUSE_CLUSTER switches every engine to a Replicated form no test server can run.
        const previousCluster = process.env.CLICKHOUSE_CLUSTER;
        delete process.env.CLICKHOUSE_CLUSTER;
        try {
          await ClickHouseMigrateTask.createFromConfig({
            config: { buildTime: false, sharedUrl: endpoint.url, privateEndpoints: [] },
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
    // Unmerged versions are the case the dedup exists for; keep them unmerged.
    await client.command({ query: "SYSTEM STOP MERGES governance_ocsf_events" });
  }, 180_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES governance_ocsf_events" });
    await client.close();
  }, 60_000);

  describe("given a tenant with three months of OCSF events", () => {
    /** @scenario "A SIEM export page after a cursor does not read the history before it" */
    it("reads fewer rows for a page in the last month than the tenant stores before it", async () => {
      const tenantId = `gov-cursor-${run}`;
      await seedMonths({
        tenantId,
        firstMonth: "2026-07-01 00:00:00",
        perMonth: [4000, 4000, 1000],
      });
      const cursorMs = Date.parse("2026-09-01T00:00:00.000Z") - 1;

      const page = await measured((stamped) =>
        ClickHouseOcsfEventsRepository.create(async () => stamped).findAll({
          tenantId,
          sinceMs: cursorMs,
          sinceEventId: "",
          limit: EXPORT_PAGE,
        }),
      );

      expect(page.result).toHaveLength(EXPORT_PAGE);
      expect(page.result.every((event) => event.eventTimeMs > cursorMs)).toBe(true);
      expect(page.readRows).toBeLessThan(8000);
    });
  });

  describe("given a tenant with six months of OCSF events and their payloads", () => {
    /** @scenario "A SIEM export page reads the payload of its own rows only" */
    it("reads less than half the stored payload bytes for the first page", async () => {
      const tenantId = `gov-payload-${run}`;
      await seedMonths({
        tenantId,
        firstMonth: "2026-03-01 00:00:00",
        perMonth: [1500, 1500, 1500, 1500, 1500, 1500],
      });

      const page = await measured((stamped) =>
        ClickHouseOcsfEventsRepository.create(async () => stamped).findAll({
          tenantId,
          sinceMs: 0,
          sinceEventId: "",
          limit: EXPORT_PAGE,
        }),
      );

      expect(page.result).toHaveLength(EXPORT_PAGE);
      expect(page.readBytes).toBeLessThan((await storedPayloadBytes(tenantId)) / 2);
    });
  });

  describe("given an OCSF event written twice, the second time with a new payload", () => {
    /** @scenario "A rewritten event is exported once, at its newest version, across pages" */
    it("exports the event on one page only, carrying the second payload", async () => {
      const tenantId = `gov-rewrite-${run}`;
      await seedMonths({ tenantId, firstMonth: "2026-05-01 00:00:00", perMonth: [30] });
      const target = await rewriteTheThirteenthEvent(tenantId);

      const repository = ClickHouseOcsfEventsRepository.create(async () => client);
      const exported: { eventId: string; rawOcsfJson: string }[] = [];
      let cursor = { sinceMs: 0, sinceEventId: "" };
      for (let pages = 0; pages < 10; pages += 1) {
        const page = await repository.findAll({ tenantId, ...cursor, limit: 7 });
        exported.push(...page);
        const last = page.at(-1);
        if (!last || page.length < 7) break;
        cursor = { sinceMs: last.eventTimeMs, sinceEventId: last.eventId };
      }

      expect(exported).toHaveLength(30);
      const copies = exported.filter((event) => event.eventId === target);
      expect(copies.map((event) => event.rawOcsfJson)).toEqual(['{"rewritten":true}']);
    });
  });

  describe("given a source with six months of pulled OCSF events and their payloads", () => {
    /** @scenario "The newest pulled events of a source read the payload of that page only" */
    it("reads less than half the stored payload bytes for the drawer's newest page", async () => {
      const tenantId = `gov-drawer-${run}`;
      await seedMonths({
        tenantId,
        firstMonth: "2026-03-01 00:00:00",
        perMonth: [1500, 1500, 1500, 1500, 1500, 1500],
      });
      const repository = (stamped: ClickHouseClient) =>
        PrismaActivityMonitorRepository.create({
          prisma: prismaDouble(),
          clickhouse: { getClient: async () => stamped },
        });

      const page = await measured((stamped) =>
        repository(stamped).findPulledEventsForSource({
          organizationId: "org-drawer",
          tenantId,
          sourceId: SOURCE_ID,
          beforeMs: Date.parse("2026-10-01T00:00:00.000Z"),
          limit: DRAWER_PAGE,
        }),
      );

      expect(page.result).toHaveLength(DRAWER_PAGE);
      expect(page.readBytes).toBeLessThan((await storedPayloadBytes(tenantId)) / 2);
    });
  });

  describe("given a pulled OCSF event written twice, the second time with a new payload", () => {
    /** @scenario "A rewritten pulled event appears once in the activity drawer, at its newest version" */
    it("lists the event on one page only, carrying the second payload", async () => {
      const tenantId = `gov-drawer-rewrite-${run}`;
      await seedMonths({ tenantId, firstMonth: "2026-05-01 00:00:00", perMonth: [30] });
      const target = await rewriteTheThirteenthEvent(tenantId);

      const repository = PrismaActivityMonitorRepository.create({
        prisma: prismaDouble(),
        clickhouse: { getClient: async () => client },
      });
      const listed: { eventId: string; rawPayload: string }[] = [];
      let beforeMs = Date.parse("2026-06-01T00:00:00.000Z");
      for (let pages = 0; pages < 10; pages += 1) {
        const page = await repository.findPulledEventsForSource({
          organizationId: "org-drawer",
          tenantId,
          sourceId: SOURCE_ID,
          beforeMs,
          limit: 7,
        });
        listed.push(...page.map(({ eventId, rawPayload }) => ({ eventId, rawPayload })));
        const last = page.at(-1);
        if (!last || page.length < 7) break;
        beforeMs = Date.parse(last.eventTimestampIso);
      }

      expect(listed).toHaveLength(30);
      const copies = listed.filter((event) => event.eventId === target);
      expect(copies.map((event) => event.rawPayload)).toEqual(['{"rewritten":true}']);
    });
  });
});
