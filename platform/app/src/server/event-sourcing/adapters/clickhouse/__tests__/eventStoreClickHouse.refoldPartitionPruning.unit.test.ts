import type { ClickHouseClient } from "@clickhouse/client";
import {
  type AggregateType,
  createTenantId,
  type Event,
  REHYDRATION_WINDOW_MS,
} from "@langwatch/eventing";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { EventRepositoryClickHouse } from "../eventRepositoryClickHouse";
import { EventStoreClickHouse } from "../eventStoreClickHouse";

/**
 * `event_log` is `PARTITION BY toYearWeek(EventOccurredAt)`, but the re-fold
 * reads bound on `EventTimestamp` — acceptance order, NOT the partition key. So
 * without a predicate on `EventOccurredAt` the read cannot prune, and walks
 * every weekly partition ever written including the cold tier on S3.
 *
 * Measured in production before this bound existed: `event_log` was the ONLY
 * table cold-scanning (198 scans in 15 minutes across 3 pods), all of it from
 * these two loaders, against a table taking ~1M trace events/day with tenant
 * retentions up to 1827 days.
 *
 * `getEvents` already passed this bound; these two paths were the holdouts.
 */
const tenantId = createTenantId("test-tenant");
const OCCURRED_AT = 1_700_000_000_000;
const TIME_LOCAL: AggregateType = "trace";

let queryMock: ReturnType<typeof vi.fn>;
let store: EventStoreClickHouse;

beforeEach(() => {
  queryMock = vi.fn().mockResolvedValue({ json: async () => [] });
  store = new EventStoreClickHouse(
    new EventRepositoryClickHouse(
      async () => ({ query: queryMock }) as unknown as ClickHouseClient,
    ),
  );
});

const upToEvent = {
  id: "event-1",
  createdAt: 1000,
  occurredAt: OCCURRED_AT,
} as unknown as Event;

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
    await store.getEventsUpTo("trace-1", { tenantId }, TIME_LOCAL, upToEvent);

    expect(lastCall().query).toContain("EventOccurredAt >=");
  });

  it("anchors the window on the triggering event, one window back", async () => {
    await store.getEventsUpTo("trace-1", { tenantId }, TIME_LOCAL, upToEvent);

    expect(lastCall().query_params.occurredAtFromMs).toBe(
      OCCURRED_AT - REHYDRATION_WINDOW_MS,
    );
  });

  it("keeps rows with an unknown occurred time, so the bound can never drop one", async () => {
    await store.getEventsUpTo("trace-1", { tenantId }, TIME_LOCAL, upToEvent);

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
    expect(lastCall().query_params.occurredAtFromMs).toBe(
      OCCURRED_AT - REHYDRATION_WINDOW_MS,
    );
  });

  it("keeps rows with an unknown occurred time on the paged path too", async () => {
    // The paged builder renders its own copy of the filter string rather than
    // sharing one, so the escape hatch has to be asserted separately —
    // dropping it from just this copy would otherwise pass every test.
    await store.getEventsUpToPaged?.(pagedRequest);

    expect(lastCall().query).toContain("EventOccurredAt = 0 OR");
  });
});

/**
 * The safety half of the contract. `global` and `billing_report` aggregate
 * over arbitrary time ranges, so a window around any single event WOULD drop
 * their history. `rehydrationLowerBoundMs` returns undefined for them and the
 * read must stay unbounded — slow, but correct.
 */
describe("re-fold reads prune partitions — long-lived aggregate type", () => {
  it("issues no lower bound, leaving the scan unbounded", async () => {
    await store.getEventsUpTo(
      "global-1",
      { tenantId },
      "global" as AggregateType,
      upToEvent,
    );

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
    await store.getEventsUpTo("trace-1", { tenantId }, TIME_LOCAL, {
      id: "event-1",
      createdAt: 1000,
      occurredAt: 0,
    } as unknown as Event);

    expect(lastCall().query).not.toContain("EventOccurredAt >=");
    expect(lastCall().query_params.occurredAtFromMs).toBeUndefined();
  });
});
