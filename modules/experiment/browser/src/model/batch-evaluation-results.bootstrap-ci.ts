/**
 * Percentile CI for mean cost or duration. Per-row cost is right-skewed and bounded at
 * zero, so a normal interval is misleading at these sample sizes.
 */

/**
 * Mulberry32 PRNG. Deterministic, no dependencies, good enough for bootstrap
 * resampling. Same seed → identical sequence across platforms.
 */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return function () {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Resamples per interval. Matches the score bootstrap for the same reason. */
const DEFAULT_SAMPLES = 1000;

/**
 * One Hoare partition of `values[left..right]` around `pivot`. Returns where the
 * two scans stopped: everything before `i` is no larger, everything after `j` no smaller.
 */
function partitionAround({
  values,
  left,
  right,
  pivot,
}: {
  values: Float64Array;
  left: number;
  right: number;
  pivot: number;
}): [number, number] {
  let i = left;
  let j = right;
  do {
    while (values[i]! < pivot) i++;
    while (pivot < values[j]!) j--;
    if (i <= j) {
      const swap = values[i]!;
      values[i] = values[j]!;
      values[j] = swap;
      i++;
      j--;
    }
  } while (i <= j);
  return [i, j];
}

/**
 * The k-th smallest (0-based) of `values[0..length)`. Reorders the slice in
 * place so nothing after position k is smaller (Wirth's selection).
 */
function selectInPlace(values: Float64Array, length: number, k: number): number {
  let left = 0;
  let right = length - 1;
  while (left < right) {
    const [i, j] = partitionAround({ values, left, right, pivot: values[k]! });
    if (j < k) left = i;
    if (k < i) right = j;
  }
  return values[k]!;
}

/**
 * `quantile` from the experiment contract (linear interpolation between the two
 * nearest order statistics), found by selection rather than a full sort. Same
 * answer to the last bit; a fraction of the work for a thousand replicates.
 */
function quantileInPlace(values: Float64Array, length: number, q: number): number {
  if (length === 1) return values[0]!;
  const pos = q * (length - 1);
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  const atLo = selectInPlace(values, length, lo);
  if (lo === hi) return atLo;
  // After the selection nothing past `lo` is smaller, so the next order
  // statistic is the smallest of what is left.
  let atHi = values[hi]!;
  for (let i = hi + 1; i < length; i++) {
    if (values[i]! < atHi) atHi = values[i]!;
  }
  const frac = pos - lo;
  return atLo * (1 - frac) + atHi * frac;
}

/**
 * The central 95% of the first `length` replicates, or null when there are
 * none. Reorders them in place, so pass a buffer whose order no longer matters.
 */
export function percentileInterval95(
  values: Float64Array,
  length: number = values.length,
): [number, number] | null {
  if (length === 0) return null;
  return [quantileInPlace(values, length, 0.025), quantileInPlace(values, length, 0.975)];
}

/**
 * One mulberry32 stream turned into resample indices in [0, size). Written
 * out rather than calling `mulberry32` because a bootstrap draws samples × rows
 * of these and the call per draw was most of its cost. Same sequence.
 */
function drawIndices({
  state,
  size,
  into,
}: {
  state: Uint32Array;
  size: number;
  into: Int32Array;
}): void {
  let a = state[0]!;
  for (let k = 0; k < size; k++) {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    into[k] = Math.floor((((t ^ (t >>> 14)) >>> 0) / 4294967296) * size);
  }
  state[0] = a;
}

export const bootstrapMeanCI = ({
  values,
  samples = DEFAULT_SAMPLES,
  seed = 1,
}: {
  values: number[];
  samples?: number;
  seed?: number;
}): [number, number] | null => {
  // One observation has no spread to resample: every replicate is that same
  // value, so the interval would come out zero-width and read as certainty.
  // Refusing is the honest output.
  if (values.length < 2) return null;
  const everyValueIsFinite = values.every((v) => Number.isFinite(v));
  if (!everyValueIsFinite) return null;

  const n = values.length;
  const state = Uint32Array.of(seed >>> 0);
  const picks = new Int32Array(n);
  const means = new Float64Array(samples);
  for (let b = 0; b < samples; b++) {
    drawIndices({ state, size: n, into: picks });
    let total = 0;
    for (let k = 0; k < n; k++) total += values[picks[k]!]!;
    means[b] = total / n;
  }
  return percentileInterval95(means);
};

/** Ascending rows where a column recorded nothing. */
function missingRowsOf(column: (number | null)[]): number[] {
  const missing: number[] = [];
  for (let r = 0; r < column.length; r++) {
    if (column[r] === null || column[r] === void 0) missing.push(r);
  }
  return missing;
}

/** Rows in ascending `a` that are not in ascending `b`. */
function rowsOnlyIn(a: number[], b: number[]): number[] {
  const only: number[] = [];
  let j = 0;
  for (const row of a) {
    while (j < b.length && b[j]! < row) j++;
    if (b[j] !== row) only.push(row);
  }
  return only;
}

/**
 * One resampling of a matrix's rows, kept as each column's total per replicate plus
 * how often each replicate drew the rows some column missed, so a pair can take
 * those rows back out without redrawing.
 */
type SharedDraw = {
  /** Row-major `rows × width`, zero where nothing was recorded. */
  matrix: Float64Array;
  width: number;
  rows: number;
  samples: number;
  /** Slot of each row some column missed, -1 for the rest. */
  slotOf: Int32Array;
  /** `totals[c * samples + b]`: column c's sum over replicate b's draw. */
  totals: Float64Array;
  /** `drawn[s * samples + b]`: how many times replicate b drew slot s's row. */
  drawn: Int32Array;
};

function toRowMajor(columns: (number | null)[][], rows: number): Float64Array {
  const width = columns.length;
  const matrix = new Float64Array(rows * width);
  columns.forEach((column, c) => {
    for (let r = 0; r < rows; r++) matrix[r * width + c] = column[r] ?? 0;
  });
  return matrix;
}

function slotsForMissedRows(
  missing: number[][],
  rows: number,
): { slotOf: Int32Array; slots: number } {
  const slotOf = new Int32Array(rows).fill(-1);
  let slots = 0;
  for (const row of missing.flat()) {
    if (slotOf[row] === -1) slotOf[row] = slots++;
  }
  return { slotOf, slots };
}

function drawShared({
  columns,
  missing,
  samples,
  seed,
}: {
  columns: (number | null)[][];
  missing: number[][];
  samples: number;
  seed: number;
}): SharedDraw {
  const width = columns.length;
  const rows = columns[0]?.length ?? 0;
  const matrix = toRowMajor(columns, rows);
  const { slotOf, slots } = slotsForMissedRows(missing, rows);
  const totals = new Float64Array(width * samples);
  const drawn = new Int32Array(slots * samples);
  const state = Uint32Array.of(seed >>> 0);
  const picks = new Int32Array(rows);
  const sum = new Float64Array(width);
  for (let b = 0; b < samples; b++) {
    drawIndices({ state, size: rows, into: picks });
    sum.fill(0);
    for (let k = 0; k < rows; k++) {
      const offset = picks[k]! * width;
      for (let c = 0; c < width; c++) sum[c] = sum[c]! + matrix[offset + c]!;
      const slot = slotOf[picks[k]!]!;
      if (slot !== -1) drawn[slot * samples + b] = drawn[slot * samples + b]! + 1;
    }
    for (let c = 0; c < width; c++) totals[c * samples + b] = sum[c]!;
  }
  return { matrix, width, rows, samples, slotOf, totals, drawn };
}

/** A column's sum over replicate b, less its values on `excluded` rows. */
function columnSumWithout({
  draw,
  column,
  b,
  excluded,
}: {
  draw: SharedDraw;
  column: number;
  b: number;
  excluded: number[];
}): number {
  let sum = draw.totals[column * draw.samples + b]!;
  for (const row of excluded) {
    const timesDrawn = draw.drawn[draw.slotOf[row]! * draw.samples + b]!;
    sum -= timesDrawn * draw.matrix[row * draw.width + column]!;
  }
  return sum;
}

/** Rows replicate b drew, less those that landed on `excluded` rows. */
function drawsWithout(draw: SharedDraw, b: number, excluded: number[]): number {
  let used = draw.rows;
  for (const row of excluded) used -= draw.drawn[draw.slotOf[row]! * draw.samples + b]!;
  return used;
}

function pairIntervalFromDraw({
  draw,
  missing,
  left,
  right,
  gaps,
}: {
  draw: SharedDraw;
  missing: number[][];
  left: number;
  right: number;
  gaps: Float64Array;
}): [number, number] | null {
  // Rows only the right side missed hold a left value the pair cannot use, and the
  // reverse; rows either side missed come off the pair's count.
  const leftUnpaired = rowsOnlyIn(missing[right]!, missing[left]!);
  const rightUnpaired = rowsOnlyIn(missing[left]!, missing[right]!);
  const unusable = [...missing[left]!, ...leftUnpaired];

  let count = 0;
  for (let b = 0; b < draw.samples; b++) {
    const used = drawsWithout(draw, b, unusable);
    // A draw that missed every row this pair shares says nothing about it.
    if (used === 0) continue;
    const leftSum = columnSumWithout({ draw, column: left, b, excluded: leftUnpaired });
    const rightSum = columnSumWithout({ draw, column: right, b, excluded: rightUnpaired });
    const gap = (leftSum - rightSum) / used;
    if (!Number.isFinite(gap)) return null;
    gaps[count++] = gap;
  }
  return percentileInterval95(gaps, count);
}

/**
 * 95% interval of column `pair[0]` minus `pair[1]` for each pair (null cells: nothing
 * recorded; null interval: a non-finite replicate), all from ONE resampling of the rows.
 * Why that agrees with resampling each pair on its own: experiment ADR-002.
 */
export function bootstrapPairedDifferenceCIs({
  columns,
  pairs,
  samples = DEFAULT_SAMPLES,
  seed = 1,
}: {
  columns: (number | null)[][];
  pairs: [number, number][];
  samples?: number;
  seed?: number;
}): ([number, number] | null)[] {
  if ((columns[0]?.length ?? 0) < 2 || pairs.length === 0) return pairs.map(() => null);

  const missing = columns.map(missingRowsOf);
  const draw = drawShared({ columns, missing, samples, seed });
  const gaps = new Float64Array(samples);
  return pairs.map(([left, right]) => pairIntervalFromDraw({ draw, missing, left, right, gaps }));
}
