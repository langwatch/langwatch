/** @see specs/trace/span-analytics-written-once.feature */
import { SecurityError } from "@langwatch/eventing";
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

  /** @scenario "Spans stored at the slice edges of a 600-span batch are not written again" */
  it("stores every span of a 600-span batch once when the slice edges were already stored", async () => {
    const { repository, store, context } = setup();
    const rows = Array.from({ length: 600 }, (_, index) =>
      row({ spanId: `span-${index}`, startTimeUnixMs: BASE_MS + (599 - index) * 0.1 * DAY_MS }),
    );
    const sorted = rows.toSorted((a, b) => a.startTimeUnixMs - b.startTimeUnixMs);
    const edges = [0, 255, 256, 511, 512, 599].map((index) => {
      const edge = sorted[index];
      if (!edge) throw new Error(`no row at ${index}`);
      return edge;
    });
    await store.bulkAppend(edges, context);

    await store.bulkAppend(rows, context);

    expect(repository.appended).toHaveLength(600);
    expect(new Set(repository.appended.map((stored) => stored.spanId)).size).toBe(600);
  });

  /** @scenario "Another tenant's span with the same ids is still written" */
  it("writes another tenant's span that shares ids with a stored one", async () => {
    const { repository, store, context } = setup();
    await store.bulkAppend([row()], context);
    await store.bulkAppend([row({ tenantId: "tenant-2" })], context);
    expect(repository.appended.map((stored) => stored.tenantId)).toEqual(["tenant-1", "tenant-2"]);
  });

  it("refuses a batch that mixes tenants", async () => {
    const { repository, store, context } = setup();
    await expect(
      store.bulkAppend([row(), row({ tenantId: "tenant-2", spanId: "span-2" })], context),
    ).rejects.toThrow(SecurityError);
    expect(repository.lookups).toHaveLength(0);
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
