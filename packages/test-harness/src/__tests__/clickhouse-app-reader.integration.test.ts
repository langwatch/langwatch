/**
 * The app reader helper on a 26.8 container: the reader client sees only the tenants a read
 * names, its row policy hides the rest even when the statement text admits them, and the system
 * client sees every tenant. @see specs/clickhouse/app-reader-identity.feature
 */
import { type ClickHouseClient, createClient } from "@clickhouse/client";
import {
  clickhouseRead,
  column,
  defineClickHouseTable,
  tenantScope,
} from "@langwatch/clickhouse-client/builder";
import {
  startTestClickHouseEndpoints,
  type TestClickHouseEndpoint,
} from "@langwatch/clickhouse-client/testing";
import { APP_READER_NAMES } from "@langwatch/clickhouse-migrations";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { provisionTestAppReader, type TestAppReader } from "../clickhouse-app-reader.ts";

const TENANT_A = "project_app_reader_a";
const TENANT_B = "project_app_reader_b";

/** A tenant table the reader is granted, cut down to the columns this suite writes. */
const billableEvents = defineClickHouseTable({
  name: "billable_events",
  tenantColumn: "TenantId",
  sortKey: ["TenantId", "EventId"],
  columns: { TenantId: column.string(), EventId: column.string() },
});

const eventsOf = ({ tenantIds }: { tenantIds: readonly string[] }) => ({
  statement: clickhouseRead({ scope: tenantScope.set({ tenantIds }) })
    .from(billableEvents)
    .select({ Tenant: billableEvents.TenantId, Event: billableEvents.EventId })
    .build(),
  table: billableEvents.$table.name,
});

let endpoint: TestClickHouseEndpoint;
let admin: ClickHouseClient;
let appReader: TestAppReader;

beforeAll(async () => {
  const { LANGWATCH_TEST_CLICKHOUSE_URL: _native, ...containerOnly } = process.env;
  [endpoint] = (await startTestClickHouseEndpoints({
    suite: "test-harness-app-reader",
    names: ["reader"],
    environment: containerOnly,
  })) as [TestClickHouseEndpoint];
  admin = createClient({ url: endpoint.url });
  await admin.command({ query: "DROP TABLE IF EXISTS billable_events SYNC" });
  await admin.command({
    query:
      "CREATE TABLE billable_events (TenantId String, EventId String) " +
      "ENGINE = MergeTree ORDER BY (TenantId, EventId)",
  });
  await admin.insert({
    table: "billable_events",
    values: [
      { TenantId: TENANT_A, EventId: "a1" },
      { TenantId: TENANT_A, EventId: "a2" },
      { TenantId: TENANT_B, EventId: "b1" },
    ],
    format: "JSONEachRow",
  });
  appReader = await provisionTestAppReader({ endpoint, environment: process.env });
}, 180_000);

afterAll(async () => {
  await appReader?.close();
  await admin?.close();
});

describe("provisionTestAppReader", () => {
  it("reads as the reader and sees only the tenant a read names", async () => {
    const { rows } = await appReader.reader.read(eventsOf({ tenantIds: [TENANT_A] }));

    expect(rows.map(({ Event }) => Event).toSorted()).toEqual(["a1", "a2"]);
  });

  it("sees each tenant of a declared set", async () => {
    const { rows } = await appReader.reader.read(eventsOf({ tenantIds: [TENANT_A, TENANT_B] }));

    expect(rows.map(({ Event }) => Event).toSorted()).toEqual(["a1", "a2", "b1"]);
  });

  it("hides another tenant's rows by its row policy when the text admits them", async () => {
    const reader = createClient({ url: appReader.readerUrl });
    try {
      const answer = async (settings: Record<string, string>) =>
        (
          await (
            await reader.query({
              query: "SELECT TenantId FROM billable_events ORDER BY EventId",
              format: "JSONEachRow",
              clickhouse_settings: settings,
            })
          ).json<{ TenantId: string }>()
        ).map(({ TenantId }) => TenantId);

      expect(await answer({ [APP_READER_NAMES.tenantSetting]: TENANT_B })).toEqual([TENANT_B]);
      expect(await answer({})).toEqual([]);
    } finally {
      await reader.close();
    }
  });

  it("reads every tenant through the system client", async () => {
    const { rows } = await appReader.system.read(eventsOf({ tenantIds: [TENANT_A, TENANT_B] }));

    expect(rows).toHaveLength(3);
  });

  it("holds the server until close, so another provision waits and every read answers", async () => {
    let provisioned = false;
    const waiting = provisionTestAppReader({ endpoint, environment: process.env }).then((next) => {
      provisioned = true;
      return next;
    });

    const answers = await Promise.all(
      Array.from({ length: 60 }, () => appReader.reader.read(eventsOf({ tenantIds: [TENANT_A] }))),
    );

    for (const { rows } of answers) {
      expect(rows.map(({ Event }) => Event).toSorted()).toEqual(["a1", "a2"]);
    }
    expect(provisioned).toBe(false);
    await appReader.close();
    appReader = await waiting;
    const { rows } = await appReader.reader.read(eventsOf({ tenantIds: [TENANT_A] }));
    expect(rows.map(({ Event }) => Event).toSorted()).toEqual(["a1", "a2"]);
  });

  it("refuses the shared native server by the reader's name", async () => {
    await expect(
      provisionTestAppReader({
        endpoint,
        environment: { LANGWATCH_TEST_CLICKHOUSE_URL: endpoint.url },
      }),
    ).rejects.toThrow(APP_READER_NAMES.user);
  });
});
