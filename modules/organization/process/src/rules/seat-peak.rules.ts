/**
 * The monthly seat peak, folded from seat changes (ADR-002). Pure over event time: the clock is
 * read nowhere here, so folding the same events twice gives the same state.
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

import type {
  RecordSeatChangedCommandData,
  RecordSeatSnapshotCommandData,
} from "../eventing/seat-peak.events.ts";
import {
  type SeatHolder,
  seatHolderId,
  type SeatKind,
  seatKindSchema,
} from "./seat-holder.rules.ts";

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

/**
 * A holder's seat and the last change applied to it; `none` is kept, so it orders. A snapshot
 * leaves `lastChangeId` absent, and wins a tie with a change at its own moment.
 */
const seatPeakMemberSchema = z.object({
  seat: seatKindSchema,
  lastChangedAt: z.number(),
  lastChangeId: z.string().optional(),
});

const seatPeakInvitationSchema = z.object({
  ...seatPeakMemberSchema.shape,
  expiresAt: z.number().nullable(),
  /** The fold gave its seat back at `expiresAt`: inferred, so it never outranks a real change. */
  expiredByFold: z.boolean().optional(),
});

/**
 * The slice of an organization's stored count one fact needs (ADR-002 §2): the running counts,
 * every touched month, and only the holders the repository loaded for it (the one a change
 * moves and the invitations due to expire), never every holder.
 */
export const seatPeakStateSchema = z.object({
  /** When the opening snapshot was taken; null until one is, and nothing is folded before it. */
  openedAt: z.number().nullable(),
  counts: seatCountsSchema,
  /** The latest change time applied to any holder; invitations expire up to it. */
  latestChangeAt: z.number(),
  /** The loaded members' seats, by userId. */
  members: z.record(z.string(), seatPeakMemberSchema),
  /** The loaded invitations' seats and expiries, by inviteId. */
  invitations: z.record(z.string(), seatPeakInvitationSchema),
  /** The loaded seat holds' seats and ends, by userId; a hold expires as an invitation does. */
  holds: z.record(z.string(), seatPeakInvitationSchema),
  /** Keyed `YYYY-MM`, only the months an event touched; a read fills the gaps. */
  months: z.record(z.string(), seatPeakMonthSchema),
  /** Changes whose `from` disagreed with the seat the fold held: drift made visible. */
  mismatches: z.number().int().nonnegative(),
});
export type SeatPeakState = z.infer<typeof seatPeakStateSchema>;
export type SeatPeakMember = z.infer<typeof seatPeakMemberSchema>;
export type SeatPeakInvitation = z.infer<typeof seatPeakInvitationSchema>;

export type SeatPeakFact =
  | Readonly<{ type: "seat_changed"; data: RecordSeatChangedCommandData }>
  | Readonly<{ type: "seat_snapshot_taken"; data: RecordSeatSnapshotCommandData }>;

export function emptySeatPeak(): SeatPeakState {
  return {
    openedAt: null,
    counts: { full: 0, lite: 0, developer: 0 },
    latestChangeAt: Number.NEGATIVE_INFINITY,
    members: {},
    invitations: {},
    holds: {},
    months: {},
    mismatches: 0,
  };
}

/** The holders that expire on their own: pending invitations and seat holds. */
type ExpiringKind = "invitation" | "hold";
const EXPIRING_KINDS = ["invitation", "hold"] as const satisfies readonly ExpiringKind[];

function expiringOf({
  state,
  kind,
}: {
  state: SeatPeakState;
  kind: ExpiringKind;
}): Record<string, SeatPeakInvitation> {
  return kind === "invitation" ? state.invitations : state.holds;
}

function withExpiring({
  state,
  kind,
  entries,
}: {
  state: SeatPeakState;
  kind: ExpiringKind;
  entries: Record<string, SeatPeakInvitation>;
}): SeatPeakState {
  return kind === "invitation" ? { ...state, invitations: entries } : { ...state, holds: entries };
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

/**
 * Folds one fact in the order it arrives (ADR-002 §7). A change before the opening snapshot, or
 * one ordered at or before its holder's last change (a redelivery ties) moves nothing; invitations
 * expired by the change's time give back first. A second snapshot moves nothing.
 */
export function foldSeatPeak({
  state,
  fact,
}: {
  state: SeatPeakState;
  fact: SeatPeakFact;
}): SeatPeakState {
  if (fact.type === "seat_snapshot_taken") {
    return state.openedAt === null ? openSnapshot({ state, snapshot: fact.data }) : state;
  }
  if (state.openedAt === null) return state;
  const change = fact.data;
  if (isStale({ holding: holdingOf({ state, holder: change.holder }), change })) return state;
  const applied = moveHolder({
    state: expireInvitations({ state, until: change.occurredAt }),
    change,
  });
  const latestChangeAt = Math.max(applied.latestChangeAt, change.occurredAt);
  // A late invitation change may carry an expiry already past what the fold has seen.
  if (change.holder.kind === "member") return { ...applied, latestChangeAt };
  return expireInvitations({ state: { ...applied, latestChangeAt }, until: latestChangeAt });
}

type Holding = Readonly<{ seat: SeatKind; lastChangedAt: number; lastChangeId?: string }>;

/** Changes order by `(occurredAt, changeId)`, a total order: only the same change ties. */
function isStale({
  holding,
  change,
}: {
  holding: Holding;
  change: RecordSeatChangedCommandData;
}): boolean {
  if (change.occurredAt !== holding.lastChangedAt) return change.occurredAt < holding.lastChangedAt;
  return holding.lastChangeId === undefined || change.changeId <= holding.lastChangeId;
}

/**
 * Gives back the seats of invitations and seat holds that expired strictly before `until`, in
 * expiry order.
 */
export function expireInvitations({
  state,
  until,
}: {
  state: SeatPeakState;
  until: number;
}): SeatPeakState {
  const expired = EXPIRING_KINDS.flatMap((kind) =>
    Object.entries(expiringOf({ state, kind })).map(([id, holding]) => ({ kind, id, holding })),
  )
    .filter(
      ({ holding }) =>
        holding.seat !== "none" && holding.expiresAt !== null && holding.expiresAt < until,
    )
    .toSorted((a, b) => (a.holding.expiresAt ?? 0) - (b.holding.expiresAt ?? 0));
  let next = state;
  for (const { kind, id, holding } of expired) {
    const entries = {
      ...expiringOf({ state: next, kind }),
      [id]: { ...holding, seat: "none" as const, expiredByFold: true },
    };
    next = record({
      state: withExpiring({ state: next, kind, entries }),
      counts: adjust({ counts: next.counts, seat: holding.seat, by: -1 }),
      at: holding.expiresAt ?? until,
    });
  }
  return next;
}

function openSnapshot({
  state,
  snapshot,
}: {
  state: SeatPeakState;
  snapshot: RecordSeatSnapshotCommandData;
}): SeatPeakState {
  const members: SeatPeakState["members"] = {};
  const expiring = { invitation: {}, hold: {} } as Record<
    ExpiringKind,
    Record<string, SeatPeakInvitation>
  >;
  let counts: SeatCounts = { full: 0, lite: 0, developer: 0 };
  const lastChangedAt = snapshot.occurredAt;
  for (const { holder, seat } of snapshot.holders) {
    if (seat === "none") continue;
    if (holder.kind === "member") {
      members[holder.userId] = { seat, lastChangedAt };
    } else {
      if (holder.expiresAt !== null && holder.expiresAt < snapshot.occurredAt) continue;
      expiring[holder.kind][seatHolderId(holder)] = {
        seat,
        expiresAt: holder.expiresAt,
        lastChangedAt,
      };
    }
    counts = adjust({ counts, seat, by: 1 });
  }
  return record({
    state: {
      ...state,
      openedAt: snapshot.occurredAt,
      latestChangeAt: snapshot.occurredAt,
      members,
      invitations: expiring.invitation,
      holds: expiring.hold,
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
  if (change.from === change.to && held === change.to && change.holder.kind !== "member") {
    // An extended invitation or hold keeps its seat; only its expiry moves.
    return withHolder({ state, change });
  }
  const agrees = held === change.from || inferredExpiry({ state, holder: change.holder });
  const mismatches = agrees ? state.mismatches : state.mismatches + 1;
  const counts = adjust({
    counts: adjust({ counts: state.counts, seat: held, by: -1 }),
    seat: change.to,
    by: 1,
  });
  return record({
    state: { ...withHolder({ state, change }), mismatches },
    counts,
    at: change.occurredAt,
    heldUntil: change.holder.kind === "member" ? null : change.holder.expiresAt,
  });
}

/** A holder the fold has never seen holds no seat and has had no change. */
const UNSEEN = { seat: "none", lastChangedAt: Number.NEGATIVE_INFINITY } as const;

function holdingOf({ state, holder }: { state: SeatPeakState; holder: SeatHolder }): Holding {
  if (holder.kind === "member") return state.members[holder.userId] ?? UNSEEN;
  return expiringOf({ state, kind: holder.kind })[seatHolderId(holder)] ?? UNSEEN;
}

function inferredExpiry({ state, holder }: { state: SeatPeakState; holder: SeatHolder }): boolean {
  if (holder.kind === "member") return false;
  return expiringOf({ state, kind: holder.kind })[seatHolderId(holder)]?.expiredByFold === true;
}

function heldSeat({ state, holder }: { state: SeatPeakState; holder: SeatHolder }): SeatKind {
  return holdingOf({ state, holder }).seat;
}

function withHolder({
  state,
  change,
}: {
  state: SeatPeakState;
  change: RecordSeatChangedCommandData;
}): SeatPeakState {
  const { holder, to: seat, occurredAt: lastChangedAt, changeId: lastChangeId } = change;
  const holding = { seat, lastChangedAt, lastChangeId };
  if (holder.kind === "member") {
    return { ...state, members: { ...state.members, [holder.userId]: holding } };
  }
  const entries = {
    ...expiringOf({ state, kind: holder.kind }),
    [seatHolderId(holder)]: { ...holding, expiresAt: holder.expiresAt },
  };
  return withExpiring({ state, kind: holder.kind, entries });
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
 * Sets the running counts and moves the month of `at` by the change, and every later month
 * folded already (ADR-002 §7): ends exactly, peaks only upward and only while the seat is held
 * (`heldUntil`). A month first touched opens at the count carried into it.
 */
function record({
  state,
  counts,
  at,
  heldUntil = null,
}: {
  state: SeatPeakState;
  counts: SeatCounts;
  at: number;
  heldUntil?: number | null;
}): SeatPeakState {
  // A change dated before counting opened lands at the opening moment.
  const when = Math.max(at, state.openedAt ?? at);
  const month = seatPeakMonthOf(when);
  const delta = { full: counts.full - state.counts.full, lite: counts.lite - state.counts.lite };
  const opened = state.months[month] ?? openMonth({ state, month, at: when });
  const fullAtEnd = Math.max(0, opened.fullAtEnd + delta.full);
  const liteAtEnd = Math.max(0, opened.liteAtEnd + delta.lite);
  const raisesFull = fullAtEnd > opened.fullPeak;
  const raisesLite = liteAtEnd > opened.litePeak;
  const months: SeatPeakState["months"] = {
    ...state.months,
    [month]: {
      fullPeak: raisesFull ? fullAtEnd : opened.fullPeak,
      fullPeakAt: raisesFull ? when : opened.fullPeakAt,
      litePeak: raisesLite ? liteAtEnd : opened.litePeak,
      litePeakAt: raisesLite ? when : opened.litePeakAt,
      fullAtEnd,
      liteAtEnd,
    },
  };
  for (const [later, touched] of Object.entries(state.months)) {
    if (later <= month) continue;
    const held = heldUntil === null || seatPeakMonthStart(later) < heldUntil;
    months[later] = shiftMonth({ month: touched, delta, raisesPeaks: held });
  }
  return { ...state, counts, months };
}

/** A later month moved by an earlier change: its end exactly, its peaks only upward. */
function shiftMonth({
  month,
  delta,
  raisesPeaks,
}: {
  month: SeatPeakMonth;
  delta: { full: number; lite: number };
  raisesPeaks: boolean;
}): SeatPeakMonth {
  return {
    ...month,
    fullPeak: month.fullPeak + (raisesPeaks ? Math.max(0, delta.full) : 0),
    litePeak: month.litePeak + (raisesPeaks ? Math.max(0, delta.lite) : 0),
    fullAtEnd: Math.max(0, month.fullAtEnd + delta.full),
    liteAtEnd: Math.max(0, month.liteAtEnd + delta.lite),
  };
}

/** A month first touched opens at the end of the last touched month before it. */
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
  const before = Object.keys(state.months)
    .filter((touched) => touched < month)
    .toSorted()
    .at(-1);
  const carried = before === undefined ? undefined : state.months[before];
  const full = carried?.fullAtEnd ?? state.counts.full;
  const lite = carried?.liteAtEnd ?? state.counts.lite;
  return {
    fullPeak: full,
    fullPeakAt: since,
    litePeak: lite,
    litePeakAt: since,
    fullAtEnd: full,
    liteAtEnd: lite,
  };
}

/** One month as a read shows it: touched, or carried from the month before. */
export interface SeatPeakMonthRead extends SeatPeakMonth {
  month: string;
  carried: boolean;
}

/**
 * The state as of `now`: invitations and holds expired by then give back their seats, and every
 * month from the opening to `now` is present, a month nobody touched carrying the count it began
 * with.
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
