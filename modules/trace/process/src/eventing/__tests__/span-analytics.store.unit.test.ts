/** @see specs/trace/span-analytics-written-once.feature */
import { describe, expect, it } from "vitest";

import { MemorySpanAnalyticsRepository } from "../../repositories/memory/memory.span-analytics.repository.ts";
import type { SpanAnalyticsKey } from "../../repositories/span-analytics.repository.ts";
import type { SpanAnalyticsRow } from "../span-analytics.projection.ts";
import { SpanAnalyticsStore } from "../span-analytics.store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const BASE_MS = Date.UTC(2026, 10, 1);

interface LookupBound {
  keys: number;
  startTimeFromMs: number;
  startTimeToMs: number;
}

/** Records every lookup bound and can fail the next insert after the lookup has run. */
class RecordingRepository extends MemorySpanAnalyticsRepository {
  readonly lookups: LookupBound[] = [];
  failNextInsert = false;

  override async existingSpanKeys(
    input: Parameters<MemorySpanAnalyticsRepository["existingSpanKeys"]>[0],
  ): Promise<SpanAnalyticsKey[]> {
    this.lookups.push({
      keys: input.keys.length,
      startTimeFromMs: input.startTimeFromMs,
      startTimeToMs: input.startTimeToMs,
    });
    return super.existingSpanKeys(input);
  }

  override async insertRows(input: Parameters<MemorySpanAnalyticsRepository["insertRows"]>[0]) {
    if (this.failNextInsert) {
      this.failNextInsert = false;
      throw new Error("insert failed");
    }
    return super.insertRows(input);
  }
}

function row(overrides: Partial<SpanAnalyticsRow> = {}): SpanAnalyticsRow {
  return {
    tenantId: "tenant-1",
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    startTimeUnixMs: BASE_MS,
    endTimeUnixMs: BASE_MS + 10,
    durationMs: 10,
    spanName: "span",
    spanKind: 1,
    statusCode: null,
    cost: null,
    nonBilledCost: null,
    spanType: "llm",
    errorType: "",
    ragContextCount: 0,
    inputHash: "0",
    deploymentEnvironment: "",
    ...overrides,
  };
}

function startAt(starts: number[], index: number): number {
  const start = starts[index];
  if (start === undefined) throw new Error(`no start time at ${index}`);
  return start;
}

function setup() {
  const repository = new RecordingRepository();
  const store = SpanAnalyticsStore.create({ storage: repository, defaultRetentionDays: () => 30 });
  const context = { tenantId: "tenant-1" } as Parameters<SpanAnalyticsStore["bulkAppend"]>[1];
  return { repository, store, context };
}

describe("SpanAnalyticsStore", () => {
  /** @scenario "A span repeated inside one batch is written once" */
  it("writes a span repeated inside one batch once", async () => {
    const { repository, store, context } = setup();
    await store.bulkAppend([row({ cost: 1 }), row({ cost: 2 })], context);
    expect(repository.appended).toHaveLength(1);
    expect(repository.appended[0]?.cost).toBe(1);
  });

  /** @scenario "A span already stored is not written again" */
  it("does not write a span an earlier batch stored", async () => {
    const { repository, store, context } = setup();
    await store.bulkAppend([row()], context);
    await store.bulkAppend([row()], context);
    expect(repository.appended).toHaveLength(1);
  });

  /** @scenario "A re-sent span whose start time moved by under seven days is found" */
  it("finds a re-sent span whose start time moved by five days", async () => {
    const { repository, store, context } = setup();
    await store.bulkAppend([row()], context);
    await store.bulkAppend([row({ startTimeUnixMs: BASE_MS + 5 * DAY_MS })], context);
    expect(repository.appended).toHaveLength(1);
  });

  /** @scenario "A span re-sent with a StartTime moved more than 7 days is written twice" */
  it("writes a re-sent span whose start time moved by eight days a second time", async () => {
    const { repository, store, context } = setup();
    await store.bulkAppend([row()], context);
    await store.bulkAppend([row({ startTimeUnixMs: BASE_MS + 8 * DAY_MS })], context);
    expect(repository.appended).toHaveLength(2);
  });

  /** @scenario "Each slice of 256 spans is looked up under its own start time bound" */
  it("looks each slice of 256 spans up under its own bound", async () => {
    const { repository, store, context } = setup();
    const rows = Array.from({ length: 600 }, (_, index) =>
      row({ spanId: `span-${index}`, startTimeUnixMs: BASE_MS + (599 - index) * 0.1 * DAY_MS }),
    );
    await store.bulkAppend(rows, context);
    const starts = rows.map((r) => r.startTimeUnixMs).toSorted((a, b) => a - b);
    expect(repository.lookups).toEqual([
      {
        keys: 256,
        startTimeFromMs: startAt(starts, 0) - 7 * DAY_MS,
        startTimeToMs: startAt(starts, 255) + 7 * DAY_MS,
      },
      {
        keys: 256,
        startTimeFromMs: startAt(starts, 256) - 7 * DAY_MS,
        startTimeToMs: startAt(starts, 511) + 7 * DAY_MS,
      },
      {
        keys: 88,
        startTimeFromMs: startAt(starts, 512) - 7 * DAY_MS,
        startTimeToMs: startAt(starts, 599) + 7 * DAY_MS,
      },
    ]);
    expect(repository.appended).toHaveLength(600);
  });

  /** @scenario "A span redelivered after a failed insert is written once" */
  it("writes a span once when it is redelivered after a failed insert", async () => {
    const { repository, store, context } = setup();
    repository.failNextInsert = true;
    await expect(store.bulkAppend([row()], context)).rejects.toThrow("insert failed");
    await store.bulkAppend([row()], context);
    expect(repository.lookups).toHaveLength(2);
    expect(repository.lookups[1]).toEqual(repository.lookups[0]);
    expect(repository.appended).toHaveLength(1);
  });
});
