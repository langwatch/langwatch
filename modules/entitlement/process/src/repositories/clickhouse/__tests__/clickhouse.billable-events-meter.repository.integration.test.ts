/**
 * @vitest-environment node
 * The meter's run start key lookup against the migrated ClickHouse the running job supplies:
 * skipped when no test ClickHouse is configured.
 * Spec: specs/licensing/cloud-free-creation-caps.feature
 */
import { randomUUID } from "node:crypto";

import { type ClickHouseClient, createClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { SIMULATION_RUN_EVENT_TYPES } from "@langwatch/scenario-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { BillableEventsMeterClickHouseRepository } from "../clickhouse.billable-events-meter.repository.ts";

/** `TEST_CLICKHOUSE_URL` names its own database; `CI_CLICKHOUSE_URL` is the job's migrated one. */
function testClickHouseUrl(): URL | null {
  const configured = process.env.TEST_CLICKHOUSE_URL ?? process.env.CI_CLICKHOUSE_URL;
  if (!configured) return null;
  const url = new URL(configured);
  if (!process.env.TEST_CLICKHOUSE_URL) url.pathname = "/test_langwatch";
  return url;
}

const clickHouseUrl = testClickHouseUrl();
const organizationId = `${randomUUID()}-meter-key`;
const projectA = `${organizationId}-a`;
const projectB = `${organizationId}-b`;
const startKey = `${projectA}:run_1:startRun`;

let ch: ClickHouseClient;
let meter: BillableEventsMeterClickHouseRepository;

beforeAll(async () => {
  if (!clickHouseUrl) return;
  ch = createClient({ url: clickHouseUrl });
  meter = BillableEventsMeterClickHouseRepository.create(
    vendorQueryClient({ vendor: ch, indexes: [] }),
  );
  await meter.insert({
    organizationId,
    record: {
      organizationId,
      tenantId: projectA,
      eventId: "evt_1",
      eventType: SIMULATION_RUN_EVENT_TYPES.STARTED,
      deduplicationKey: startKey,
      eventTimestamp: Date.now(),
    },
  });
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
    describe("given a run start metered under its key", () => {
      /** @scenario A retried run start is counted once */
      it("finds the key for its project", async () => {
        await expect(
          meter.hasDeduplicationKey({
            organizationId,
            projectId: projectA,
            deduplicationKey: startKey,
          }),
        ).resolves.toBe(true);
      });

      /** @scenario A retried run start is counted once */
      it("does not find another run's key, nor the key under another project", async () => {
        await expect(
          meter.hasDeduplicationKey({
            organizationId,
            projectId: projectA,
            deduplicationKey: `${projectA}:run_2:startRun`,
          }),
        ).resolves.toBe(false);
        await expect(
          meter.hasDeduplicationKey({
            organizationId,
            projectId: projectB,
            deduplicationKey: startKey,
          }),
        ).resolves.toBe(false);
      });
    });
  },
);
