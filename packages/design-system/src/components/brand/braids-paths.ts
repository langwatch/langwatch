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

/** The illustrations' 760 by 350 canvas: three project strands woven into one trace. */
export const BRAIDS_ART_STRANDS = [
  "M207 102H230C280 102 280 176 330 176C380 176 380 249 430 249H492",
  "M207 176H230C280 176 280 102 330 102C395 102 415 141 470 141H492",
  "M207 250H330C380 250 380 176 430 176C460 176 460 213 492 213",
] as const;

/** Which strand each strand passes under, by index into BRAIDS_ART_STRANDS. */
export const BRAIDS_ART_UNDER: readonly (number | undefined)[] = [1, undefined, 0];

/** The trace's span bars: x, y, width and the project (1 to 3) that owns the span. */
export const BRAIDS_ART_SPANS = [
  { x: 508, y: 105, width: 201, project: 1 },
  { x: 531, y: 141, width: 144, project: 2 },
  { x: 548, y: 177, width: 63, project: 2 },
  { x: 582, y: 213, width: 88, project: 3 },
  { x: 685, y: 249, width: 29, project: 1 },
] as const;

export const BRAIDS_ART_PLUS_PATH = "M603 175H621M612 166V184";
export const BRAIDS_ART_DIVIDER_PATH = "M507 95H716";
export const BRAIDS_ART_LOCK_SHACKLE_PATH = "M303 283V279A5 5 0 0 1 313 279V283";
