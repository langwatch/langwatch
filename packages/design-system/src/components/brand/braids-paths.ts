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
 * The illustrations' 760-wide canvas: three projects, listed by name, braid together and land in
 * one trace in the order they were called. Every crossing is the mark's curve, the outer strand
 * passing over the middle one; each strand ends on its project's first span row. By project 1 to 3.
 */
export const BRAIDS_ART_STRANDS = [
  "M200 188C238 188 238 144 276 144H316C336 144 336 128 356 128C376 128 376 112 396 112H436C472 112 472 100 508 100",
  "M200 68C238 68 238 112 276 112C296 112 296 128 316 128C336 128 336 144 356 144H396C416 144 416 128 436 128H508",
  "M200 128H276C296 128 296 112 316 112H356C376 112 376 128 396 128C416 128 416 144 436 144C472 144 472 184 508 184",
] as const;

/** Each project's row on the left, where its strand starts, by project 1 to 3. */
export const BRAIDS_ART_PROJECT_ROWS = [188, 68, 128] as const;

/** Where each strand meets the trace's edge, by project 1 to 3. */
export const BRAIDS_ART_STRAND_ENDS = [100, 128, 184] as const;

/** The braid's four crossings: the over strand's stretch, which cuts a gap in the under strand. */
export const BRAIDS_ART_CROSSINGS = [
  { over: 2, under: 3, d: "M276 112C296 112 296 128 316 128" },
  { over: 1, under: 2, d: "M316 144C336 144 336 128 356 128" },
  { over: 3, under: 1, d: "M356 112C376 112 376 128 396 128" },
  { over: 2, under: 3, d: "M396 144C416 144 416 128 436 128" },
] as const;

/** The trace's span bars, one a row: x, the row's centre, width and owning project (1 to 3). */
export const BRAIDS_ART_SPANS = [
  { x: 524, y: 100, width: 188, project: 1 },
  { x: 540, y: 128, width: 128, project: 2 },
  { x: 556, y: 156, width: 76, project: 2 },
  { x: 596, y: 184, width: 96, project: 3 },
  { x: 660, y: 212, width: 52, project: 1 },
] as const;

export const BRAIDS_ART_DIVIDER_PATH = "M509 78.5H727";
export const BRAIDS_ART_LOCK_SHACKLE_PATH = "M318 226V223.5A3 3 0 0 1 324 223.5V226";
