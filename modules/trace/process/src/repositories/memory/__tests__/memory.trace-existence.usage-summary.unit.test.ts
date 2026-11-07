/**
 * The memory twin of nurturing's daily usage figures, over the spans a process wrote.
 * @see enterprise/modules/nurturing/specs/organization-usage.feature
 */
import { NormalizedStatusCode, type SpanInsertData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryTraceExistenceRepository } from "../memory.trace-existence.repository.ts";
import { MemoryTraceSpanStore } from "../memory.trace-span.store.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
const now = Date.UTC(2026, 10, 6, 6);
const since = now - 30 * DAY_MS;

function span(overrides: Partial<SpanInsertData> = {}): SpanInsertData {
  return {
    id: "projection-1",
    tenantId: "project-a",
    traceId: "trace-1",
    spanId: "span-1",
    parentSpanId: null,
    parentTraceId: null,
    parentIsRemote: null,
    sampled: true,
    startTimeUnixMs: now - DAY_MS,
    endTimeUnixMs: now - DAY_MS + 250,
    durationMs: 250,
    name: "llm call",
    kind: 3,
    resourceAttributes: {},
    spanAttributes: {},
    statusCode: null,
    statusMessage: null,
    instrumentationScope: { name: "langwatch", version: "1.2.3" },
    events: [],
    links: [],
    droppedAttributesCount: 0,
    droppedEventsCount: 0,
    droppedLinksCount: 0,
    cost: null,
    nonBilledCost: null,
    retentionDays: 7,
    ...overrides,
  };
}

function repositoryOver(spans: SpanInsertData[]): MemoryTraceExistenceRepository {
  const store = MemoryTraceSpanStore.create();
  for (const written of spans) store.put(written);
  return MemoryTraceExistenceRepository.create(store);
}

describe("MemoryTraceExistenceRepository.summarizeUsage", () => {
  describe("given traces in two projects, one failed, one rewritten and one older than 30 days", () => {
    const failedAt = now - 2 * DAY_MS;
    const repository = repositoryOver([
      span({ traceId: "trace-1", cost: 0.1 }),
      // The same span written again: the newest write is the trace's cost.
      span({ traceId: "trace-1", cost: 0.3 }),
      span({
        traceId: "trace-2",
        startTimeUnixMs: failedAt,
        statusCode: NormalizedStatusCode.ERROR,
        statusMessage: "boom",
        cost: 0.2,
      }),
      span({ tenantId: "project-b", traceId: "trace-3", cost: 0.5 }),
      span({
        traceId: "trace-old",
        startTimeUnixMs: now - 40 * DAY_MS,
        statusCode: NormalizedStatusCode.ERROR,
        cost: 9,
      }),
    ]);

    /** @scenario A trace stored in two versions counts once with its newest cost */
    it("counts each trace once, sums both projects inside the window, and keeps the failed time", async () => {
      const summary = await repository.summarizeUsage({
        projectIds: ["project-a", "project-b"],
        since,
      });

      expect(summary).toMatchObject({ traces: 3, errors: 1, lastFailedTraceAt: failedAt });
      expect(summary.totalCost).toBeCloseTo(1.0, 9);
    });
  });

  describe("given no spans", () => {
    it("answers zeros and no failed time", async () => {
      const summary = await repositoryOver([]).summarizeUsage({
        projectIds: ["project-a"],
        since,
      });

      expect(summary).toEqual({ traces: 0, errors: 0, totalCost: 0, lastFailedTraceAt: null });
    });
  });
});
