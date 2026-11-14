// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * The SIEM export page and the spend-spike totals against a real ClickHouse: which version of a
 * replayed row answers is decided by the built read's election, so a mock cannot prove it.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import { vendorQueryClient } from "@langwatch/clickhouse-client/testing";
import { Temporal } from "@langwatch/time";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startMigratedClickHouse } from "../../../__tests__/migrated-clickhouse.harness.ts";
import { OCSF_ACTIVITY, OCSF_SEVERITY } from "../../../rules/ocsf-codes.rules.ts";
import type { GovernanceOcsfEvent } from "../../governance.repositories.ts";
import { ClickHouseAnomalySpendRepository } from "../clickhouse.anomaly-spend.repository.ts";
import { memberClickHouseResolver } from "../clickhouse.governance-clickhouse.repositories.ts";
import { ClickHouseOcsfEventsRepository } from "../clickhouse.ocsf-events.repository.ts";

const enabled = Boolean(
  process.env.LANGWATCH_TEST_CLICKHOUSE_URL ??
  process.env.TEST_CLICKHOUSE_URL ??
  process.env.CI_CLICKHOUSE_URL,
);

const run = nanoid(8);
const pause = () => new Promise((resolve) => setTimeout(resolve, 15));

let client: ClickHouseClient;
let ocsfEvents: ClickHouseOcsfEventsRepository;
let anomalySpend: ClickHouseAnomalySpendRepository;

function ocsfEvent({
  tenantId,
  eventId,
  at,
  targetName,
}: {
  tenantId: string;
  eventId: string;
  at: string;
  targetName: string;
}): GovernanceOcsfEvent {
  return {
    tenantId,
    eventId,
    traceId: `trace-${eventId}`,
    sourceId: `is-${run}`,
    sourceType: "otel_generic",
    activityId: OCSF_ACTIVITY.INVOKE,
    severityId: OCSF_SEVERITY.INFO,
    eventTime: Temporal.Instant.from(at),
    actorUserId: "",
    actorEmail: "",
    actorEnduserId: "",
    actionName: "invoke",
    targetName,
    anomalyAlertId: "",
    rawOcsfJson: "{}",
  };
}

describe.skipIf(!enabled)("governance's built reads against a real ClickHouse", () => {
  beforeAll(async () => {
    client = await startMigratedClickHouse({ suite: "governance-built-reads" });
    // The process's client over the suite's connection: built reads carry the tenant setting.
    const resolve = memberClickHouseResolver(vendorQueryClient({ vendor: client, indexes: [] }));
    ocsfEvents = ClickHouseOcsfEventsRepository.create(resolve);
    anomalySpend = ClickHouseAnomalySpendRepository.create(resolve);
    await client.command({ query: "SYSTEM STOP MERGES governance_ocsf_events" });
    await client.command({ query: "SYSTEM STOP MERGES governance_kpis" });
  }, 240_000);

  afterAll(async () => {
    if (!client) return;
    await client.command({ query: "SYSTEM START MERGES governance_ocsf_events" });
    await client.command({ query: "SYSTEM START MERGES governance_kpis" });
    await client.close();
  }, 60_000);

  describe("given three events, one of them replayed with a later version", () => {
    it("pages each event once, in event-time order, showing the replay's version", async () => {
      const tenantId = `gov-export-${run}`;
      const first = ocsfEvent({
        tenantId,
        eventId: "a",
        at: "2026-08-01T00:00:01Z",
        targetName: "v1",
      });
      await ocsfEvents.insertEvents([
        first,
        ocsfEvent({ tenantId, eventId: "b", at: "2026-08-01T00:00:02Z", targetName: "v1" }),
        ocsfEvent({ tenantId, eventId: "c", at: "2026-08-01T00:00:03Z", targetName: "v1" }),
      ]);
      await pause();
      await ocsfEvents.insertEvents([{ ...first, targetName: "v2" }]);

      const page1 = await ocsfEvents.findAll({ tenantId, sinceMs: 0, sinceEventId: "", limit: 2 });
      const last = page1.at(-1)!;
      const page2 = await ocsfEvents.findAll({
        tenantId,
        sinceMs: Number(last.eventTimeMs),
        sinceEventId: last.eventId,
        limit: 2,
      });

      expect([...page1, ...page2].map((row) => [row.eventId, row.targetName])).toEqual([
        ["a", "v2"],
        ["b", "v1"],
        ["c", "v1"],
      ]);
    });
  });

  describe("given one trace's hour recorded as three running totals", () => {
    it("counts the latest total once, not the sum of all three", async () => {
      const tenantId = `gov-spend-${run}`;
      const hour = Temporal.Instant.from("2026-08-01T10:00:00Z");
      await client.insert({
        table: "governance_kpis",
        values: [1, 2, 3].map((spend) => ({
          TenantId: tenantId,
          SourceId: `is-${run}`,
          SourceType: "otel_generic",
          HourBucket: "2026-08-01 10:00:00",
          TraceId: "trace-1",
          SpendUsd: spend,
          PromptTokens: 0,
          CompletionTokens: 0,
          LastEventOccurredAt: new Date(Date.UTC(2026, 7, 1, 10, spend)).toISOString(),
        })),
        format: "JSONEachRow",
        clickhouse_settings: { async_insert: 0, date_time_input_format: "best_effort" },
      });

      const totals = await anomalySpend.findSpendTotals({
        tenantId,
        windowStart: hour.subtract({ hours: 1 }),
        windowEnd: hour.add({ hours: 1 }),
        baselineStart: hour.subtract({ hours: 24 }),
        sourceFilter: { type: "all" },
      });

      expect(totals).toEqual({ currentSpend: 3, baselineSpend: 0 });
    });
  });
});
