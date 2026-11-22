/**
 * @vitest-environment node
 * @unit
 * @see modules/organization/specs/seat-peak.feature
 */
import {
  SCIM_MEMBER_CREATED_EVENT_TYPE,
  SCIM_MEMBER_CREATED_EVENT_VERSION,
  SCIM_MEMBERSHIP_AGGREGATE_TYPE,
} from "@langwatch/enterprise-scim-contract";
import type { MemberType } from "@langwatch/entitlement-contract";
import { createTenantId, type Event, type EventSubscriberDefinition } from "@langwatch/eventing";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it } from "vitest";

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
const LANE = "organization_seat_peak.seatPeakDirectoryMemberCreated";
const OPENED_AT = Date.UTC(2026, 10, 2, 9);
const CREATED_AT = Date.UTC(2026, 10, 2, 12);
const TEN_FULL_SEATS = Array.from({ length: 10 }, (_, index) => ({
  holder: { kind: "member" as const, userId: `member-${index}` },
  seat: "full" as const,
}));

function setup({
  countingStarted = true,
  live = "FullMember",
}: { countingStarted?: boolean; live?: MemberType | null } = {}) {
  let state: SeatPeakState = countingStarted
    ? foldSeatPeak({
        state: emptySeatPeak(),
        fact: {
          type: "seat_snapshot_taken",
          data: {
            tenantId: ORG,
            organizationId: ORG,
            holders: TEN_FULL_SEATS,
            occurredAt: OPENED_AT,
          },
        },
      })
    : emptySeatPeak();
  const sent: RecordSeatChangedCommandData[] = [];
  const fold = (fact: SeatPeakFact) => {
    state = foldSeatPeak({ state, fact });
  };
  const corrections = SeatPeakCorrectionService.create({
    seats: {
      findSeatHolders: async () => {
        throw new Error("a directory create reads the one member, not the whole organization");
      },
      findMemberSeat: async () => live,
      findCountedHold: async () => [],
    },
    peaks: { getState: async () => state },
    organizationIdsForMember: async () => [ORG],
    changes: () => ({
      send: async (change) => {
        sent.push(change);
        fold({ type: "seat_changed", data: change });
      },
    }),
  });
  const pipeline = buildSeatPeakPipeline({
    fold: async () => undefined,
    opener: { open: async () => undefined },
    sender: () => ({ send: async () => undefined }),
    retention: { deleteDispatchedBefore: async () => 0 },
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
  return { lane, sent, peaks: () => state.months };
}

function memberCreated(): Event {
  return {
    id: "evt-member-created",
    aggregateId: "pushed",
    aggregateType: SCIM_MEMBERSHIP_AGGREGATE_TYPE,
    tenantId: createTenantId(ORG),
    createdAt: CREATED_AT,
    occurredAt: CREATED_AT,
    type: SCIM_MEMBER_CREATED_EVENT_TYPE,
    version: SCIM_MEMBER_CREATED_EVENT_VERSION,
    data: {
      tenantId: ORG,
      organizationId: ORG,
      userId: "pushed",
      occurredAt: CREATED_AT,
      createId: "scimmember_1",
    },
  };
}
const context = { tenantId: ORG, aggregateId: "pushed" };

describe("organization's count of a seat SCIM's directory create took", () => {
  describe("given an organization holding 10 full seats", () => {
    /** @scenario "A seat taken on any path is counted" */
    it("raises the month's full seat peak to 11 when somebody is created by the directory", async () => {
      const { lane, sent, peaks } = setup();

      await lane.handle(memberCreated(), context);

      expect(sent).toEqual([
        expect.objectContaining({
          holder: { kind: "member", userId: "pushed" },
          from: "none",
          to: "full",
          cause: "directory_created",
          occurredAt: CREATED_AT,
        }),
      ]);
      expect(Object.values(peaks())[0]?.fullPeak).toBe(11);
    });

    it("keys the change on the create, so a redelivered fact is counted once", async () => {
      const { lane, sent, peaks } = setup();

      await lane.handle(memberCreated(), context);
      await lane.handle(memberCreated(), context);

      expect(new Set(sent.map(({ changeId }) => changeId)).size).toBe(1);
      expect(Object.values(peaks())[0]?.fullPeak).toBe(11);
    });

    it("counts no seat for a create held until a seat frees", async () => {
      const { lane, sent, peaks } = setup({ live: null });

      await lane.handle(memberCreated(), context);

      expect(sent).toMatchObject([{ from: "none", to: "none", cause: "directory_created" }]);
      expect(Object.values(peaks())[0]?.fullPeak).toBe(10);
    });

    it("counts the seat organization's own rule gives the member", async () => {
      const { lane, sent, peaks } = setup({ live: "LiteMember" });

      await lane.handle(memberCreated(), context);

      expect(sent).toMatchObject([{ from: "none", to: "lite" }]);
      expect(Object.values(peaks())[0]).toMatchObject({ fullPeak: 10, litePeak: 1 });
    });
  });

  describe("given an organization whose seats have not been counted yet", () => {
    it("records nothing, since the opening snapshot reads the seat as it stands", async () => {
      const { lane, sent } = setup({ countingStarted: false });

      await lane.handle(memberCreated(), context);

      expect(sent).toEqual([]);
    });
  });
});
