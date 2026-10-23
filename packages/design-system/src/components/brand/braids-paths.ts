/** Braids artwork as plain path data, translated from dev/docs/plans/braids/brand. */
import type { MarkMaster } from "./feature-brands.ts";

/** Open weave at 32px and up: three strands, the lead strand passing under the top one. */
export const BRAIDS_MARK_STANDARD: MarkMaster = {
  strokeWidth: 3.2,
  gapWidth: 6.4,
  strands: [
    { d: "M4 29H17C23 29 23 20 29 20H34", tone: "weave", under: 1 },
    { d: "M4 11H7C13 11 13 20 19 20C25 20 25 29 31 29H32", tone: "lead", under: 2 },
    { d: "M4 20H7C13 20 13 11 19 11H36", tone: "weave" },
  ],
};

/** The optical small master for 24px and below: wider spread, heavier strokes, wider gaps. */
export const BRAIDS_MARK_SMALL: MarkMaster = {
  strokeWidth: 3.8,
  gapWidth: 7,
  strands: [
    { d: "M4 32H17C23 32 23 20 29 20H34", tone: "weave", under: 1 },
    { d: "M4 8H7C13 8 13 20 19 20C25 20 25 32 31 32H32", tone: "lead", under: 2 },
    { d: "M4 20H7C13 20 13 8 19 8H36", tone: "weave" },
  ],
};

/**
 * The illustrations' 760 by 350 canvas: three project strands braided into one trace. Every
 * crossing is the same curve, the outer strand passing over the middle one as a braid does, and
 * each strand ends on the trace row of its project's span (rows 118, 186 and 254).
 */
export const BRAIDS_ART_STRANDS = [
  "M207 118H247C287 118 287 186 327 186H372C412 186 412 254 452 254H492",
  "M207 186H247C287 186 287 118 327 118H492",
  "M207 254H372C412 254 412 186 452 186H492",
] as const;

/** Where each strand ends on the trace's edge, by index into BRAIDS_ART_STRANDS. */
export const BRAIDS_ART_STRAND_ENDS = [254, 118, 186] as const;

/** Which strand each strand passes under, by index into BRAIDS_ART_STRANDS. */
export const BRAIDS_ART_UNDER: readonly (number | undefined)[] = [2, 0, undefined];

/** The trace's span bars, one a row: x, the row's centre, width and owning project (1 to 3). */
export const BRAIDS_ART_SPANS = [
  { x: 508, y: 118, width: 201, project: 2 },
  { x: 524, y: 152, width: 132, project: 2 },
  { x: 548, y: 186, width: 104, project: 3 },
  { x: 566, y: 220, width: 72, project: 3 },
  { x: 612, y: 254, width: 97, project: 1 },
] as const;

export const BRAIDS_ART_DIVIDER_PATH = "M508 97H716";
export const BRAIDS_ART_LOCK_SHACKLE_PATH = "M303 283V279A5 5 0 0 1 313 279V283";
