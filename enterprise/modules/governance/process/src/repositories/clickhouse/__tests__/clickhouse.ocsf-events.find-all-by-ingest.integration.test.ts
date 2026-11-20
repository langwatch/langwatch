// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The governance events stream read against real ClickHouse: write-order paging, the newest
 * version of an event written again, and the source and time filters.
 *
 * Spec: enterprise/modules/governance/specs/ocsf-siem.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const STORED_AT = Date.parse("2026-10-01T00:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;

let client: ClickHouseClient;

async function store({
  tenantId,
  eventId,
  sourceId,
  sourceType,
  eventTimeMs,
  storedAtMs,
  payload,
}: {
  tenantId: string;
  eventId: string;
  sourceId: string;
  sourceType: string;
  eventTimeMs: number;
  storedAtMs: number;
  payload: string;
}): Promise<void> {
  await client.command({
    query: `
      INSERT INTO governance_ocsf_events
        (TenantId, EventId, TraceId, SourceId, SourceType, TypeUid, EventTime, ActorUserId,
         ActorEmail, ActorEnduserId, ActionName, TargetName, AnomalyAlertId, RawOcsfJson,
         LastUpdatedAt)
      VALUES
        ({tenantId:String}, {eventId:String}, '', {sourceId:String}, {sourceType:String}, 600399,
         fromUnixTimestamp64Milli({eventTimeMs:Int64}), '', '', '', 'invoke', 'gpt-5', '',
         {payload:String}, fromUnixTimestamp64Milli({storedAtMs:Int64}))
    `,
    query_params: { tenantId, eventId, sourceId, sourceType, eventTimeMs, storedAtMs, payload },
  });
}

/** e1 and e2 polled, e3 pushed in, stored a second apart and timed a day apart. */
async function seedThree(tenantId: string): Promise<void> {
  const events = [
    { eventId: "e1", sourceId: "poll-a", sourceType: "http_polling" },
    { eventId: "e2", sourceId: "poll-b", sourceType: "http_polling" },
    { eventId: "e3", sourceId: "okta", sourceType: "ocsf_push" },
  ];
  for (const [index, event] of events.entries()) {
    await store({
      tenantId,
      ...event,
      eventTimeMs: STORED_AT - (3 - index) * DAY,
      storedAtMs: STORED_AT + (index + 1) * 1000,
      payload: `{"v":1,"id":"${event.eventId}"}`,
    });
  }
}

describe.skipIf(!enabled)("ClickHouseOcsfEventsRepository.findAllByIngest", () => {
  let repository: ClickHouseOcsfEventsRepository;

  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-ocsf-ingest-order",
      names: ["stream"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the stream suite");

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

    client = createClient({ url: endpoint.url });
    // Unmerged versions are what the dedup answers for; keep them unmerged.
    await client.command({ query: "SYSTEM STOP MERGES governance_ocsf_events" });
    repository = ClickHouseOcsfEventsRepository.create(async () => client);
  }, 180_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES governance_ocsf_events" });
    await client.close();
  }, 60_000);

  /** @scenario The governance events stream pages in write order and reads an event written again once, at its newest version */
  it("pages by write order and rereads a rewritten event once at its newest version", async () => {
    const tenantId = `gov-stream-${run}`;
    await seedThree(tenantId);

    const first = await repository.findAllByIngest({
      tenantId,
      afterIngestedMs: 0,
      afterEventId: "",
      limit: 2,
    });
    expect(first.map((row) => row.eventId)).toEqual(["e1", "e2"]);
    const lastOfFirst = first.at(-1)!;
    const second = await repository.findAllByIngest({
      tenantId,
      afterIngestedMs: lastOfFirst.ingestedAtMs,
      afterEventId: lastOfFirst.eventId,
      limit: 2,
    });
    expect(second.map((row) => row.eventId)).toEqual(["e3"]);

    await store({
      tenantId,
      eventId: "e1",
      sourceId: "poll-a",
      sourceType: "http_polling",
      eventTimeMs: STORED_AT - 3 * DAY,
      storedAtMs: STORED_AT + 10_000,
      payload: '{"v":2,"id":"e1"}',
    });
    const watermark = second.at(-1)!;
    const resumed = await repository.findAllByIngest({
      tenantId,
      afterIngestedMs: watermark.ingestedAtMs,
      afterEventId: watermark.eventId,
      limit: 10,
    });
    expect(resumed.map((row) => [row.eventId, row.rawOcsfJson])).toEqual([
      ["e1", '{"v":2,"id":"e1"}'],
    ]);

    const fromStart = await repository.findAllByIngest({
      tenantId,
      afterIngestedMs: 0,
      afterEventId: "",
      limit: 10,
    });
    expect(fromStart.map((row) => [row.eventId, row.rawOcsfJson])).toEqual([
      ["e2", '{"v":1,"id":"e2"}'],
      ["e3", '{"v":1,"id":"e3"}'],
      ["e1", '{"v":2,"id":"e1"}'],
    ]);
  });

  /** @scenario The governance events stream filters stored events by source and time */
  it("returns only the events inside the source type, source and time filters", async () => {
    const tenantId = `gov-stream-filter-${run}`;
    await seedThree(tenantId);
    const read = (filter: {
      sourceType?: string;
      sourceId?: string;
      sinceMs?: number;
      untilMs?: number;
    }) =>
      repository
        .findAllByIngest({ tenantId, afterIngestedMs: 0, afterEventId: "", limit: 10, ...filter })
        .then((rows) => rows.map((row) => row.eventId));

    expect(await read({ sourceType: "ocsf_push" })).toEqual(["e3"]);
    expect(await read({ sourceId: "poll-b" })).toEqual(["e2"]);
    expect(await read({ sinceMs: STORED_AT - 2 * DAY, untilMs: STORED_AT - DAY })).toEqual(["e2"]);
  });
});
