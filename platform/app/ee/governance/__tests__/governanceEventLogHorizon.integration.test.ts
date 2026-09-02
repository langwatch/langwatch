// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * How far back the event log reaches, read against the ClickHouse we deploy.
 *
 * The point of the query is that it is an OBSERVATION. A boundary computed
 * from the retention policy would be a prediction, and wrong in both
 * directions — `_retention_days` is stamped from the policy in force when a row
 * was written, and ClickHouse applies a DELETE TTL lazily on merge. So this
 * suite asserts against rows actually sitting in the table.
 *
 * Spec: specs/governance/governance-data-retention.feature
 * Decision: ADR-128 §9 step 4, ADR-022
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { getTestClickHouseClient } from "~/server/event-sourcing/__tests__/integration/testContainers";
import { GovernanceEventLogHorizonClickHouseRepository } from "../services/governanceEventLogHorizon.clickhouse.repository";

const ns = nanoid(8);
const RECENT_TENANT = `project_gov_recent_${ns}`;
const DEEP_TENANT = `project_gov_deep_${ns}`;
const UNKNOWN_TIME_TENANT = `project_gov_untimed_${ns}`;
const EMPTY_TENANT = `project_gov_empty_${ns}`;

const ALL_TENANTS = [
  RECENT_TENANT,
  DEEP_TENANT,
  UNKNOWN_TIME_TENANT,
  EMPTY_TENANT,
];

const ms = (iso: string) => new Date(iso).getTime();

/**
 * One event-log record. Only the columns this file reasons about carry meaning;
 * the rest take the table's defaults.
 */
const event = (overrides: {
  tenantId: string;
  occurredAtMs: number;
  eventId: string;
}) => ({
  TenantId: overrides.tenantId,
  IdempotencyKey: overrides.eventId,
  AggregateType: "governance_cost",
  AggregateId: `agg-${ns}`,
  EventId: overrides.eventId,
  EventType: "PulledUsageRecorded",
  EventVersion: "1",
  EventTimestamp: overrides.occurredAtMs,
  EventPayload: "{}",
  EventOccurredAt: overrides.occurredAtMs,
});

describe("Feature: how far back the event log still reaches", () => {
  let client: ClickHouseClient;
  let repository: GovernanceEventLogHorizonClickHouseRepository;

  beforeAll(async () => {
    const testClient = getTestClickHouseClient();
    if (!testClient) {
      throw new Error(
        "No test ClickHouse client — this suite reads a real event_log and proves nothing without one",
      );
    }
    client = testClient;
    repository = new GovernanceEventLogHorizonClickHouseRepository(
      async () => client,
    );

    await client.insert({
      table: "event_log",
      values: [
        event({
          tenantId: RECENT_TENANT,
          occurredAtMs: ms("2026-08-01T00:00:00.000Z"),
          eventId: `recent-oldest-${ns}`,
        }),
        event({
          tenantId: RECENT_TENANT,
          occurredAtMs: ms("2026-08-25T00:00:00.000Z"),
          eventId: `recent-newest-${ns}`,
        }),
        event({
          tenantId: DEEP_TENANT,
          occurredAtMs: ms("2025-02-14T00:00:00.000Z"),
          eventId: `deep-oldest-${ns}`,
        }),
        event({
          tenantId: DEEP_TENANT,
          occurredAtMs: ms("2026-08-25T00:00:00.000Z"),
          eventId: `deep-newest-${ns}`,
        }),
        // EventOccurredAt defaults to 0 when the producer knew no event time.
        // One of these must not drag the horizon back to 1970.
        event({
          tenantId: UNKNOWN_TIME_TENANT,
          occurredAtMs: 0,
          eventId: `untimed-${ns}`,
        }),
        event({
          tenantId: UNKNOWN_TIME_TENANT,
          occurredAtMs: ms("2026-07-04T00:00:00.000Z"),
          eventId: `untimed-dated-${ns}`,
        }),
      ],
      format: "JSONEachRow",
      clickhouse_settings: { async_insert: 0, wait_for_async_insert: 0 },
    });
  });

  afterAll(async () => {
    await client.exec({
      query: `
        ALTER TABLE event_log
        DELETE WHERE TenantId IN ({tenantIds:Array(String)})
      `,
      query_params: { tenantIds: ALL_TENANTS },
      clickhouse_settings: { mutations_sync: "1" },
    });
  });

  describe("when two areas' logs reach back to different days", () => {
    /** @scenario "Each area is judged against how far its own log reaches" */
    it("reports each area's own oldest event", async () => {
      const horizons = await repository.oldestEventByTenant({
        tenantIds: [RECENT_TENANT, DEEP_TENANT],
      });

      expect(horizons.get(RECENT_TENANT)?.toISOString()).toBe(
        "2026-08-01T00:00:00.000Z",
      );
      expect(horizons.get(DEEP_TENANT)?.toISOString()).toBe(
        "2025-02-14T00:00:00.000Z",
      );
    });
  });

  describe("when an area's log holds nothing", () => {
    /** @scenario "An area whose log cannot be read is retried, not written off" */
    it("names no horizon for it rather than reporting today", async () => {
      const horizons = await repository.oldestEventByTenant({
        tenantIds: [EMPTY_TENANT],
      });

      // The population is real — the same call answers for a tenant that has
      // events — so "absent" here means absent, not "the query found nothing
      // anywhere".
      expect(horizons.has(EMPTY_TENANT)).toBe(false);
      const populated = await repository.oldestEventByTenant({
        tenantIds: [RECENT_TENANT],
      });
      expect(populated.has(RECENT_TENANT)).toBe(true);
    });
  });

  describe("when an area holds an event whose time was never known", () => {
    /** @scenario "Each area is judged against how far its own log reaches" */
    it("ignores it rather than reporting a 1970 horizon", async () => {
      const horizons = await repository.oldestEventByTenant({
        tenantIds: [UNKNOWN_TIME_TENANT],
      });

      // Without the `EventOccurredAt > 0` predicate this reads 1970-01-01, and
      // every affected day then looks replayable.
      expect(horizons.get(UNKNOWN_TIME_TENANT)?.toISOString()).toBe(
        "2026-07-04T00:00:00.000Z",
      );
    });
  });
});
