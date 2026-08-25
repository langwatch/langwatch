/**
 * Shared X-axis label geometry for the experiment-results charts.
 *
 * Cost, Latency and Win-rate label their bars with the same variant names, so
 * they must trim and slant identically — otherwise one variant reads
 * "support-c…" on one chart and "support-detailed (1)" on the next.
 */

/** Rotate X-axis labels once there are at least this many bars. */
const ROTATE_LABELS_THRESHOLD = 3;

/** Max label length before truncating, for horizontal labels. */
const MAX_LABEL_LENGTH = 14;

/**
 * Max label length for rotated labels.
 *
 * A slanted label runs diagonally rather than being boxed into its own bar's
 * slot, so it affords MORE characters than a horizontal one — but only as far
 * as ROTATED_AXIS_HEIGHT_PX covers the diagonal. Raising this without raising
 * that height clips the labels; the two must be reviewed together.
 */
const MAX_LABEL_LENGTH_ROTATED = 16;

const ROTATED_LABEL_ANGLE = -35;

/**
 * Height reserved for the X axis.
 *
 * Sized to cover a rotated label's vertical extent, NOT to fit a full
 * untruncated name — sizing for the latter made the axis eat the chart. Names
 * stay elided and the full name is shown on hover.
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
 *
 * Returns "" unless dropping it leaves every name with something left. Sibling
 * variants are habitually named `support-assistant-warm`,
 * `support-assistant-blunt`, … — the part that tells them apart is the tail,
 * and it is the first thing a left-truncation throws away.
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
 * Axis labels for one row of bars: the same names, trimmed the same way, on
 * every chart in the row.
 *
 * Each chart used to derive these itself, and they disagreed in exactly the
 * way this module's header warned about. Two charts truncated and then
 * disambiguated, so four prompts sharing a prefix rendered as
 * `support-assista… (1) (2) (3) (4)`; the other three only truncated, so the
 * same four rendered as `support-assista…` four times over — indistinguishable.
 * Neither was readable, and they were not even the same kind of unreadable.
 *
 * Dropping the shared prefix fixes the cause rather than the symptom: the
 * names become `warm`, `warm-premium`, `formal`, `blunt`, which fit without
 * truncation and need no disambiguation suffixes. The full name stays on the
 * tooltip.
 */
export const buildAxisLabels = (
  names: string[],
  maxLength = MAX_LABEL_LENGTH,
): string[] => {
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
 *
 * Every results chart must go through this rather than re-deriving the
 * rotate/height/trim ternaries at its own XAxis — those decisions have to agree
 * across charts, and a fifth copy is how they stop agreeing.
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
 *
 * Charts in a row must share a height to line up, and the height has to cover
 * the tallest axis any of them reserves. Deriving it from one chart's bar count
 * silently clips the others: a row whose Cost chart has 2 bars (no rotation,
 * short axis) but whose win-rate chart has 4 (rotated, 72px axis) would hand
 * the win-rate chart a 150px box to fit a 72px axis into. Pass the max.
 */
export const chartHeightFor = (maxBarCount: number): number =>
  maxBarCount >= ROTATE_LABELS_THRESHOLD ? CHART_HEIGHT_ROTATED : CHART_HEIGHT_NORMAL;
