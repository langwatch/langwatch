/**
 * @vitest-environment node
 * @unit
 * @see modules/organization/specs/seat-peak.feature
 */
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import {
  USER_DEACTIVATED_EVENT_TYPE,
  USER_LIFECYCLE_EVENT_VERSION,
} from "@langwatch/user-contract";
import { describe, expect, it } from "vitest";

import type { SeatPeakFoldState } from "../../repositories/organization-seat-peak.repository.ts";
import {
  emptySeatPeak,
  foldSeatPeak,
  type SeatPeakFact,
  type SeatPeakState,
} from "../../rules/seat-peak.rules.ts";
import { SeatPeakCorrectionService } from "../../services/seat-peak-correction.service.ts";
import type { RecordSeatChangedCommandData } from "../seat-peak.events.ts";
import { buildSeatPeakPipeline } from "../seat-peak.pipeline.ts";

const ORG = "org-1";
const LANE = "organization_seat_peak.seatPeakAccountDeactivated";
const OPENED_AT = Date.UTC(2026, 10, 2, 9);
const DEACTIVATED_AT = Date.UTC(2026, 10, 2, 12);

function setup({ foldLags }: { foldLags: boolean }) {
  let state: SeatPeakState = foldSeatPeak({
    state: emptySeatPeak(),
    fact: {
      type: "seat_snapshot_taken",
      data: {
        tenantId: ORG,
        organizationId: ORG,
        holders: [{ holder: { kind: "member", userId: "leaver" }, seat: "full" }],
        occurredAt: OPENED_AT,
      },
    },
  });
  const sent: RecordSeatChangedCommandData[] = [];
  const fold = (fact: SeatPeakFact) => {
    state = foldSeatPeak({ state, fact });
  };
  const corrections = SeatPeakCorrectionService.create({
    seats: { findSeatHolders: async () => [] },
    peaks: {
      findState: async () =>
        ({ ...state, CreatedAt: 0, UpdatedAt: 0, LastEventOccurredAt: 0 }) as SeatPeakFoldState,
    },
    organizationIdsForMember: async () => [ORG],
    changes: () => ({
      send: async (change) => {
        sent.push(change);
        if (!foldLags) fold({ type: "seat_changed", data: change });
      },
    }),
  });
  const pipeline = buildSeatPeakPipeline({
    store: createApiFixture(),
    opener: { open: async () => undefined },
    corrections,
  });
  const lanes = new Map<string, EventSubscriberDefinition>();
  const registry = createApiFixture<
    Parameters<NonNullable<typeof pipeline.globalProjections>[number]["register"]>[0]
  >({
    registerEventSubscriber: (subscriber) => void lanes.set(subscriber.name, subscriber),
  });
  for (const projection of pipeline.globalProjections ?? []) projection.register(registry);
  const lane = lanes.get(LANE);
  if (!lane) throw new Error(`no ${LANE} lane mounted`);
  return { lane, sent, fold, counts: () => state.counts };
}

const deactivated: Event = {
  id: "evt-deactivated",
  aggregateId: "leaver",
  aggregateType: "user_account",
  tenantId: createTenantId("leaver"),
  createdAt: DEACTIVATED_AT,
  occurredAt: DEACTIVATED_AT,
  type: USER_DEACTIVATED_EVENT_TYPE,
  version: USER_LIFECYCLE_EVENT_VERSION,
  data: { tenantId: "leaver", userId: "leaver", occurredAt: DEACTIVATED_AT },
};
const context = { tenantId: "leaver", aggregateId: "leaver" };

describe("organization's account deactivated seat correction", () => {
  describe("when user's deactivation fact is delivered twice", () => {
    it("records one seat change once the first has been folded", async () => {
      const { lane, sent, counts } = setup({ foldLags: false });

      await lane.handle(deactivated, context);
      await lane.handle(deactivated, context);

      expect(sent).toHaveLength(1);
      expect(counts().full).toBe(0);
    });

    it("sends the same change id while the fold lags, so the fold counts it once", async () => {
      const { lane, sent, fold, counts } = setup({ foldLags: true });

      await lane.handle(deactivated, context);
      await lane.handle(deactivated, context);
      for (const change of sent) fold({ type: "seat_changed", data: change });

      expect(new Set(sent.map(({ changeId }) => changeId)).size).toBe(1);
      expect(counts().full).toBe(0);
    });
  });
});
