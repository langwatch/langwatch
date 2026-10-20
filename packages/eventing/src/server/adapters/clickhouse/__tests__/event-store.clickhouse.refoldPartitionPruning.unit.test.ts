import {
  type AggregateType,
  createTenantId,
  type Event,
  REHYDRATION_WINDOW_MS,
} from "@langwatch/eventing";
import {
  createEventingRetentionConfiguration,
  EventingClickHouseEventRepository,
  EventingClickHouseEventStore,
  type EventingClickHouseClient,
} from "@langwatch/eventing/server";
import { beforeEach, describe, expect, it, type Mock, vi } from "vitest";

/**
 * Verify re-fold partition pruning: EventOccurredAt bound required for
 * ClickHouse to prune partitions.
 */
const tenantId = createTenantId("test-tenant");
const OCCURRED_AT = 1_700_000_000_000;
const TIME_LOCAL: AggregateType = "trace";

let queryMock: Mock<EventingClickHouseClient["query"]>;
let store: EventingClickHouseEventStore;

beforeEach(() => {
  queryMock = vi
    .fn<EventingClickHouseClient["query"]>()
    .mockResolvedValue({ json: async () => [] });
  const retention = createEventingRetentionConfiguration({ defaultRetentionDays: 49 });
  store = EventingClickHouseEventStore.create({
    repository: EventingClickHouseEventRepository.create({
      resolveClient: async () => ({ query: queryMock, insert: vi.fn() }),
      retention,
    }),
    retention,
  });
});

function eventOccurredAt(occurredAt: number): Event {
  return {
    id: "event-1",
    aggregateId: "trace-1",
    aggregateType: TIME_LOCAL,
    tenantId,
    createdAt: 1000,
    occurredAt,
    type: "test.event",
    version: "2025-12-17",
    data: {},
  };
}

const upToEvent = eventOccurredAt(OCCURRED_AT);

// Genuinely the LAST call, not `calls[0]`: today each test issues exactly one
// query so the two coincide, but a helper named `lastCall` that silently
// returns the first would start lying the moment a read takes two queries.
const lastCall = () =>
  queryMock.mock.calls.at(-1)![0] as {
    query: string;
    query_params: Record<string, unknown>;
  };

describe("re-fold reads prune partitions — unpaged, time-local aggregate", () => {
  it("filters on EventOccurredAt so ClickHouse can prune partitions", async () => {
    await store.getEventsUpTo({
      aggregateId: "trace-1",
      context: { tenantId },
      aggregateType: TIME_LOCAL,
      upToEvent,
    });

    expect(lastCall().query).toContain("EventOccurredAt >=");
  });

  it("anchors the window on the triggering event, one window back", async () => {
    await store.getEventsUpTo({
      aggregateId: "trace-1",
      context: { tenantId },
      aggregateType: TIME_LOCAL,
      upToEvent,
    });

    expect(lastCall().query_params.occurredAtFromMs).toBe(OCCURRED_AT - REHYDRATION_WINDOW_MS);
  });

  it("keeps rows with an unknown occurred time, so the bound can never drop one", async () => {
    await store.getEventsUpTo({
      aggregateId: "trace-1",
      context: { tenantId },
      aggregateType: TIME_LOCAL,
      upToEvent,
    });

    expect(lastCall().query).toContain("EventOccurredAt = 0 OR");
  });
});

describe("re-fold reads prune partitions — paged, time-local aggregate", () => {
  const pagedRequest = {
    aggregateId: "trace-1",
    context: { tenantId },
    aggregateType: TIME_LOCAL,
    upToEvent,
    after: { timestamp: 500, eventId: "event-0" },
    limit: 100,
  };

  it("bounds every page, not just the first", async () => {
    // Unbounded, the cost is paid once PER PAGE rather than once per
    // re-fold — every page re-opens every partition.
    await store.getEventsUpToPaged?.(pagedRequest);

    expect(lastCall().query).toContain("EventOccurredAt >=");
    expect(lastCall().query_params.occurredAtFromMs).toBe(OCCURRED_AT - REHYDRATION_WINDOW_MS);
  });

  it("keeps rows with an unknown occurred time on the paged path too", async () => {
    // The paged builder renders its own copy of the filter string rather than
    // sharing one, so the escape hatch has to be asserted separately —
    // dropping it from just this copy would otherwise pass every test.
    await store.getEventsUpToPaged?.(pagedRequest);

    expect(lastCall().query).toContain("EventOccurredAt = 0 OR");
  });

  /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
  it("reads each page's payloads lazily, for that page's rows only", async () => {
    await store.getEventsUpToPaged?.(pagedRequest);

    expect(lastCall().query).toContain("query_plan_max_limit_for_lazy_materialization = 100");
  });
});

describe("rebuild reads prune partitions: paged whole history", () => {
  describe("given a time-local aggregate", () => {
    /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
    it("bounds every page on the triggering event, with no upper bound", async () => {
      await store.getEventsPaged?.({
        aggregateId: "trace-1",
        context: { tenantId },
        aggregateType: TIME_LOCAL,
        anchorOccurredAtMs: OCCURRED_AT,
        after: { timestamp: 500, eventId: "event-0" },
        limit: 100,
      });

      expect(lastCall().query).toContain("EventOccurredAt = 0 OR EventOccurredAt >=");
      expect(lastCall().query_params.occurredAtFromMs).toBe(OCCURRED_AT - REHYDRATION_WINDOW_MS);
      expect(lastCall().query).not.toContain("upToTimestamp");
      expect(lastCall().query).toContain("LIMIT {limit:UInt32}");
      expect(lastCall().query_params.afterEventId).toBe("event-0");
      // Payloads are read lazily for the page's own rows, not for every row the page scans.
      expect(lastCall().query).toContain("query_plan_max_limit_for_lazy_materialization = 100");
    });
  });

  describe("given a long-lived aggregate type", () => {
    /** @scenario An order-insensitive fold that missed an event is rebuilt from its log a page at a time */
    it("leaves the scan unbounded but still pages it", async () => {
      await store.getEventsPaged?.({
        aggregateId: "global-1",
        context: { tenantId },
        aggregateType: "global" as AggregateType,
        anchorOccurredAtMs: OCCURRED_AT,
        after: undefined,
        limit: 100,
      });

      expect(lastCall().query).not.toContain("EventOccurredAt >=");
      expect(lastCall().query_params.limit).toBe(100);
    });
  });
});

/**
 * Safety half of the contract: `global` and `billing_report` aggregate over
 * arbitrary time ranges, so `rehydrationLowerBoundMs` returns undefined for
 * them and the read stays unbounded — slow, but correct.
 */
describe("re-fold reads prune partitions — long-lived aggregate type", () => {
  it("issues no lower bound, leaving the scan unbounded", async () => {
    await store.getEventsUpTo({
      aggregateId: "global-1",
      context: { tenantId },
      aggregateType: "global" as AggregateType,
      upToEvent,
    });

    expect(lastCall().query).not.toContain("EventOccurredAt >=");
    expect(lastCall().query_params.occurredAtFromMs).toBeUndefined();
  });

  it("leaves the paged scan unbounded too", async () => {
    // The paged path computes the bound with its own call to
    // `rehydrationLowerBoundMs`, so the unbounded half of the contract has to
    // be proven here as well as on the unpaged read.
    await store.getEventsUpToPaged?.({
      aggregateId: "global-1",
      context: { tenantId },
      aggregateType: "global" as AggregateType,
      upToEvent,
      after: undefined,
      limit: 100,
    });

    expect(lastCall().query).not.toContain("EventOccurredAt >=");
    expect(lastCall().query_params.occurredAtFromMs).toBeUndefined();
  });
});

describe("re-fold reads prune partitions — event with no usable occurred time", () => {
  it("issues no lower bound rather than anchoring on zero", async () => {
    // Anchoring on 0 would produce a bound in 1970 and prune nothing, or
    // worse, a negative bound. Better to skip it.
    await store.getEventsUpTo({
      aggregateId: "trace-1",
      context: { tenantId },
      aggregateType: TIME_LOCAL,
      upToEvent: eventOccurredAt(0),
    });

    expect(lastCall().query).not.toContain("EventOccurredAt >=");
    expect(lastCall().query_params.occurredAtFromMs).toBeUndefined();
  });
});
