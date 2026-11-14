import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import type { SeatHolder, SeatKind } from "../seat-holder.rules.ts";
import {
  emptySeatPeak,
  foldSeatPeak,
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
  extra?: { holder: SeatHolder; seat: SeatKind; suppressedBy?: string }[];
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

      expect(state.invitations).toEqual({
        "inv-1": { seat: "none", expiresAt: NOV_2, lastChangedAt: NOV_1, expiredByFold: true },
      });
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

    /** @scenario "Extending an invitation keeps its seat until the new expiry" */
    it("keeps an extended invitation's seat past its old expiry, until the new one", () => {
      const state = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1", NOV_2), seat: "full" }],
        }),
        change({
          holder: invitation("inv-1", NOV_3),
          from: "full",
          to: "full",
          occurredAt: NOV_1 + 1,
        }),
        change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_2 + 1 }),
      ]);

      expect(state.invitations).toEqual({
        "inv-1": {
          seat: "full",
          expiresAt: NOV_3,
          lastChangedAt: NOV_1 + 1,
          lastChangeId: expect.any(String),
        },
      });
      expect(state.counts.full).toBe(12);
      expect(novemberOf(state).fullPeak).toBe(12);
      expect(state.mismatches).toBe(0);
    });

    it("keeps an extension that arrives after a change dated past the old expiry", () => {
      const state = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1", NOV_2), seat: "full" }],
        }),
        change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_2 + 1 }),
        change({
          holder: invitation("inv-1", NOV_3),
          from: "full",
          to: "full",
          occurredAt: NOV_1 + 1,
        }),
      ]);

      expect(state.invitations).toEqual({
        "inv-1": {
          seat: "full",
          expiresAt: NOV_3,
          lastChangedAt: NOV_1 + 1,
          lastChangeId: expect.any(String),
        },
      });
      expect(state.counts.full).toBe(12);
      expect(state.mismatches).toBe(0);
    });

    it("expires a late extension again when its new expiry is already past", () => {
      const extendedTo = NOV_2 + 60_000;
      const facts = (late: boolean): SeatPeakFact[] => {
        const extension = change({
          holder: invitation("inv-1", extendedTo),
          from: "full",
          to: "full",
          occurredAt: NOV_1 + 1,
        });
        const joiner = change({
          holder: member("joiner"),
          from: "none",
          to: "full",
          occurredAt: NOV_3,
        });
        const opening = snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1", NOV_2), seat: "full" }],
        });
        return late ? [opening, joiner, extension] : [opening, extension, joiner];
      };
      const state = foldAll(facts(true));

      expect(state.invitations["inv-1"]).toMatchObject({ seat: "none", expiresAt: extendedTo });
      expect(state.counts).toEqual(foldAll(facts(false)).counts);
      expect(state.counts.full).toBe(11);
      expect(state.mismatches).toBe(0);
    });

    it("moves only the expiry when an invitation is extended, never the peak or its moment", () => {
      const opened = foldAll([
        snapshot({
          occurredAt: NOV_1,
          full: 10,
          extra: [{ holder: invitation("inv-1", NOV_2), seat: "full" }],
        }),
      ]);
      const extended = foldAll(
        [
          change({
            holder: invitation("inv-1", NOV_3),
            from: "full",
            to: "full",
            occurredAt: NOV_1 + 1,
          }),
        ],
        opened,
      );

      expect(extended.counts).toEqual(opened.counts);
      expect(extended.months).toEqual(opened.months);
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

    it("moves nothing on a second snapshot of an opened organization", () => {
      const opened = foldAll([
        snapshot({ occurredAt: NOV_1, full: 10 }),
        change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_2 }),
      ]);

      expect(foldSeatPeak({ state: opened, fact: snapshot({ occurredAt: NOV_2, full: 3 }) })).toBe(
        opened,
      );
    });

    it("orders two changes stamped in one millisecond by change id, dropping neither", () => {
      const down = change({
        holder: member("full-0"),
        from: "full",
        to: "lite",
        occurredAt: NOV_2,
        changeId: "seatchange_a",
      });
      const up = change({
        holder: member("full-0"),
        from: "lite",
        to: "full",
        occurredAt: NOV_2,
        changeId: "seatchange_b",
      });

      for (const order of [
        [down, up],
        [up, down],
      ]) {
        const state = foldAll([snapshot({ occurredAt: NOV_1, full: 2 }), ...order]);

        expect(state.members["full-0"]).toMatchObject({
          seat: "full",
          lastChangeId: "seatchange_b",
        });
        expect(state.counts).toEqual({ full: 2, lite: 0, developer: 0 });
      }
    });

    it("ends at the table's seat when a role goes down and straight back up, in either order", () => {
      const down = change({
        holder: member("full-0"),
        from: "full",
        to: "lite",
        occurredAt: NOV_2,
      });
      const up = change({
        holder: member("full-0"),
        from: "lite",
        to: "full",
        occurredAt: NOV_2 + 1,
      });

      for (const order of [
        [down, up],
        [up, down],
      ]) {
        const state = foldAll([snapshot({ occurredAt: NOV_1, full: 2 }), ...order]);

        expect(state.members["full-0"]?.seat).toBe("full");
        expect(state.counts.full).toBe(2);
      }
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

  describe("given changes are folded in the order they arrive (ADR-002 §7)", () => {
    const T = at("2026-10-31T23:30:00Z");
    const minutes = (n: number) => T + n * 60_000;

    function opening(): SeatPeakFact {
      return snapshot({
        occurredAt: T,
        full: 10,
        lite: 1,
        extra: [{ holder: invitation("inv-1", minutes(30)), seat: "full" }],
      });
    }

    /** Crossing the invitation's expiry, the month boundary and two changes to one holder. */
    function history(): SeatPeakFact[] {
      return [
        change({ holder: member("a"), from: "none", to: "full", occurredAt: minutes(5) }),
        change({ holder: member("c"), from: "none", to: "full", occurredAt: minutes(8) }),
        change({ holder: member("full-0"), from: "full", to: "none", occurredAt: minutes(20) }),
        change({ holder: member("b"), from: "none", to: "full", occurredAt: minutes(40) }),
        change({ holder: member("c"), from: "full", to: "lite", occurredAt: minutes(42) }),
        change({ holder: member("full-1"), from: "full", to: "lite", occurredAt: minutes(45) }),
      ];
    }

    /** The last touched month's ends and an untouched later month, against the running count. */
    function closingOf(state: SeatPeakState) {
      const december = seatPeakAsOf({ state, now: at("2026-12-15T00:00:00Z") }).months.at(-1);
      expect(state.months["2026-11"]).toMatchObject({
        fullAtEnd: state.counts.full,
        liteAtEnd: state.counts.lite,
      });
      expect(december).toMatchObject({
        month: "2026-12",
        carried: true,
        fullPeak: state.counts.full,
        litePeak: state.counts.lite,
      });
      const november = state.months["2026-11"];
      return {
        november: { fullAtEnd: november?.fullAtEnd, liteAtEnd: november?.liteAtEnd },
        december: { fullPeak: december?.fullPeak, litePeak: december?.litePeak },
      };
    }

    function orders<T>(items: readonly T[]): T[][] {
      if (items.length <= 1) return [[...items]];
      return items.flatMap((item, i) =>
        orders(items.filter((_, j) => j !== i)).map((rest) => [item, ...rest]),
      );
    }

    it("ends at the same running counts and holders in any order", () => {
      const changes = history();
      const inOrder = foldAll([opening(), ...changes]);

      for (const order of orders(changes)) {
        const folded = foldAll([opening(), ...order]);

        expect(folded.counts).toEqual(inOrder.counts);
        expect(folded.members).toEqual(inOrder.members);
        expect(folded.invitations).toEqual(inOrder.invitations);
        expect(closingOf(folded)).toEqual(closingOf(inOrder));
      }
      expect(inOrder.counts).toEqual({ full: 10, lite: 3, developer: 0 });
      expect(inOrder.members.c).toMatchObject({ seat: "lite", lastChangedAt: minutes(42) });
      expect(inOrder.months["2026-10"]).toMatchObject({ fullPeak: 13, fullAtEnd: 12 });
    });

    it("keeps each month's peak within one seat when two changes cross", () => {
      const inOrder = foldAll([opening(), ...history()]);
      // Each change overtaken by the next one, and the two changes to holder `c` swapped.
      const pairs = [
        [0, 1],
        [1, 2],
        [2, 3],
        [3, 4],
        [4, 5],
        [1, 4],
      ] as const;

      for (const [i, j] of pairs) {
        const crossed = history();
        [crossed[i], crossed[j]] = [crossed[j]!, crossed[i]!];
        const folded = foldAll([opening(), ...crossed]);

        expect(folded.counts).toEqual(inOrder.counts);
        expect(folded.mismatches).toBeLessThanOrEqual(1);
        expect(closingOf(folded)).toMatchObject({
          december: { fullPeak: inOrder.counts.full, litePeak: inOrder.counts.lite },
        });
        for (const month of ["2026-10", "2026-11"]) {
          const peak = folded.months[month];
          const exact = inOrder.months[month];
          expect(Math.abs((peak?.fullPeak ?? 0) - (exact?.fullPeak ?? 0))).toBeLessThanOrEqual(1);
          expect(Math.abs((peak?.litePeak ?? 0) - (exact?.litePeak ?? 0))).toBeLessThanOrEqual(1);
          expect(Math.abs((peak?.fullAtEnd ?? 0) - (exact?.fullAtEnd ?? 0))).toBeLessThanOrEqual(1);
          expect(Math.abs((peak?.liteAtEnd ?? 0) - (exact?.liteAtEnd ?? 0))).toBeLessThanOrEqual(1);
        }
      }
    });

    it("attributes a change that arrives late to its month, and carries it into later ones", () => {
      const [joined, , , , , moved] = history();
      const state = foldAll([opening(), moved!, joined!]);

      // October closed on 10 full, the invitation and `a`; November lost the invitation and full-1.
      expect(state.months["2026-10"]).toMatchObject({ fullPeak: 12, fullAtEnd: 12 });
      expect(state.months["2026-11"]).toMatchObject({
        fullPeak: 12,
        fullAtEnd: 10,
        litePeak: 2,
        liteAtEnd: 2,
      });
      expect(state.counts).toEqual({ full: 10, lite: 2, developer: 0 });
      expect(state.months).toEqual(foldAll([opening(), joined!, moved!]).months);
    });

    it("never lowers a later month's peak when a late change gives a seat back", () => {
      const removed = change({
        holder: member("full-0"),
        from: "full",
        to: "none",
        occurredAt: minutes(10),
      });
      const joined = change({
        holder: member("b"),
        from: "none",
        to: "full",
        occurredAt: minutes(40),
      });
      const state = foldAll([opening(), joined, removed]);

      expect(state.months["2026-10"]).toMatchObject({ fullPeak: 11, fullAtEnd: 10 });
      expect(state.months["2026-11"]).toMatchObject({ fullPeak: 11, fullAtEnd: 10 });
      expect(state.counts.full).toBe(10);
    });
  });
});

describe("foldSeatPeak's settled holders", () => {
  const NOV_25 = at("2026-11-25T09:00:00Z");
  const created = change({
    holder: invitation("inv-1", at("2026-11-20T00:00:00Z")),
    from: "none",
    to: "full",
    occurredAt: NOV_2,
  });
  const revoked = change({
    holder: invitation("inv-1", at("2026-11-20T00:00:00Z")),
    from: "full",
    to: "none",
    occurredAt: NOV_3,
  });

  it("counts a removed member again when they are re-added", () => {
    const state = foldAll([
      snapshot({ occurredAt: NOV_1, extra: [{ holder: member("leaver"), seat: "full" }] }),
      change({ holder: member("leaver"), from: "full", to: "none", occurredAt: NOV_3 }),
      change({ holder: member("leaver"), from: "none", to: "full", occurredAt: NOV_25 }),
    ]);

    expect(state.members.leaver).toMatchObject({ seat: "full" });
    expect(state.counts.full).toBe(1);
    expect(state.mismatches).toBe(0);
  });

  it("keeps a revoked invitation, so its late creation stays stale", () => {
    const state = foldAll([
      snapshot({ occurredAt: NOV_1, full: 2 }),
      revoked,
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_25 }),
      created,
    ]);

    expect(state.invitations["inv-1"]).toMatchObject({ seat: "none", lastChangedAt: NOV_3 });
    expect(state.counts.full).toBe(3);
  });

  it("takes a lapsed invitation's seat back when it is refreshed", () => {
    const lapsing = invitation("inv-2", NOV_2);
    const refreshedUntil = NOV_25 + 60_000;
    const state = foldAll([
      snapshot({ occurredAt: NOV_1, full: 2, extra: [{ holder: lapsing, seat: "full" }] }),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_25 }),
      change({
        holder: invitation("inv-2", refreshedUntil),
        from: "none",
        to: "full",
        occurredAt: NOV_25 + 1,
      }),
    ]);

    expect(state.invitations["inv-2"]).toMatchObject({ seat: "full", expiresAt: refreshedUntil });
    expect(state.counts.full).toBe(4);
    expect(state.mismatches).toBe(0);
  });
});

describe("seatPeakMonthOf", () => {
  it("reads the calendar month in UTC", () => {
    expect(seatPeakMonthOf(at("2026-10-31T23:59:59Z"))).toBe("2026-10");
    expect(seatPeakMonthOf(at("2026-11-01T00:00:00Z"))).toBe("2026-11");
  });
});

function hold(userId: string, expiresAt: number): SeatHolder {
  return { kind: "hold", userId, expiresAt };
}

const DEC_1 = at("2026-12-01T09:00:00Z");

describe("given a held seat counts until its hold ends", () => {
  /** @scenario "A removed member's held seat keeps counting toward the peak" */
  it("moves the removed member's seat onto the hold, so the next joiner raises the peak", () => {
    const state = foldAll([
      snapshot({ occurredAt: NOV_1, full: 10 }),
      change({ holder: member("full-0"), from: "full", to: "none", occurredAt: NOV_2 }),
      change({ holder: hold("full-0", DEC_1), from: "none", to: "full", occurredAt: NOV_2 + 1 }),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
    ]);

    expect(state.counts.full).toBe(11);
    expect(novemberOf(state).fullPeak).toBe(11);
  });

  /** @scenario "A held seat is given back from the moment its hold ends" */
  it("gives the held seat back at the hold's end, before the next change is folded", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("left", NOV_2), seat: "full" }],
      }),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
    ]);

    expect(state.holds).toEqual({
      left: { seat: "none", expiresAt: NOV_2, lastChangedAt: NOV_1, expiredByFold: true },
    });
    expect(state.counts.full).toBe(10);
    expect(novemberOf(state).fullPeak).toBe(10);
  });

  it("reads a hold ended since the last change as given back", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("left", NOV_2), seat: "full" }],
      }),
    ]);

    expect(seatPeakAsOf({ state, now: NOV_3 }).counts.full).toBe(9);
  });

  /** @scenario "A person back within their hold takes their held seat, not a second one" */
  it("moves the held seat back onto the member without raising the peak", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("back", DEC_1), seat: "full" }],
      }),
      change({ holder: hold("back", DEC_1), from: "full", to: "none", occurredAt: NOV_2 }),
      change({ holder: member("back"), from: "none", to: "full", occurredAt: NOV_2 + 1 }),
    ]);

    expect(state.counts.full).toBe(10);
    expect(novemberOf(state).fullPeak).toBe(10);
  });

  it("counts no mismatch when a hold the fold ended is given back by its writer", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("left", NOV_2), seat: "full" }],
      }),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
      change({ holder: hold("left", NOV_2), from: "full", to: "none", occurredAt: NOV_3 + 1 }),
    ]);

    expect(state.mismatches).toBe(0);
    expect(state.counts.full).toBe(10);
  });
});

describe("given a full invitation took a held seat's place", () => {
  /** A hold giving its seat to invitation `inviteId`, as the invitation's writer records it. */
  function suppressed(userId: string, inviteId: string, occurredAt: number): SeatPeakFact {
    const fact = change({ holder: hold(userId, DEC_1), from: "full", to: "none", occurredAt });
    if (fact.type !== "seat_changed") throw new Error("a hold change is a seat change");
    return { ...fact, data: { ...fact.data, suppressedByInviteId: inviteId } };
  }

  function invitedOverHold() {
    return [
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("left", DEC_1), seat: "full" }],
      }),
      suppressed("left", "inv-1", NOV_1 + 1),
      change({
        holder: invitation("inv-1", NOV_2),
        from: "none",
        to: "full",
        occurredAt: NOV_1 + 2,
      }),
    ];
  }

  /** @scenario "A held seat counts again when the invitation that took its place expires" */
  it("hands the seat back to the hold when the invitation expires unaccepted", () => {
    const state = foldAll([
      ...invitedOverHold(),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
    ]);

    expect(state.invitations["inv-1"]?.seat).toBe("none");
    expect(state.holds.left).toMatchObject({ seat: "full", restoredByFold: true });
    expect(state.counts.full).toBe(11);
    expect(novemberOf(state).fullPeak).toBe(11);
  });

  /** @scenario "A held seat an invitation stood in for when counting opened counts again when it expires" */
  it("keeps the seatless hold at the opening and hands it the expiring invitation's seat", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [
          { holder: invitation("inv-1", NOV_2), seat: "full" },
          { holder: hold("left", DEC_1), seat: "none", suppressedBy: "inv-1" },
        ],
      }),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
    ]);

    expect(state.invitations["inv-1"]?.seat).toBe("none");
    expect(state.holds.left).toMatchObject({ seat: "full", restoredByFold: true });
    expect(state.counts.full).toBe(11);
    expect(novemberOf(state).fullPeak).toBe(11);
  });

  it("opens without a hold no invitation stands in for when it holds no seat", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("left", DEC_1), seat: "none" }],
      }),
    ]);

    expect(state.holds).toEqual({});
    expect(state.counts.full).toBe(9);
  });

  it("takes the seat back from the hold when a late extension revives the invitation", () => {
    const state = foldAll([
      ...invitedOverHold(),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 }),
      change({
        holder: invitation("inv-1", DEC_1),
        from: "full",
        to: "full",
        occurredAt: NOV_2 - 1,
      }),
    ]);

    expect(state.invitations["inv-1"]?.seat).toBe("full");
    expect(state.holds.left?.seat).toBe("none");
    expect(state.counts.full).toBe(11);
    expect(state.mismatches).toBe(0);
  });

  it("leaves a hold that ended before the invitation expired without a seat", () => {
    const state = foldAll([
      snapshot({
        occurredAt: NOV_1,
        full: 9,
        extra: [{ holder: hold("left", NOV_2), seat: "full" }],
      }),
      (() => {
        const fact = change({
          holder: hold("left", NOV_2),
          from: "full",
          to: "none",
          occurredAt: NOV_1 + 1,
        });
        if (fact.type !== "seat_changed") throw new Error("a hold change is a seat change");
        return { ...fact, data: { ...fact.data, suppressedByInviteId: "inv-1" } };
      })(),
      change({
        holder: invitation("inv-1", NOV_3),
        from: "none",
        to: "full",
        occurredAt: NOV_1 + 2,
      }),
      change({ holder: member("joiner"), from: "none", to: "full", occurredAt: NOV_3 + 1 }),
    ]);

    expect(state.holds.left?.seat).toBe("none");
    expect(state.counts.full).toBe(10);
  });
});
