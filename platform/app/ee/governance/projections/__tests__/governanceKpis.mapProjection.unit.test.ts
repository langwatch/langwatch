// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

/**
 * `governanceKpis` — the /governance spend stream as a real projection
 * (ADR-075 Class C, retired; ground now ADR-098).
 *
 * ADR-075 singles this one out: "governance_kpis is the one that needs
 * work: it is an incrementing aggregate per (org, source, hour_bucket), so
 * re-deriving it means recomputing the bucket rather than re-applying a
 * delta." The shape chosen instead makes the CONTRIBUTION SET idempotent
 * and leaves the bucket a read-time `sum(...)`, so a rebuild is a
 * set-union of rows the set already holds. These tests execute that claim
 * rather than asserting it.
 *
 * The REAL projection runs through the REAL `MapProjectionExecutor` and
 * the REAL `AppendStore` into a ClickHouse engine double modelling
 * `governance_kpis` exactly as migrations 00031 + 00063 declare it:
 * `ReplacingMergeTree(LastEventOccurredAt)`
 * `ORDER BY (TenantId, SourceId, HourBucket, TraceId, EventId)`.
 *
 * Spec: specs/ai-gateway/governance/folds.feature
 */

import type {
  GovernanceKpiContribution,
  GovernanceKpisClickHouseRepository,
} from "@ee/governance/services/governanceKpis.clickhouse.repository";
import { describe, expect, it } from "vitest";
import { MapProjectionExecutor } from "~/server/event-sourcing.old/projections/mapProjectionExecutor";
import type { ProjectionStoreContext } from "~/server/event-sourcing.old/projections/projectionStoreContext";
import {
  createSpanReceivedEvent,
  type TestSpanReceivedEventOptions,
} from "~/server/event-sourcing.old/pipelines/trace-processing/projections/__tests__/fixtures/trace-summary-test.fixtures";
import type { SpanReceivedEvent } from "~/server/event-sourcing.old/pipelines/trace-processing/schemas/events";
import { createGovernanceKpisProjection } from "../governanceProjections.composition";
import { GovernanceKpisMapProjection } from "../governanceKpis.mapProjection";
import { GovernanceKpisAppendStore } from "../governanceKpis.store";
import { ReplacingMergeTreeDouble } from "./replacingMergeTree.double";

const TENANT_ID = "gov-project-1";

/** 2023-11-14T22:13:20.500Z — deliberately mid-hour. */
const SPAN_START_MS = 1_700_000_000_500;
const HOUR_MS = 60 * 60 * 1000;

const GOVERNANCE_ATTRS = {
  "langwatch.origin.kind": "ingestion_source",
  "langwatch.ingestion_source.id": "is-1",
  "langwatch.ingestion_source.source_type": "claude_compliance",
} as const;

function governanceSpanEvent(
  options: TestSpanReceivedEventOptions & { costUsd?: number } = {},
): SpanReceivedEvent {
  const { costUsd, ...rest } = options;
  return createSpanReceivedEvent({
    tenantId: TENANT_ID,
    occurredAt: SPAN_START_MS,
    ...rest,
    attributes: {
      ...GOVERNANCE_ATTRS,
      // An explicit per-span cost keeps the assertions about the PROJECTION
      // rather than about the model price registry. SpanCostService treats a
      // reported cost as authoritative over the token x registry estimate.
      ...(costUsd === undefined ? {} : { "langwatch.span.cost": costUsd }),
      ...(rest.attributes ?? {}),
    },
  });
}

/** `governance_kpis` as migrations 00031 + 00063 declare it. */
function kpiTable() {
  return new ReplacingMergeTreeDouble<GovernanceKpiContribution>({
    orderBy: (row) =>
      [
        row.tenantId,
        row.sourceId,
        row.hourBucket.getTime(),
        row.traceId,
        row.eventId ?? "",
      ].join(" "),
    version: (row) => row.lastEventOccurredAt.getTime(),
  });
}

/** The pre-00063 sorting key, for the test that shows why it had to change. */
function preMigrationKpiTable() {
  return new ReplacingMergeTreeDouble<GovernanceKpiContribution>({
    orderBy: (row) =>
      [row.tenantId, row.sourceId, row.hourBucket.getTime(), row.traceId].join(
        " ",
      ),
    version: (row) => row.lastEventOccurredAt.getTime(),
  });
}

async function runProjection({
  events,
  table,
  dropEventIds = new Set<string>(),
}: {
  events: SpanReceivedEvent[];
  table: ReplacingMergeTreeDouble<GovernanceKpiContribution>;
  dropEventIds?: Set<string>;
}): Promise<void> {
  const repository = {
    insertContribution: async (row: GovernanceKpiContribution) => {
      if (dropEventIds.has(row.eventId ?? "")) throw new Error("CH write failed");
      table.insert([row]);
    },
    insertContributions: async (rows: GovernanceKpiContribution[]) => {
      table.insert(rows.filter((row) => !dropEventIds.has(row.eventId ?? "")));
    },
  } as unknown as GovernanceKpisClickHouseRepository;

  // The composition the registry wires, not a hand-assembled stand-in.
  const projection = createGovernanceKpisProjection({
    governanceKpisRepository: repository,
  });
  const executor = new MapProjectionExecutor();

  for (const event of events) {
    const context: ProjectionStoreContext = {
      aggregateId: String(event.aggregateId),
      tenantId: event.tenantId,
    };
    try {
      await executor.execute(projection, event, context);
    } catch {
      // A failed CH write is exactly the drift the rebuild has to correct.
    }
  }
}

/** What the /governance KPI strip and the spend_spike rule read. */
function bucketSpend(rows: GovernanceKpiContribution[]): number {
  return rows.reduce((total, row) => total + row.spendUsd, 0);
}

function mapOne(
  options: TestSpanReceivedEventOptions & { costUsd?: number } = {},
): GovernanceKpiContribution | null {
  const projection = new GovernanceKpisMapProjection({
    store: { append: async () => {} },
  });
  return projection.mapTraceSpanReceived(governanceSpanEvent(options));
}

describe("GovernanceKpisMapProjection", () => {
  describe("given a span carrying governance origin metadata", () => {
    /** @scenario "a span lands with origin metadata" */
    it("contributes the span's own spend and tokens to its (source, hour) bucket", () => {
      const row = mapOne({
        spanId: "bbbb0000000000a1",
        costUsd: 0.0042,
        attributes: {
          "gen_ai.usage.input_tokens": 120,
          "gen_ai.usage.output_tokens": 42,
        },
      });

      expect(row).not.toBeNull();
      expect(row!.tenantId).toBe(TENANT_ID);
      expect(row!.sourceId).toBe("is-1");
      expect(row!.sourceType).toBe("claude_compliance");
      expect(row!.spendUsd).toBe(0.0042);
      expect(row!.promptTokens).toBe(120);
      expect(row!.completionTokens).toBe(42);
    });

    /** @scenario "a span lands with origin metadata" */
    it("keys the contribution on the span id so a re-derivation lands on the same row", () => {
      expect(mapOne({ spanId: "bbbb0000000000a1" })!.eventId).toBe(
        "bbbb0000000000a1",
      );
    });

    it("floors the bucket to the hour of the span's own start", () => {
      const row = mapOne();
      expect(row!.hourBucket.getTime() % HOUR_MS).toBe(0);
      expect(row!.hourBucket.getTime()).toBe(
        Math.floor(SPAN_START_MS / HOUR_MS) * HOUR_MS,
      );
    });

    it("versions the row on the span event's own occurredAt, not on wall-clock", () => {
      expect(mapOne({ occurredAt: 1_700_000_123_000 })!
        .lastEventOccurredAt.getTime()).toBe(1_700_000_123_000);
    });

    it("contributes nothing for a span whose usage is a redundant copy of another span's", () => {
      const row = mapOne({
        costUsd: 0.0042,
        attributes: {
          "gen_ai.usage.input_tokens": 120,
          "langwatch.reserved.skip_token_accumulation": true,
        },
      });
      expect(row!.spendUsd).toBe(0);
      expect(row!.promptTokens).toBe(0);
    });
  });

  describe("given a span with no governance origin", () => {
    it("contributes nothing — application traffic is not governance spend", () => {
      const projection = new GovernanceKpisMapProjection({
        store: { append: async () => {} },
      });
      const event = createSpanReceivedEvent({
        tenantId: TENANT_ID,
        attributes: { "gen_ai.request.model": "gpt-5-mini" },
      });
      expect(projection.mapTraceSpanReceived(event)).toBeNull();
    });
  });

  describe("when a drifted KPI stream is rebuilt from the same events", () => {
    /** @scenario "A drifted KPI stream is corrected by rebuilding from event_log" */
    it("recovers the contribution the drift dropped and restores the bucket total", async () => {
      const events = [
        governanceSpanEvent({
          eventId: "evt-1",
          spanId: "bbbb0000000000a1",
          costUsd: 1,
        }),
        governanceSpanEvent({
          eventId: "evt-2",
          spanId: "bbbb0000000000a2",
          costUsd: 2,
        }),
        governanceSpanEvent({
          eventId: "evt-3",
          spanId: "bbbb0000000000a3",
          costUsd: 4,
        }),
      ];

      const drifted = kpiTable();
      await runProjection({
        events,
        table: drifted,
        dropEventIds: new Set(["bbbb0000000000a2"]),
      });
      expect(bucketSpend(drifted.merged())).toBe(5);

      await runProjection({ events, table: drifted });

      expect(bucketSpend(drifted.merged())).toBe(7);
    });

    /** @scenario "A drifted KPI stream is corrected by rebuilding from event_log" */
    it("produces state identical to the live write path", async () => {
      const events = [
        governanceSpanEvent({
          eventId: "evt-1",
          spanId: "bbbb0000000000a1",
          costUsd: 1,
        }),
        governanceSpanEvent({
          eventId: "evt-2",
          spanId: "bbbb0000000000a2",
          costUsd: 2,
        }),
      ];

      const live = kpiTable();
      await runProjection({ events, table: live });

      const rebuiltFromNothing = kpiTable();
      await runProjection({ events, table: rebuiltFromNothing });

      expect(rebuiltFromNothing.merged()).toEqual(live.merged());
    });
  });

  describe("when a stream that is already complete is rebuilt", () => {
    /** @scenario "Rebuilding does not duplicate what is already recorded" */
    it("leaves the bucket total unchanged rather than adding the window again", async () => {
      const events = [
        governanceSpanEvent({
          eventId: "evt-1",
          spanId: "bbbb0000000000a1",
          costUsd: 1,
        }),
        governanceSpanEvent({
          eventId: "evt-2",
          spanId: "bbbb0000000000a2",
          costUsd: 2,
        }),
      ];

      const table = kpiTable();
      await runProjection({ events, table });
      const before = bucketSpend(table.merged());

      await runProjection({ events, table });
      await runProjection({ events, table });

      expect(before).toBe(3);
      expect(bucketSpend(table.merged())).toBe(3);
      expect(table.merged()).toHaveLength(2);
    });

    /** @scenario "Rebuilding does not duplicate what is already recorded" */
    it("collapses a redelivered span onto its own contribution rather than a second one", async () => {
      const event = governanceSpanEvent({
        eventId: "evt-1",
        spanId: "bbbb0000000000a1",
        costUsd: 1,
      });

      const table = kpiTable();
      await runProjection({ events: [event, event, event], table });

      expect(table.parts()).toHaveLength(3);
      expect(table.merged()).toHaveLength(1);
      expect(bucketSpend(table.merged())).toBe(1);
    });
  });

  describe("given two spans of one trace in the same hour bucket", () => {
    it("keeps both contributions, so the bucket sums the trace's real spend", async () => {
      const events = [
        governanceSpanEvent({
          eventId: "evt-1",
          spanId: "bbbb0000000000a1",
          costUsd: 1,
        }),
        governanceSpanEvent({
          eventId: "evt-2",
          spanId: "bbbb0000000000a2",
          costUsd: 2,
        }),
      ];

      const table = kpiTable();
      await runProjection({ events, table });

      expect(table.merged()).toHaveLength(2);
      expect(bucketSpend(table.merged())).toBe(3);
    });

    it("would have collapsed to one under the pre-00063 sorting key — the migration is load-bearing", async () => {
      const events = [
        governanceSpanEvent({
          eventId: "evt-1",
          spanId: "bbbb0000000000a1",
          costUsd: 1,
        }),
        governanceSpanEvent({
          eventId: "evt-2",
          spanId: "bbbb0000000000a2",
          costUsd: 2,
        }),
      ];

      const table = preMigrationKpiTable();
      await runProjection({ events, table });

      expect(table.merged()).toHaveLength(1);
      expect(bucketSpend(table.merged())).toBe(2);
    });
  });

  describe("when a replay batches a window through bulkAppend", () => {
    it("writes the same contributions the per-event path writes", async () => {
      const events = [
        governanceSpanEvent({
          eventId: "evt-1",
          spanId: "bbbb0000000000a1",
          costUsd: 1,
        }),
        governanceSpanEvent({
          eventId: "evt-2",
          spanId: "bbbb0000000000a2",
          costUsd: 2,
        }),
      ];

      const perEvent = kpiTable();
      await runProjection({ events, table: perEvent });

      const batched = kpiTable();
      const repository = {
        insertContributions: async (rows: GovernanceKpiContribution[]) =>
          batched.insert(rows),
      } as unknown as GovernanceKpisClickHouseRepository;
      const projection = new GovernanceKpisMapProjection({
        store: new GovernanceKpisAppendStore(repository),
      });
      await new MapProjectionExecutor().executeBatch(
        projection,
        events,
        events.map((event) => ({
          aggregateId: String(event.aggregateId),
          tenantId: event.tenantId,
        })),
      );

      expect(batched.merged()).toEqual(perEvent.merged());
    });
  });
});
