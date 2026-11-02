/**
 * The monthly seat peak, folded from seat changes (ADR-002). Pure over event time: the clock is
 * read nowhere here, so folding the same events twice gives the same state.
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import {
  type RecordSeatChangedCommandData,
  type RecordSeatSnapshotCommandData,
  type SeatHolder,
  type SeatKind,
  seatKindSchema,
} from "../eventing/seat-peak.events.ts";

/** How many recent change ids the fold remembers, so a redelivered change counts once. */
export const SEAT_PEAK_RECENT_CHANGE_IDS = 1000;

export const seatCountsSchema = z.object({
  full: z.number().int().nonnegative(),
  lite: z.number().int().nonnegative(),
  developer: z.number().int().nonnegative(),
});
export type SeatCounts = z.infer<typeof seatCountsSchema>;

/** One calendar month (UTC): its peaks, when each was first reached, and its closing counts. */
export const seatPeakMonthSchema = z.object({
  fullPeak: z.number().int().nonnegative(),
  fullPeakAt: z.number(),
  litePeak: z.number().int().nonnegative(),
  litePeakAt: z.number(),
  fullAtEnd: z.number().int().nonnegative(),
  liteAtEnd: z.number().int().nonnegative(),
});
export type SeatPeakMonth = z.infer<typeof seatPeakMonthSchema>;

const seatPeakInvitationSchema = z.object({
  seat: seatKindSchema,
  expiresAt: z.number().nullable(),
});
export type SeatPeakInvitation = z.infer<typeof seatPeakInvitationSchema>;

export const seatPeakStateSchema = z.object({
  /** When the opening snapshot was taken; null until one is, and nothing is folded before it. */
  openedAt: z.number().nullable(),
  counts: seatCountsSchema,
  /** A member's seat by userId. A holder with no seat is not kept. */
  members: z.record(z.string(), seatKindSchema),
  /** A pending invitation's seat and expiry, by inviteId. */
  invitations: z.record(z.string(), seatPeakInvitationSchema),
  /** Keyed `YYYY-MM`, only the months an event touched; a read fills the gaps. */
  months: z.record(z.string(), seatPeakMonthSchema),
  /** Changes whose `from` disagreed with the seat the fold held: drift made visible. */
  mismatches: z.number().int().nonnegative(),
  /** The last change ids folded, oldest first, bounded by SEAT_PEAK_RECENT_CHANGE_IDS. */
  recentChangeIds: z.array(z.string()),
});
export type SeatPeakState = z.infer<typeof seatPeakStateSchema>;

export type SeatPeakFact =
  | Readonly<{ type: "seat_changed"; data: RecordSeatChangedCommandData }>
  | Readonly<{ type: "seat_snapshot_taken"; data: RecordSeatSnapshotCommandData }>;

export function emptySeatPeak(): SeatPeakState {
  return {
    openedAt: null,
    counts: { full: 0, lite: 0, developer: 0 },
    members: {},
    invitations: {},
    months: {},
    mismatches: 0,
    recentChangeIds: [],
  };
}

/** The UTC calendar month an instant falls in, as `YYYY-MM`. */
export function seatPeakMonthOf(epochMs: number): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(epochMs).toZonedDateTimeISO("UTC");
  return `${String(zoned.year).padStart(4, "0")}-${String(zoned.month).padStart(2, "0")}`;
}

/** The first millisecond of a `YYYY-MM` month, UTC. */
export function seatPeakMonthStart(month: string): number {
  const [year, monthOfYear] = month.split("-").map(Number);
  return Temporal.PlainDate.from({ year: year ?? 1970, month: monthOfYear ?? 1, day: 1 })
    .toZonedDateTime("UTC")
    .toInstant().epochMilliseconds;
}

/** The month after a `YYYY-MM` month. */
export function seatPeakNextMonth(month: string): string {
  const [year, monthOfYear] = month.split("-").map(Number);
  const next = Temporal.PlainYearMonth.from({ year: year ?? 1970, month: monthOfYear ?? 1 }).add({
    months: 1,
  });
  return `${String(next.year).padStart(4, "0")}-${String(next.month).padStart(2, "0")}`;
}

/** Folds one fact. A change before the opening snapshot, or one already folded, changes nothing. */
export function foldSeatPeak({
  state,
  fact,
}: {
  state: SeatPeakState;
  fact: SeatPeakFact;
}): SeatPeakState {
  if (fact.type === "seat_snapshot_taken") return foldSnapshot({ state, snapshot: fact.data });
  if (state.openedAt === null) return state;
  if (state.recentChangeIds.includes(fact.data.changeId)) return state;
  const expired = expireInvitations({ state, until: fact.data.occurredAt });
  const moved = moveHolder({ state: expired, change: fact.data });
  return {
    ...moved,
    recentChangeIds: [...moved.recentChangeIds, fact.data.changeId].slice(
      -SEAT_PEAK_RECENT_CHANGE_IDS,
    ),
  };
}

/** Gives back the seats of invitations that expired strictly before `until`, in expiry order. */
export function expireInvitations({
  state,
  until,
}: {
  state: SeatPeakState;
  until: number;
}): SeatPeakState {
  const expired = Object.entries(state.invitations)
    .filter(([, invitation]) => invitation.expiresAt !== null && invitation.expiresAt < until)
    .toSorted(([, a], [, b]) => (a.expiresAt ?? 0) - (b.expiresAt ?? 0));
  let next = state;
  for (const [inviteId, invitation] of expired) {
    const at = invitation.expiresAt ?? until;
    const { [inviteId]: _gone, ...invitations } = next.invitations;
    next = record({
      state: { ...next, invitations },
      counts: adjust({ counts: next.counts, seat: invitation.seat, by: -1 }),
      at,
    });
  }
  return next;
}

function foldSnapshot({
  state,
  snapshot,
}: {
  state: SeatPeakState;
  snapshot: RecordSeatSnapshotCommandData;
}): SeatPeakState {
  const members: Record<string, SeatKind> = {};
  const invitations: Record<string, SeatPeakInvitation> = {};
  let counts: SeatCounts = { full: 0, lite: 0, developer: 0 };
  for (const { holder, seat } of snapshot.holders) {
    if (seat === "none") continue;
    if (holder.kind === "invitation") {
      if (holder.expiresAt !== null && holder.expiresAt < snapshot.occurredAt) continue;
      invitations[holder.inviteId] = { seat, expiresAt: holder.expiresAt };
    } else {
      members[holder.userId] = seat;
    }
    counts = adjust({ counts, seat, by: 1 });
  }
  return record({
    state: {
      ...state,
      openedAt: state.openedAt ?? snapshot.occurredAt,
      members,
      invitations,
    },
    counts,
    at: snapshot.occurredAt,
  });
}

function moveHolder({
  state,
  change,
}: {
  state: SeatPeakState;
  change: RecordSeatChangedCommandData;
}): SeatPeakState {
  const held = heldSeat({ state, holder: change.holder });
  // Already on `to` is a change a snapshot captured before the change was folded, not drift.
  const agrees = held === change.from || held === change.to;
  const mismatches = agrees ? state.mismatches : state.mismatches + 1;
  const counts = adjust({
    counts: adjust({ counts: state.counts, seat: held, by: -1 }),
    seat: change.to,
    by: 1,
  });
  return record({
    state: { ...withHolder({ state, holder: change.holder, seat: change.to }), mismatches },
    counts,
    at: change.occurredAt,
  });
}

function heldSeat({ state, holder }: { state: SeatPeakState; holder: SeatHolder }): SeatKind {
  if (holder.kind === "member") return state.members[holder.userId] ?? "none";
  return state.invitations[holder.inviteId]?.seat ?? "none";
}

function withHolder({
  state,
  holder,
  seat,
}: {
  state: SeatPeakState;
  holder: SeatHolder;
  seat: SeatKind;
}): SeatPeakState {
  if (holder.kind === "member") {
    const { [holder.userId]: _previous, ...members } = state.members;
    return { ...state, members: seat === "none" ? members : { ...members, [holder.userId]: seat } };
  }
  const { [holder.inviteId]: _previous, ...invitations } = state.invitations;
  return {
    ...state,
    invitations:
      seat === "none"
        ? invitations
        : { ...invitations, [holder.inviteId]: { seat, expiresAt: holder.expiresAt } },
  };
}

function adjust({
  counts,
  seat,
  by,
}: {
  counts: SeatCounts;
  seat: SeatKind;
  by: number;
}): SeatCounts {
  if (seat === "none") return counts;
  return { ...counts, [seat]: Math.max(0, counts[seat] + by) };
}

/**
 * Sets the running counts at `at` and raises its month's peaks. A month first touched opens at
 * the count carried into it, so its peak is never below the count it began with.
 */
function record({
  state,
  counts,
  at,
}: {
  state: SeatPeakState;
  counts: SeatCounts;
  at: number;
}): SeatPeakState {
  const month = seatPeakMonthOf(at);
  const opened = state.months[month] ?? openMonth({ state, month, at });
  const raisesFull = counts.full > opened.fullPeak;
  const raisesLite = counts.lite > opened.litePeak;
  return {
    ...state,
    counts,
    months: {
      ...state.months,
      [month]: {
        fullPeak: raisesFull ? counts.full : opened.fullPeak,
        fullPeakAt: raisesFull ? at : opened.fullPeakAt,
        litePeak: raisesLite ? counts.lite : opened.litePeak,
        litePeakAt: raisesLite ? at : opened.litePeakAt,
        fullAtEnd: counts.full,
        liteAtEnd: counts.lite,
      },
    },
  };
}

function openMonth({
  state,
  month,
  at,
}: {
  state: SeatPeakState;
  month: string;
  at: number;
}): SeatPeakMonth {
  // The opening month is held from the snapshot, never from before counting started.
  const since = Math.max(seatPeakMonthStart(month), state.openedAt ?? at);
  return {
    fullPeak: state.counts.full,
    fullPeakAt: since,
    litePeak: state.counts.lite,
    litePeakAt: since,
    fullAtEnd: state.counts.full,
    liteAtEnd: state.counts.lite,
  };
}

/** One month as a read shows it: touched, or carried from the month before. */
export interface SeatPeakMonthRead extends SeatPeakMonth {
  month: string;
  carried: boolean;
}

/**
 * The state as of `now`: invitations expired by then give back their seats, and every month from
 * the opening to `now` is present, a month nobody touched carrying the count it began with.
 */
export function seatPeakAsOf({ state, now }: { state: SeatPeakState; now: number }): Readonly<{
  counts: SeatCounts;
  months: SeatPeakMonthRead[];
}> {
  if (state.openedAt === null) return { counts: state.counts, months: [] };
  const settled = expireInvitations({ state, until: now });
  const months: SeatPeakMonthRead[] = [];
  const last = seatPeakMonthOf(Math.max(now, settled.openedAt ?? now));
  let carried: SeatPeakMonth | undefined;
  for (
    let month = seatPeakMonthOf(settled.openedAt ?? now);
    month <= last;
    month = seatPeakNextMonth(month)
  ) {
    const touched = settled.months[month];
    if (touched) {
      months.push({ month, carried: false, ...touched });
      carried = touched;
      continue;
    }
    const start = seatPeakMonthStart(month);
    const full = carried?.fullAtEnd ?? settled.counts.full;
    const lite = carried?.liteAtEnd ?? settled.counts.lite;
    const filled = {
      fullPeak: full,
      fullPeakAt: start,
      litePeak: lite,
      litePeakAt: start,
      fullAtEnd: full,
      liteAtEnd: lite,
    };
    months.push({ month, carried: true, ...filled });
    carried = filled;
  }
  return { counts: settled.counts, months };
}
