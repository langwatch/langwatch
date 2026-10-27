// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type RankRow } from "./sample-series.ts";

/** A ranked row with the bar it draws. */
export interface RankBar extends RankRow {
  /** Bar length as a percentage of the panel width. Never negative. */
  widthPct: number;
  isCredit: boolean;
}

/**
 * How long each ranked bar is drawn.
 *
 * Cost here is signed — a credited or refunded period arrives as a negative
 * figure — so the bars are scaled against the largest magnitude rather than
 * against the top row. Scaling against the top row divides by a negative
 * whenever a credit leads, which draws bars pointing the wrong way, and the
 * obvious guard against that collapses a panel of nothing but credits to
 * nothing at all.
 *
 * A row whose figure is WITHHELD draws no bar and does not set the scale.
 * There is no bar length that means "we do not know", and its placeholder
 * `value` is not a measurement — letting it into the scale would size every
 * other bar against a number nobody measured.
 *
 * Extracted from the panel because the width lands in a generated class name
 * that jsdom cannot resolve, which leaves the arithmetic untestable through
 * the rendered output.
 */
export function rankBarGeometry(rows: RankRow[]): RankBar[] {
  const scale = rows.reduce(
    (max, row) => (row.unpriced ? max : Math.max(max, Math.abs(row.value))),
    0,
  );
  return rows.map((row) => ({
    ...row,
    widthPct: row.unpriced || scale <= 0 ? 0 : (Math.abs(row.value) / scale) * 100,
    isCredit: !row.unpriced && row.value < 0,
  }));
}
