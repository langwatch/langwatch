// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * @vitest-environment node
 *
 * How a pull run's kept events reach `governance_ocsf_events`: through the real
 * writer and the real ClickHouse repository, counting the INSERT statements the
 * client is asked to send. Each one waits for the async-insert flush, so a page
 * written one event at a time is a page of round trips.
 *
 * Spec: enterprise/modules/governance/specs/ocsf-event-pages.feature
 */
import type {
  GovernanceIngestionSource,
  NormalizedPullEvent,
} from "@langwatch/enterprise-governance-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { clickHouseClientDouble } from "@langwatch/test-harness/client-doubles/clickhouse";
import { describe, expect, it } from "vitest";

import { IngestionPullEventWriterService } from "../../features/ingestion-pull/services/ingestion-pull-event-writer.service.ts";
import { silentIngestionPullDiagnostics } from "../../features/ingestion-pull/services/ingestion-pull-log.service.ts";
import type {
  GovernanceProjectDirectory,
  PulledUsageEntitlements,
} from "../../features/ingestion-pull/services/ingestion-pull-worker.service.ts";
import { PulledUsagePricingService } from "../../features/ingestion-pull/services/pulled-usage-pricing.service.ts";
import { PulledUsageRecordService } from "../../features/ingestion-pull/services/pulled-usage-record.service.ts";
import { ClickHouseOcsfEventsRepository } from "../../repositories/clickhouse/clickhouse.ocsf-events.repository.ts";

const SOURCE: GovernanceIngestionSource = {
  id: "src_batch",
  organizationId: "org-batch",
  teamId: null,
  sourceType: "http_polling",
  name: "Polling",
  description: null,
  ingestSecretHash: "",
  parserConfig: {},
  pollerCursor: null,
  errorCount: 0,
  pullSchedule: null,
  status: "active",
  lastEventAt: null,
  archivedAt: null,
  createdAt: new Date("2026-01-01T00:00:00.000Z"),
  updatedAt: new Date("2026-01-01T00:00:00.000Z"),
  createdById: null,
};

const START_MS = Date.parse("2026-10-01T00:00:00.000Z");

function pulledEvent(index: number, rawPayload = `{"n":${index}}`): NormalizedPullEvent {
  return {
    source_event_id: `evt-${index}`,
    event_timestamp: new Date(START_MS + index * 1_000).toISOString(),
    actor: "alice@acme.test",
    action: "completion",
    target: "gpt-5-mini",
    cost_usd: "0.001",
    tokens_input: 10,
    tokens_output: 5,
    raw_payload: rawPayload,
  };
}

type InsertedRow = { EventId: string; RawOcsfJson: string };
type UnpricedWindow = { since: number; through: number };

/**
 * The real writer over the real repository, over a ClickHouse client that
 * records each INSERT, and an unpriced-window store that records each widening.
 */
function writerOverClickHouse() {
  const statements: InsertedRow[][] = [];
  const widened: UnpricedWindow[] = [];
  const client = clickHouseClientDouble({
    insert: async (params) => {
      statements.push([...(params.values as InsertedRow[])]);
      return { executed: true, query_id: `q-${statements.length}`, response_headers: {} };
    },
  });
  const writer = IngestionPullEventWriterService.create({
    projects: createApiFixture<GovernanceProjectDirectory>({
      ensureInternal: async () => ({
        id: "gov-proj-batch",
        name: "governance",
        slug: "governance",
        teamId: "team-batch",
        kind: "internal_governance",
        archivedAtMs: null,
        traceSharingEnabled: false,
      }),
    }),
    sink: ClickHouseOcsfEventsRepository.create(async () => client),
    usageEntitlement: createApiFixture<PulledUsageEntitlements>({ isEnabled: async () => false }),
    usageRecords: PulledUsageRecordService.create(
      PulledUsagePricingService.create({ rate: () => ({ costNanoUsd: 0, rateVersion: "test" }) }),
    ),
    unpricedWindows: {
      getUnpricedUsageWindow: async () => ({ since: null, through: null }),
      updateUnpricedUsageWindow: async (_sourceId, window) => {
        if (!window.since || !window.through) return;
        widened.push({
          since: window.since.epochMilliseconds,
          through: window.through.epochMilliseconds,
        });
      },
    },
    diagnostics: silentIngestionPullDiagnostics,
    now: () => START_MS,
  });
  return { writer, statements, widened };
}

describe("IngestionPullEventWriterService.writeEvents", () => {
  describe("given a pull run that kept 1,000 events", () => {
    /** @scenario "A page of pulled events reaches the OCSF table in chunked inserts, not one per event" */
    it("sends two INSERT statements of 500 rows, carrying every event once", async () => {
      const { writer, statements } = writerOverClickHouse();
      const events = Array.from({ length: 1_000 }, (_, index) => pulledEvent(index));

      await writer.writeEvents({ events, source: SOURCE });

      expect(statements.length).toBe(2);
      expect(statements.map((rows) => rows.length)).toEqual([500, 500]);
      const eventIds = new Set(statements.flat().map((row) => row.EventId));
      expect(eventIds.size).toBe(1_000);
    });
  });

  describe("given a pull run that kept two copies of the same provider event", () => {
    /** @scenario "An event a pulled page repeats is written once, as its last copy" */
    it("writes one row for the event, carrying the copy sent last", async () => {
      const { writer, statements } = writerOverClickHouse();
      const events = [
        pulledEvent(1, '{"copy":"first"}'),
        pulledEvent(2),
        pulledEvent(1, '{"copy":"last"}'),
      ];

      await writer.writeEvents({ events, source: SOURCE });

      const rows = statements.flat().filter((row) => row.EventId.endsWith(":evt-1"));
      expect(rows).toHaveLength(1);
      expect(rows[0]!.RawOcsfJson).toContain('"copy\\":\\"last\\"');
    });
  });
});

describe("a pulled page too large to spread into Math.min", () => {
  // Node's spread limit sits near 120,000 arguments; this page is past it.
  const PAGE = 200_000;

  /** @scenario "A pulled page too large to spread into Math.min still finds its unpriced window" */
  it("widens the unpriced window from the earliest to the latest dropped price", async () => {
    const { writer, widened } = writerOverClickHouse();
    const droppedPeriodsMs = Array.from({ length: PAGE }, (_, index) => START_MS + index);

    await writer.recordUnpricedUsageWindow({
      source: SOURCE,
      droppedPeriodsMs,
      recordedPeriodsMs: [],
      completeness: "complete",
    });

    expect(widened).toEqual([{ since: START_MS, through: START_MS + PAGE - 1 }]);
  });
});
