import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { SeatHolder, SeatKind } from "../../eventing/seat-peak.events.ts";
import {
  emptySeatPeak,
  foldSeatPeak,
  SEAT_PEAK_RECENT_CHANGE_IDS,
  type SeatPeakFact,
  type SeatPeakState,
  seatPeakAsOf,
  seatPeakMonthOf,
} from "../seat-peak.rules.ts";

const ORG = "org-acme";

function at(iso: string): number {
  return Temporal.Instant.from(iso).epochMilliseconds;
}

function member(userId: string): SeatHolder {
  return { kind: "member", userId };
}

function invitation(inviteId: string, expiresAt: number | null = null): SeatHolder {
  return { kind: "invitation", inviteId, expiresAt };
}

function snapshot({
  occurredAt,
  full = 0,
  lite = 0,
  extra = [],
}: {
  occurredAt: number;
  full?: number;
  lite?: number;
  extra?: { holder: SeatHolder; seat: SeatKind }[];
}): SeatPeakFact {
  return {
    type: "seat_snapshot_taken",
    data: {
      tenantId: ORG,
      organizationId: ORG,
      occurredAt,
      holders: [
        ...Array.from({ length: full }, (_, i) => ({
          holder: member(`full-${i}`),
          seat: "full" as const,
        })),
        ...Array.from({ length: lite }, (_, i) => ({
          holder: member(`lite-${i}`),
          seat: "lite" as const,
        })),
        ...extra,
      ],
    },
  };
}

let changeSequence = 0;

function change({
  holder,
  from,
  to,
  occurredAt,
  changeId,
}: {
  holder: SeatHolder;
  from: SeatKind;
  to: SeatKind;
  occurredAt: number;
  changeId?: string;
}): SeatPeakFact {
  changeSequence += 1;
  return {
    type: "seat_changed",
    data: {
      tenantId: ORG,
      organizationId: ORG,
      holder,
      from,
      to,
      cause: "admitted",
      actorUserId: null,
      occurredAt,
      changeId: changeId ?? `change-${changeSequence}`,
    },
  };
}

function foldAll(facts: readonly SeatPeakFact[], from: SeatPeakState = emptySeatPeak()) {
  return facts.reduce((state, fact) => foldSeatPeak({ state, fact }), from);
}

const NOV_1 = at("2026-11-01T09:00:00Z");
const NOV_2 = at("2026-11-02T09:00:00Z");
const NOV_3 = at("2026-11-03T09:00:00Z");

function novemberOf(state: SeatPeakState) {
  const month = state.months["2026-11"];
  if (!month) throw new Error("November was never touched");
  return month;
}

describe("foldSeatPeak", () => {
  describe("given the peak is the most seats held at once, however briefly", () => {
    /** @scenario "Passing one seat round several people raises the month's peak" */
    it("peaks one above the running count when a seat is passed round three times", () => {
      const facts: SeatPeakFact[] = [snapshot({ occurredAt: NOV_1, full: 10 })];
      for (let round = 0; round < 3; round += 1) {
        facts.push(
          change({ holder: member(`new-${round}`), from: "none", to: "full", occurredAt: NOV_2 }),
          change({ holder: member(`full-${round}`), from: "full", to: "none", occurredAt: NOV_2 }),
        );
      }
      const state = foldAll(facts);

      expect(state.counts.full).toBe(10);
      expect(novemberOf(state).fullPeak).toBe(11);
      expect(novemberOf(state).fullPeakAt).toBe(NOV_2);
    });

    /** @scenario "A pending invitation counts toward the peak" */
    it("counts the invitation's seat while it is pending", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, full: 10 }),
        change({ holder: invitation("inv-1"), from: "none", to: "full", occurredAt: NOV_2 }),
      ]);

      expect(novemberOf(state).fullPeak).toBe(11);
    });

    /** @scenario "Accepting an invitation does not count its seat twice" */
    it("moves the invitation's seat onto the member, never adding one", () => {
      const state = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1"), seat: "full" }],
        }),
        change({ holder: invitation("inv-1"), from: "full", to: "none", occurredAt: NOV_2 }),
        change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_2 }),
      ]);

      expect(state.counts.full).toBe(11);
      expect(novemberOf(state).fullPeak).toBe(11);
    });

    /** @scenario "An expired invitation gives its seat back from the moment it expired" */
    it("gives the seat back at the expiry, before the next change is folded", () => {
      const state = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1", NOV_2), seat: "full" }],
        }),
        change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
      ]);

      expect(state.invitations).toEqual({});
      expect(state.counts.full).toBe(11);
      expect(novemberOf(state).fullPeak).toBe(11);
    });

    it("keeps an invitation that expires after the change", () => {
      const state = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1", NOV_3), seat: "full" }],
        }),
        change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_2 }),
      ]);

      expect(novemberOf(state).fullPeak).toBe(12);
    });

    /** @scenario "Full and Lite Member seats peak separately" */
    it("moves a Lite Member's seat to full without raising the Lite Member peak", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, full: 10, lite: 4 }),
        change({ holder: member("lite-0"), from: "lite", to: "full", occurredAt: NOV_2 }),
      ]);

      expect(novemberOf(state).fullPeak).toBe(11);
      expect(novemberOf(state).litePeak).toBe(4);
      expect(state.counts).toEqual({ full: 11, lite: 3, developer: 0 });
    });

    /** @scenario "Developer seats are not counted toward either peak" */
    it("counts the developer in the running count only", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, full: 10 }),
        change({ holder: member("dev"), from: "none", to: "developer", occurredAt: NOV_2 }),
      ]);

      expect(state.counts.developer).toBe(1);
      expect(novemberOf(state).fullPeak).toBe(10);
      expect(novemberOf(state).litePeak).toBe(0);
    });

    /** @scenario "Making a member an admin raises no peak" */
    it("leaves the peak alone when a change keeps the holder on the same seat", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, full: 10 }),
        change({ holder: member("full-0"), from: "full", to: "full", occurredAt: NOV_2 }),
      ]);

      expect(novemberOf(state).fullPeak).toBe(10);
      expect(state.mismatches).toBe(0);
    });
  });

  describe("given no opening snapshot yet", () => {
    it("folds no change, and counting has not started", () => {
      const state = foldAll([
        change({ holder: member("early"), from: "none", to: "full", occurredAt: NOV_1 }),
      ]);

      expect(state).toEqual(emptySeatPeak());
      expect(seatPeakAsOf({ state, now: NOV_3 }).months).toEqual([]);
    });

    it("opens at zero for an organization snapshotted with no holders", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1 }),
        change({ holder: member("founder"), from: "none", to: "full", occurredAt: NOV_1 }),
      ]);

      expect(state.openedAt).toBe(NOV_1);
      expect(novemberOf(state).fullPeak).toBe(1);
    });
  });

  describe("given a snapshot taken after counting started", () => {
    it("replaces the holders and sets the counts, keeping when counting opened", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, full: 3 }),
        change({ holder: member("drifted"), from: "none", to: "full", occurredAt: NOV_2 }),
        snapshot({ occurredAt: NOV_3, full: 2 }),
      ]);

      expect(state.openedAt).toBe(NOV_1);
      expect(state.counts.full).toBe(2);
      expect(Object.keys(state.members)).toEqual(["full-0", "full-1"]);
      expect(novemberOf(state).fullPeak).toBe(4);
    });
  });

  describe("given a change whose `from` disagrees with the seat the fold holds", () => {
    it("trusts the held seat and counts the mismatch", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, full: 2, lite: 1 }),
        change({ holder: member("lite-0"), from: "full", to: "none", occurredAt: NOV_2 }),
      ]);

      expect(state.counts).toEqual({ full: 2, lite: 0, developer: 0 });
      expect(state.mismatches).toBe(1);
    });

    it("treats a change the snapshot already captured as applied, never doubling it", () => {
      const state = foldAll([
        snapshot({ occurredAt: NOV_1, extra: [{ holder: member("founder"), seat: "full" }] }),
        change({ holder: member("founder"), from: "none", to: "full", occurredAt: NOV_1 }),
      ]);

      expect(state.counts.full).toBe(1);
      expect(state.mismatches).toBe(0);
    });
  });

  describe("given a month carries the count it began with", () => {
    const OCT_20 = at("2026-10-20T09:00:00Z");

    /** @scenario "A month nobody joined or left peaks at the count it began with" */
    it("fills an untouched month with the count October closed on", () => {
      const state = foldAll([snapshot({ occurredAt: OCT_20, full: 12 })]);

      const read = seatPeakAsOf({ state, now: at("2026-11-30T12:00:00Z") });

      expect(read.months.map((month) => [month.month, month.fullPeak, month.carried])).toEqual([
        ["2026-10", 12, false],
        ["2026-11", 12, true],
      ]);
      expect(read.months[1]?.fullPeakAt).toBe(at("2026-11-01T00:00:00Z"));
    });

    /** @scenario "A month's peak is never below the count it began with" */
    it("opens November at 12 before taking the removal away", () => {
      const state = foldAll([
        snapshot({ occurredAt: OCT_20, full: 12 }),
        change({ holder: member("full-0"), from: "full", to: "none", occurredAt: NOV_3 }),
      ]);

      expect(state.counts.full).toBe(11);
      expect(novemberOf(state).fullPeak).toBe(12);
      expect(novemberOf(state).fullPeakAt).toBe(at("2026-11-01T00:00:00Z"));
    });

    it("carries a later month from the last touched month's closing count", () => {
      const state = foldAll([
        snapshot({ occurredAt: OCT_20, full: 12 }),
        change({ holder: member("full-0"), from: "full", to: "none", occurredAt: NOV_3 }),
      ]);

      const read = seatPeakAsOf({ state, now: at("2027-01-15T00:00:00Z") });

      expect(read.months.map((month) => [month.month, month.fullPeak])).toEqual([
        ["2026-10", 12],
        ["2026-11", 12],
        ["2026-12", 11],
        ["2027-01", 11],
      ]);
    });

    it("gives back, as of now, the seats of invitations that have expired since", () => {
      const state = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 2,
          extra: [{ holder: invitation("inv-1", at("2026-12-10T00:00:00Z")), seat: "full" }],
        }),
      ]);

      const read = seatPeakAsOf({ state, now: at("2027-01-05T00:00:00Z") });

      expect(read.counts.full).toBe(2);
      expect(read.months.map((month) => [month.month, month.fullPeak])).toEqual([
        ["2026-11", 3],
        ["2026-12", 3],
        ["2027-01", 2],
      ]);
    });
  });

  describe("given the count can be rebuilt and is never doubled", () => {
    /** @scenario "A seat change delivered twice is counted once" */
    it("folds a redelivered change once", () => {
      const joined = change({
        holder: member("joiner"),
        from: "none",
        to: "full",
        occurredAt: NOV_2,
        changeId: "change-joined",
      });
      const state = foldAll([snapshot({ occurredAt: NOV_1, full: 10 }), joined, joined]);

      expect(state.counts.full).toBe(11);
      expect(novemberOf(state).fullPeak).toBe(11);
    });

    it("remembers a bounded number of change ids", () => {
      const facts: SeatPeakFact[] = [snapshot({ occurredAt: NOV_1 })];
      for (let i = 0; i <= SEAT_PEAK_RECENT_CHANGE_IDS; i += 1) {
        facts.push(
          change({ holder: member(`m-${i}`), from: "none", to: "lite", occurredAt: NOV_2 }),
        );
      }

      expect(foldAll(facts).recentChangeIds).toHaveLength(SEAT_PEAK_RECENT_CHANGE_IDS);
    });

    /** @scenario "Rebuilding the count from the recorded changes gives the same peaks" */
    it("gives identical state when the same three months are folded twice from empty", () => {
      const facts: SeatPeakFact[] = [
        snapshot({
          occurredAt: at("2026-09-15T00:00:00Z"),
          full: 5,
          lite: 2,
          extra: [{ holder: invitation("inv-1", at("2026-10-02T00:00:00Z")), seat: "lite" }],
        }),
        change({
          holder: member("a"),
          from: "none",
          to: "full",
          occurredAt: at("2026-09-20T00:00:00Z"),
        }),
        change({
          holder: member("full-0"),
          from: "full",
          to: "none",
          occurredAt: at("2026-10-05T00:00:00Z"),
        }),
        change({
          holder: member("lite-1"),
          from: "lite",
          to: "full",
          occurredAt: at("2026-11-01T00:00:00Z"),
        }),
        change({
          holder: member("dev"),
          from: "none",
          to: "developer",
          occurredAt: at("2026-11-02T00:00:00Z"),
        }),
      ];

      const first = foldAll(facts);
      const rebuilt = foldAll(facts);

      expect(rebuilt).toEqual(first);
      expect(Object.keys(first.months).toSorted()).toEqual(["2026-09", "2026-10", "2026-11"]);
      expect(first.months["2026-09"]).toMatchObject({ fullPeak: 6, litePeak: 3 });
      expect(first.months["2026-10"]).toMatchObject({ fullPeak: 6, litePeak: 3, fullAtEnd: 5 });
      expect(first.months["2026-11"]).toMatchObject({ fullPeak: 6, litePeak: 2 });
    });
  });
});

describe("seatPeakMonthOf", () => {
  it("reads the calendar month in UTC", () => {
    expect(seatPeakMonthOf(at("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(seatPeakMonthOf(at("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});
