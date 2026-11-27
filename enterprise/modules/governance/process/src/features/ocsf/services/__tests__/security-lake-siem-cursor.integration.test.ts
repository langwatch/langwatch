// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * Security Lake events arrive hours after they happened. The SIEM cursor pages by the time a row
 * was stored, so an old event the reader writes after a cursor was handed out is on the next page.
 * Spec: enterprise/modules/governance/specs/security-lake-ingest.feature
 */
import { createClient, type ClickHouseClient } from "@clickhouse/client";
import {
  migrateTestClickHouseOnce,
  startTestClickHouseEndpoints,
} from "@langwatch/clickhouse-client/testing";
import { ClickHouseMigrateTask } from "@langwatch/clickhouse-migrations";
import { securityLakePullConfigSchema } from "@langwatch/enterprise-governance-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { parquetWriteBuffer } from "hyparquet-writer";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { MemoryObjectStoreChannel } from "../../../../channels/memory/memory.object-store.channel.ts";
import { MemorySecurityLakeQueueChannel } from "../../../../channels/memory/memory.security-lake-queue.channel.ts";
import { ClickHouseOcsfEventsRepository } from "../../../../repositories/clickhouse/clickhouse.ocsf-events.repository.ts";
import { OcsfSiemExportService } from "../ocsf-siem-export.service.ts";
import { SecurityLakeReaderService } from "../security-lake-reader.service.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const TENANT = `gov-seclake-cursor-${run}`;
const SOURCE = `src-${run}`;
const BUCKET = "aws-security-data-lake-eu-west-1-acme";
const TWO_HOURS_MS = 2 * 60 * 60 * 1000;

let client: ClickHouseClient;

function bedrockCall({ uid, timeMs }: { uid: string; timeMs: number }): Uint8Array {
  const buffer = parquetWriteBuffer({
    columnData: [
      { name: "class_uid", data: [6003], type: "INT32" },
      { name: "category_uid", data: [6], type: "INT32" },
      { name: "activity_id", data: [99], type: "INT32" },
      { name: "severity_id", data: [1], type: "INT32" },
      { name: "time", data: [BigInt(timeMs)], type: "INT64" },
      { name: "metadata", data: [{ uid, version: "1.1.0" }] },
      {
        name: "api",
        data: [
          {
            operation: "InvokeModel",
            service: { name: "bedrock.amazonaws.com" },
            request: { data: JSON.stringify({ modelId: "anthropic.claude-sonnet-5-5" }) },
          },
        ],
      },
      {
        name: "actor",
        data: [{ user: { uid: "arn:aws:iam::123456789012:role/acme-agent", type: "AssumedRole" } }],
      },
      { name: "cloud", data: [{ region: "eu-west-1", provider: "AWS" }] },
    ],
  });
  return new Uint8Array(buffer);
}

function notification(key: string): string {
  return JSON.stringify({
    "detail-type": "Object Created",
    source: "aws.s3",
    detail: { bucket: { name: BUCKET }, object: { key } },
  });
}

describe.skipIf(!enabled)("the SIEM cursor over Security Lake events", () => {
  beforeAll(async () => {
    const [endpoint] = await startTestClickHouseEndpoints({
      suite: "governance-seclake-cursor",
      names: ["cursor"],
      environment: process.env,
    });
    if (!endpoint) throw new Error("No ClickHouse endpoint was provisioned for the cursor suite");
    await migrateTestClickHouseOnce({
      url: endpoint.url,
      migrate: async () => {
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
  }, 180_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({
      query: "DELETE FROM governance_ocsf_events WHERE TenantId = {tenantId:String}",
      query_params: { tenantId: TENANT },
    });
    await client.close();
  }, 60_000);

  /** @scenario A late Security Lake event reaches the SIEM export after its cursor */
  it("returns an event two hours old by event time, written after the cursor, on the next read", async () => {
    const events = ClickHouseOcsfEventsRepository.create(async () => client);
    const queue = MemorySecurityLakeQueueChannel.create();
    const objects = MemoryObjectStoreChannel.create();
    const reader = SecurityLakeReaderService.create({ queue, objects, events });
    const exporter = OcsfSiemExportService.create({
      events,
      projects: {
        findInternal: async ({ kind }) =>
          (kind === PROJECT_KIND.INTERNAL_GOVERNANCE ? { id: TENANT } : null) as never,
        findLiveNonGovernanceIdsByOrganization: async () => [],
      },
      traces: { listTraceSummaries: async () => ({ summaries: [] }) as never },
      auditLog: { findForOrganization: async () => [] as never },
      now: () => Date.now(),
    });
    const config = securityLakePullConfigSchema.parse({
      adapter: "aws_security_lake",
      region: "eu-west-1",
      subscriberRoleArn: "arn:aws:iam::123456789012:role/AmazonSecurityLake-subscriber",
      queueUrl: "https://sqs.eu-west-1.amazonaws.com/123456789012/acme-subscriber",
    });
    const readLake = async (key: string, uid: string, timeMs: number) => {
      objects.seedBytes({ bucket: BUCKET, key, bytes: bedrockCall({ uid, timeMs }) });
      queue.send({ body: notification(key) });
      return reader.readOnce({ tenantId: TENANT, sourceId: SOURCE, config, credentials: {} });
    };
    const prefix = "aws/CLOUD_TRAIL_MGMT/2.0/region=eu-west-1/accountId=123456789012";

    await expect(readLake(`${prefix}/fresh.parquet`, "fresh", Date.now())).resolves.toMatchObject({
      written: 1,
    });
    const first = await exporter.listEvents({ organizationId: "org_acme", limit: 100 });
    expect(first.data).toHaveLength(1);

    const lateTimeMs = Date.now() - TWO_HOURS_MS;
    await expect(readLake(`${prefix}/late.parquet`, "late", lateTimeMs)).resolves.toMatchObject({
      written: 1,
    });
    const next = await exporter.listEvents({
      organizationId: "org_acme",
      limit: 100,
      cursor: first.next_cursor,
    });

    expect(next.data).toHaveLength(1);
    expect(JSON.stringify(next.data[0])).toContain(`security_lake:${SOURCE}:late`);
    expect(Number(next.data[0]?.time)).toBeLessThan(Date.now() - TWO_HOURS_MS + 60_000);
  });
});
