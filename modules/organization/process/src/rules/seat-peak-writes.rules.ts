/**
 * What a fold changed in a loaded slice of the stored count (ADR-002 §2), so a repository writes
 * only those rows: the counts row, the holders that moved and the months that moved.
 */
import type {
  SeatCounts,
  SeatPeakInvitation,
  SeatPeakMember,
  SeatPeakMonth,
  SeatPeakState,
} from "./seat-peak.rules.ts";

/** The organization's one counts row: when counting opened, the running counts and the drift. */
export type SeatPeakCountsRow = Readonly<{
  openedAt: number;
  counts: SeatCounts;
  latestChangeAt: number;
  mismatches: number;
}>;

/** One holder's row; an invitation or a hold carries its expiry, a member carries none. */
export type SeatPeakHolderRow =
  | Readonly<{ kind: "member"; holderId: string; holding: SeatPeakMember }>
  | Readonly<{ kind: "invitation" | "hold"; holderId: string; holding: SeatPeakInvitation }>;

export type SeatPeakWrites = Readonly<{
  /** Null when the counts row did not move, or counting has not opened. */
  counts: SeatPeakCountsRow | null;
  /** Holders the slice had not loaded: new rows. */
  createdHolders: readonly SeatPeakHolderRow[];
  /** Loaded holders whose row moved. */
  updatedHolders: readonly SeatPeakHolderRow[];
  /** Months that moved or were first touched, keyed `YYYY-MM`. */
  months: readonly Readonly<{ month: string; values: SeatPeakMonth }>[];
}>;

/** The rows to write so the store matches `after`, given the slice `before` it was folded from. */
export function seatPeakWrites({
  before,
  after,
}: {
  before: SeatPeakState;
  after: SeatPeakState;
}): SeatPeakWrites {
  const holders = [
    ...Object.entries(after.members).map(([holderId, holding]) => ({
      row: { kind: "member" as const, holderId, holding },
      was: before.members[holderId],
    })),
    ...Object.entries(after.invitations).map(([holderId, holding]) => ({
      row: { kind: "invitation" as const, holderId, holding },
      was: before.invitations[holderId],
    })),
    ...Object.entries(after.holds).map(([holderId, holding]) => ({
      row: { kind: "hold" as const, holderId, holding },
      was: before.holds[holderId],
    })),
  ];
  const months = Object.entries(after.months)
    .filter(([month, values]) => !same(before.months[month], values))
    .map(([month, values]) => ({ month, values }));
  const countsMoved =
    before.openedAt !== after.openedAt ||
    before.latestChangeAt !== after.latestChangeAt ||
    before.mismatches !== after.mismatches ||
    !same(before.counts, after.counts);
  return {
    counts:
      countsMoved && after.openedAt !== null
        ? {
            openedAt: after.openedAt,
            counts: after.counts,
            latestChangeAt: after.latestChangeAt,
            mismatches: after.mismatches,
          }
        : null,
    createdHolders: holders.filter(({ was }) => was === undefined).map(({ row }) => row),
    updatedHolders: holders
      .filter(({ was, row }) => was !== undefined && !same(was, row.holding))
      .map(({ row }) => row),
    months,
  };
}

function same(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}
