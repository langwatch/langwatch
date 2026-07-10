import type { RetentionCategory } from "~/server/data-retention/retentionPolicy.schema";

/**
 * Edges a boundary event can carry (ADR-039):
 * - ENTRY:    a day-slice aged past the billable line (daily transit delta)
 * - SEED:     rollout/re-seed backfill of an already-billable slice
 * - EXIT:     the slice's retention entitlement ended (mirror of its entry)
 * - DELETION: manual erasure / project deletion measured before deleting
 * - REVERSAL: retention-change negation of a previously recorded group
 */
export const BOUNDARY_EDGES = [
  "ENTRY",
  "SEED",
  "EXIT",
  "DELETION",
  "REVERSAL",
] as const;

export type BoundaryEdge = (typeof BOUNDARY_EDGES)[number];

export interface BoundaryEventIdentity {
  projectId: string;
  category: RetentionCategory;
  partitionKey: string;
  /** UTC midnight of the day-slice. */
  sliceDate: Date;
  retentionDays: number;
  edge: BoundaryEdge;
  /**
   * The correction's origin (retention-change id, erasure-request id).
   * MANDATORY for DELETION/REVERSAL — without it, changing retention
   * 63→91→63 would collapse the second change's events into the first and
   * silently drop them. Also set on events re-emitted BY a correction (e.g.
   * the re-emitted entries of a retention change), which keeps them distinct
   * from the originals they replace.
   */
  causeId?: string;
}

// ENTRY and SEED share one class: a seed IS an entry recorded from a
// different emitter context, and sharing the class is what makes the
// seed/live cutover replay-safe (the same slice can never count twice).
// EXIT is its own class: it mirrors its entry's values exactly, and an
// edge-free key would dedup every exit away as a replay of its own entry —
// the gauge could only ever go up (ADR-039 v4.1).
const EDGE_CLASS: Record<BoundaryEdge, string> = {
  ENTRY: "IN",
  SEED: "IN",
  EXIT: "OUT",
  DELETION: "DELETION",
  REVERSAL: "REVERSAL",
};

const CORRECTION_EDGES: ReadonlySet<BoundaryEdge> = new Set([
  "DELETION",
  "REVERSAL",
]);

/**
 * Replay identity of a boundary event — the `@@unique` dedup key on
 * StorageBoundaryEvent. Re-delivering any event derives the same key and
 * upserts into the same row: the fold can never double-apply.
 */
export function buildDedupKey({
  projectId,
  category,
  partitionKey,
  sliceDate,
  retentionDays,
  edge,
  causeId,
}: BoundaryEventIdentity): string {
  if (CORRECTION_EDGES.has(edge) && !causeId) {
    throw new Error(
      `Boundary event edge ${edge} requires a causeId — corrections without ` +
        `their cause collapse into each other on replay (ADR-039 Decision 6)`,
    );
  }

  const sliceDay = sliceDate.toISOString().slice(0, 10);
  const base = [
    projectId,
    category,
    partitionKey,
    sliceDay,
    String(retentionDays),
    EDGE_CLASS[edge],
  ].join(":");

  return causeId ? `${base}:cause:${causeId}` : base;
}
