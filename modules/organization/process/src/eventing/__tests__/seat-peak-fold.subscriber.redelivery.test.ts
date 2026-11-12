/**
 * @vitest-environment node
 * @unit
 * @see modules/organization/specs/seat-peak.feature
 */
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationSeatPeakRepository } from "../../repositories/memory/memory.organization-seat-peak.repository.ts";
import { foldSeatPeak } from "../../rules/seat-peak.rules.ts";
import { seatPeakFoldSubscriber } from "../seat-peak-fold.subscriber.ts";
import {
  SEAT_CHANGED_EVENT_TYPE,
  SEAT_CHANGED_EVENT_VERSION,
  SEAT_PEAK_AGGREGATE_TYPE,
  SEAT_SNAPSHOT_TAKEN_EVENT_TYPE,
  SEAT_SNAPSHOT_TAKEN_EVENT_VERSION,
  type SeatChangedEvent,
  type SeatSnapshotTakenEvent,
} from "../seat-peak.events.ts";

const ORG = "org-1";
const OPENED_AT = Date.UTC(2026, 10, 1, 9);
const JOINED_AT = Date.UTC(2026, 10, 2, 9);

function envelope(id: string, occurredAt: number) {
  return {
    id,
    aggregateId: ORG,
    aggregateType: SEAT_PEAK_AGGREGATE_TYPE,
    tenantId: createTenantId(ORG),
    createdAt: occurredAt,
    occurredAt,
  };
}

const opened: SeatSnapshotTakenEvent = {
  ...envelope("event-opened", OPENED_AT),
  type: SEAT_SNAPSHOT_TAKEN_EVENT_TYPE,
  version: SEAT_SNAPSHOT_TAKEN_EVENT_VERSION,
  data: {
    tenantId: ORG,
    organizationId: ORG,
    holders: [{ holder: { kind: "member", userId: "founder" }, seat: "full" }],
    occurredAt: OPENED_AT,
  },
};

const joined: SeatChangedEvent = {
  ...envelope("event-joined", JOINED_AT),
  type: SEAT_CHANGED_EVENT_TYPE,
  version: SEAT_CHANGED_EVENT_VERSION,
  data: {
    tenantId: ORG,
    organizationId: ORG,
    holder: { kind: "member", userId: "joiner" },
    from: "none",
    to: "full",
    cause: "admitted",
    actorUserId: null,
    occurredAt: JOINED_AT,
    changeId: "change-joined",
  },
};

function setup() {
  const peaks = MemoryOrganizationSeatPeakRepository.create();
  const subscriber = seatPeakFoldSubscriber(({ organizationId, fact }) =>
    peaks.update(
      {
        organizationId,
        holders: fact.type === "seat_changed" ? [fact.data.holder] : [],
        dueBefore: fact.data.occurredAt,
      },
      (state) => foldSeatPeak({ state, fact }),
    ),
  );
  const context = { tenantId: ORG, aggregateId: ORG };
  return {
    deliver: (event: SeatChangedEvent | SeatSnapshotTakenEvent) =>
      subscriber.handle(event, context),
    read: () => peaks.getState({ organizationId: ORG, holders: [], dueBefore: JOINED_AT }),
  };
}

describe("seatPeakFoldSubscriber", () => {
  describe("when the same seat change is delivered twice", () => {
    /** @scenario "A seat change delivered twice is counted once" */
    it("counts it once", async () => {
      const { deliver, read } = setup();
      await deliver(opened);

      await deliver(joined);
      await deliver(joined);

      const state = await read();
      expect(state.counts.full).toBe(2);
      expect(state.months["2026-11"]).toMatchObject({ fullPeak: 2, fullAtEnd: 2 });
    });
  });

  describe("when the opening snapshot is delivered again after a change", () => {
    it("keeps the change and opens nothing again", async () => {
      const { deliver, read } = setup();
      await deliver(opened);
      await deliver(joined);

      await deliver(opened);

      const state = await read();
      expect(state.openedAt).toBe(OPENED_AT);
      expect(state.counts.full).toBe(2);
    });
  });
});
