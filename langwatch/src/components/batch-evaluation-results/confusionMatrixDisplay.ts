/**
 * Display primitives shared by every judge-vs-reviewer agreement surface —
 * the compact card, the expanded grid, and the statistics beside it — so the
 * three read as one chart rather than three that happen to look alike.
 */

/**
 * Semantic agree/disagree coloring, not a magnitude heatmap: a controlled
 * 483-participant study (CMU, CSCW 2020) on binary confusion matrices found
 * that neutral-for-correct / flagged-for-error coloring communicates faster
 * than a sequential color scale, which — with only four cells — carries
 * almost no information anyway. Only the two error cells get a color; the
 * two agreement cells stay neutral regardless of their count.
 */
export const ERROR_CELL_BG = "red.subtle";

/** Null means the statistic is undefined, which reads as "—", never as 0%. */
export const formatPercent = (value: number | null): string =>
  value === null ? "—" : `${Math.round(value * 100)}%`;
