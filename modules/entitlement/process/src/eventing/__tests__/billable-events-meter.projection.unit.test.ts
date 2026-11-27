/**
 * The meter key each billable event is counted under.
 * @see ../../../../specs/usage-counting.feature
 */
import { createTenantId, type Event, EventUtils } from "@langwatch/eventing";
import { CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE } from "@langwatch/log-contract";
import { METRIC_DATA_POINT_RECEIVED_EVENT_TYPE } from "@langwatch/metric-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import {
  LOG_CONTRIBUTED_EVENT_TYPE,
  LOG_RECORD_RECEIVED_EVENT_TYPE,
} from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { MemoryBillableEventsMeterRepository } from "../../repositories/memory/memory.billable-events-meter.repository.ts";
import type { TenancyRepository } from "../../repositories/tenancy.repository.ts";
import { BillableEventsMeterAppendService } from "../../services/billable-events-meter-append.service.ts";
import { BillableEventsMeterProjection } from "../billable-events-meter.projection.ts";

const SERIES_A = "a".repeat(64);
const SERIES_B = "b".repeat(64);

/** Every project placed in org_1, fail-closed on any other tenancy read. */
const placedProjects = createApiFixture<TenancyRepository>({
  getProjectPlacement: async () => ({ kind: "placed" as const, organizationId: "org_1" }),
});

function eventOf({
  type,
  data,
  idempotencyKey,
  at,
}: {
  type: string;
  data: unknown;
  idempotencyKey: string;
  at: string;
}): Event {
  const event = EventUtils.createEvent<Event>({
    aggregateType: "metric",
    aggregateId: idempotencyKey,
    tenantId: createTenantId("project_a"),
    type,
    version: "2026-07-17",
    data,
    metadata: {},
    occurredAt: epochMs(at),
    idempotencyKey,
  });
  return { ...event, createdAt: epochMs(at) };
}

function pointOf({ series, point, at }: { series: string; point: string; at: string }): Event {
  return eventOf({
    type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
    data: { seriesId: series, pointId: point },
    idempotencyKey: `project_a:${point}`,
    at,
  });
}

function epochMs(instant: string): number {
  return Temporal.Instant.from(instant).epochMilliseconds;
}

const keyOf = (event: Event) => BillableEventsMeterProjection.deduplicationKey(event);

describe("BillableEventsMeterProjection.deduplicationKey", () => {
  describe("given log record events", () => {
    /** @scenario "Each OTel log record is one billable event" */
    it("bills each record under its producer's key, and a redelivery under the same one", () => {
      const first = eventOf({
        type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
        data: {},
        idempotencyKey: "project_a:record_1",
        at: "2026-11-12T14:00:00Z",
      });
      const second = eventOf({
        type: CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE,
        data: {},
        idempotencyKey: "project_a:record_2",
        at: "2026-11-12T14:00:01Z",
      });
      const redelivered = { ...first, id: "another-event-id" };

      expect(keyOf(first)).toBe("project_a:record_1");
      expect(keyOf(second)).toBe("project_a:record_2");
      expect(keyOf(redelivered)).toBe(keyOf(first));
    });
  });

  describe("given metric data points", () => {
    /** @scenario "A metric series is billed once per UTC clock hour however many points it sends" */
    it("keys every point of one series in one hour by project, series and hour", async () => {
      const points = ["p1", "p2", "p3"].map((point, index) =>
        pointOf({ series: SERIES_A, point, at: `2026-11-12T14:0${index}:00Z` }),
      );

      expect(new Set(points.map(keyOf))).toEqual(new Set([`project_a:${SERIES_A}:2026-11-12T14`]));

      const meter = MemoryBillableEventsMeterRepository.create();
      const append = BillableEventsMeterAppendService.create({
        meter,
        projects: placedProjects,
      });
      const projection = BillableEventsMeterProjection.create(append).build();
      for (const point of points) {
        const record = projection.map(point);
        if (record) await append.append(record);
      }
      await expect(
        meter.findTotal({
          organizationId: "org_1",
          startDate: "2026-11-01 00:00:00.000",
          endDate: "2026-12-01 00:00:00.000",
        }),
      ).resolves.toBe(1);
    });

    /** @scenario "The same metric series sending in two hours is billed twice" */
    it("keys a point at 14:59 and one at 15:00 apart", () => {
      const before = pointOf({ series: SERIES_A, point: "p1", at: "2026-11-12T14:59:59.999Z" });
      const after = pointOf({ series: SERIES_A, point: "p2", at: "2026-11-12T15:00:00Z" });

      expect(keyOf(before)).toBe(`project_a:${SERIES_A}:2026-11-12T14`);
      expect(keyOf(after)).toBe(`project_a:${SERIES_A}:2026-11-12T15`);
    });

    /** @scenario "Two metric series in the same hour are billed separately" */
    it("keys two series of one project in one hour apart", () => {
      const a = pointOf({ series: SERIES_A, point: "p1", at: "2026-11-12T14:10:00Z" });
      const b = pointOf({ series: SERIES_B, point: "p2", at: "2026-11-12T14:10:00Z" });

      expect(keyOf(a)).not.toBe(keyOf(b));
    });

    /** @scenario "A metric event without a series id falls back to the event's own key" */
    it.each([
      ["no series id", { pointId: "p1" }],
      ["a malformed series id", { seriesId: "not-a-hash" }],
      ["no data at all", null],
    ])("falls back to the producer's key when the data has %s", (_label, data) => {
      const event = eventOf({
        type: METRIC_DATA_POINT_RECEIVED_EVENT_TYPE,
        data,
        idempotencyKey: "project_a:p1",
        at: "2026-11-12T14:00:00Z",
      });

      expect(() => keyOf(event)).not.toThrow();
      expect(keyOf(event)).toBe("project_a:p1");
    });
  });
});

describe("BillableEventsMeterProjection event types", () => {
  /** @scenario "The trace-side log contribution is not billed" */
  it("bills logs from the log pipeline only, never the trace-side log events", () => {
    const { eventTypes } = BillableEventsMeterProjection.create(
      MemoryBillableEventsMeterAppendStore.create(),
    ).build();

    expect(eventTypes).toContain(CANONICAL_LOG_RECORD_RECEIVED_EVENT_TYPE);
    expect(eventTypes).toContain(METRIC_DATA_POINT_RECEIVED_EVENT_TYPE);
    expect(eventTypes).not.toContain(LOG_RECORD_RECEIVED_EVENT_TYPE);
    expect(eventTypes).not.toContain(LOG_CONTRIBUTED_EVENT_TYPE);
  });
});

/** The append store the projection is built over, writing into the memory meter. */
const MemoryBillableEventsMeterAppendStore = {
  create: () =>
    BillableEventsMeterAppendService.create({
      meter: MemoryBillableEventsMeterRepository.create(),
      projects: placedProjects,
    }),
};
