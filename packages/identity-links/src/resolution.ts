// Read-time, per-period resolution (ADR-094 Decision 2): who owned a provider
// login at a given moment, and how a reporting period splits when ownership
// changed inside it. Pure functions over already-fetched rows — the caller
// fetched one login's timeline via IdentityLinkStorage.

/** The slice of a link row resolution needs. */
export interface LinkTimelineRow {
  seq: bigint;
  userId: string | null;
  effectiveFrom: Date;
  erasedAt: Date | null;
}

export type LoginResolution =
  /** The login belonged to this person at that moment. */
  | { kind: "person"; userId: string }
  /**
   * The timeline still resolves, but to a person who has been forgotten —
   * "former member (erased)", displayed inside the ATTRIBUTED bucket
   * (Decision 9), never dumped into "unattributed".
   */
  | { kind: "erased-person" }
  /** An admin closed the link: nobody owned the login from then on. */
  | { kind: "unlinked" }
  /** No row covers that moment — the "unattributed" bucket, fixable by linking. */
  | { kind: "none" };

/**
 * Ordering constant made executable: `effectiveFrom DESC, seq DESC`.
 * Positive when a ranks above b. `seq` is unique (database-assigned), so two
 * distinct rows never compare equal — that is the whole determinism argument.
 */
const rankAbove = (a: LinkTimelineRow, b: LinkTimelineRow): boolean => {
  const byTime = a.effectiveFrom.getTime() - b.effectiveFrom.getTime();
  if (byTime !== 0) return byTime > 0;
  return a.seq > b.seq;
};

/**
 * Who owned the login at `at`? The winner is the highest-ranked row whose
 * `effectiveFrom` is at or before `at` — "at or before" because usage AT the
 * handover boundary goes to the NEW owner (Decision 2).
 */
export const resolveOwnerAt = (
  rows: readonly LinkTimelineRow[],
  at: Date,
): LoginResolution => {
  let winner: LinkTimelineRow | undefined;
  for (const row of rows) {
    if (row.effectiveFrom.getTime() > at.getTime()) continue;
    if (!winner || rankAbove(row, winner)) winner = row;
  }
  if (!winner) return { kind: "none" };
  if (winner.userId !== null) return { kind: "person", userId: winner.userId };
  return winner.erasedAt !== null
    ? { kind: "erased-person" }
    : { kind: "unlinked" };
};

/** One half-open slice [from, to) of a period, owned by one resolution. */
export interface OwnershipSegment {
  from: Date;
  to: Date;
  resolution: LoginResolution;
}

const sameResolution = (a: LoginResolution, b: LoginResolution): boolean =>
  a.kind === b.kind &&
  (a.kind !== "person" || a.userId === (b as { userId: string }).userId);

/**
 * Split a reporting period [from, to) at every ownership change inside it —
 * a handover mid-period must never hand the whole period to either side
 * (Decision 2: "never whoever owned it at period end"). Adjacent slices that
 * resolve identically are merged, so a correction that re-asserts the same
 * owner does not split anything.
 */
export const splitPeriodByOwnership = (
  rows: readonly LinkTimelineRow[],
  from: Date,
  to: Date,
): OwnershipSegment[] => {
  const cuts = [
    from.getTime(),
    ...rows
      .map((row) => row.effectiveFrom.getTime())
      .filter((t) => t > from.getTime() && t < to.getTime()),
  ]
    .sort((a, b) => a - b)
    .filter((t, i, all) => i === 0 || t !== all[i - 1]);

  const segments: OwnershipSegment[] = [];
  for (const [i, cut] of cuts.entries()) {
    const end = i + 1 < cuts.length ? new Date(cuts[i + 1]!) : to;
    const resolution = resolveOwnerAt(rows, new Date(cut));
    const last = segments[segments.length - 1];
    if (last && sameResolution(last.resolution, resolution)) {
      last.to = end;
    } else {
      segments.push({ from: new Date(cut), to: end, resolution });
    }
  }
  return segments;
};
