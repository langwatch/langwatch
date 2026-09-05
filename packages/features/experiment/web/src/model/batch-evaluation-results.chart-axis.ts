/**
 * Shared X-axis label geometry for the experiment-results charts.
 */

/** Rotate X-axis labels once there are at least this many bars. */
const ROTATE_LABELS_THRESHOLD = 3;

/** Max label length before truncating, for horizontal labels. */
const MAX_LABEL_LENGTH = 14;

/**
 * Max label length for rotated labels.
 */
const MAX_LABEL_LENGTH_ROTATED = 16;

const ROTATED_LABEL_ANGLE = -35;

/**
 * Height reserved for the X axis.
 */
const ROTATED_AXIS_HEIGHT_PX = 72;
const NORMAL_AXIS_HEIGHT_PX = 25;

const CHART_HEIGHT_ROTATED = 200;
const CHART_HEIGHT_NORMAL = 150;

/** Truncate a label and add ellipsis if too long. */
export const truncateLabel = (label: string, maxLength = MAX_LABEL_LENGTH): string => {
  if (label.length <= maxLength) return label;
  return label.slice(0, maxLength - 1) + "…";
};

/** Characters a shared prefix may be cut at, so a word is never split. */
const BOUNDARY_CHARS = new Set(["-", "_", ".", " ", "/", ":"]);

/** The longest prefix every name shares, before any word-boundary trim. */
const longestCommonPrefix = (names: string[]): string => {
  let prefix = names[0] ?? "";
  for (const name of names.slice(1)) {
    let i = 0;
    while (i < prefix.length && i < name.length && prefix[i] === name[i]) i++;
    prefix = prefix.slice(0, i);
    if (!prefix) return "";
  }
  return prefix;
};

/**
 * Length of `prefix` cut back to just after its last separator, or 0 when it
 * has none. Cutting there stops `…-warm` / `…-warm-premium` becoming
 * `` / `-premium`, which is what a raw longest-common-prefix would do.
 */
const boundaryCutLength = (prefix: string): number => {
  for (let i = prefix.length - 1; i >= 0; i--) {
    if (BOUNDARY_CHARS.has(prefix[i]!)) return i + 1;
  }
  return 0;
};

/**
 * The prefix every one of these names shares, cut back to a word boundary.
 */
export const commonLabelPrefix = (names: string[]): string => {
  if (names.length < 2) return "";

  const prefix = longestCommonPrefix(names);
  const cut = boundaryCutLength(prefix);
  if (cut <= 0) return "";

  const candidate = prefix.slice(0, cut);
  // Every name must keep a non-empty remainder, or the labels stop naming
  // anything at all.
  return names.every((name) => name.slice(candidate.length).length > 0) ? candidate : "";
};

/**
 * Axis labels for one row of bars: the same names, trimmed the same way, on every chart
 * in the row.
 */
export const buildAxisLabels = (names: string[], maxLength = MAX_LABEL_LENGTH): string[] => {
  // Only worth dropping when something would otherwise be cut off. Two bars
  // both called `gpt-5-mini` share a prefix, but they already fit — stripping
  // it would turn honest labels into `…mini (1)` / `…mini (2)` and reveal
  // nothing, because the names really are the same.
  const needsTrimming = names.some((name) => name.length > maxLength);
  const prefix = needsTrimming ? commonLabelPrefix(names) : "";
  const stripped = prefix ? names.map((name) => `…${name.slice(prefix.length)}`) : names;

  const labels = stripped.map((name) => truncateLabel(name, maxLength));

  // Anything still colliding after trimming gets an index, so two bars are
  // never labelled identically. With the prefix dropped this is rare, which
  // is the point — the suffixes were carrying the whole distinction before.
  const seen = new Map<string, number>();
  const counts = new Map<string, number>();
  for (const label of labels) {
    counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return labels.map((label) => {
    if ((counts.get(label) ?? 0) < 2) return label;
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    return `${label} (${n})`;
  });
};

/**
 * The XAxis props a chart with `barCount` bars should use.
 */
export const axisLabelProps = (
  barCount: number,
): {
  angle: number;
  textAnchor: "end" | "middle";
  height: number;
  maxLabelLength: number;
} => {
  const rotate = barCount >= ROTATE_LABELS_THRESHOLD;
  return {
    angle: rotate ? ROTATED_LABEL_ANGLE : 0,
    textAnchor: rotate ? "end" : "middle",
    height: rotate ? ROTATED_AXIS_HEIGHT_PX : NORMAL_AXIS_HEIGHT_PX,
    maxLabelLength: rotate ? MAX_LABEL_LENGTH_ROTATED : MAX_LABEL_LENGTH,
  };
};

/**
 * Height for every chart in a results row, given the BUSIEST chart in it.
 */
export const chartHeightFor = (maxBarCount: number): number =>
  maxBarCount >= ROTATE_LABELS_THRESHOLD ? CHART_HEIGHT_ROTATED : CHART_HEIGHT_NORMAL;
