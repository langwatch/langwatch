// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise

import { type ReactElement } from "react";
import { Rectangle, type RectangleProps } from "recharts";

import { type DailyBucket } from "../../model/sample-series.ts";
import { PROJECTION_INK } from "./cost-chart-parts.tsx";

/**
 * A bucket that may say its bar is not the whole figure.
 *
 * `withheld` is optional so the invented series and the panels whose figures
 * are always whole need not say so; a bucket that omits it is drawn as whole.
 * The chart does not decide what "short" means — the fold that built the
 * bucket does, since only it saw the rows — it only draws what it is told.
 */
export type StackedBucket = DailyBucket & { withheld?: boolean };

/** Stroke on a bar whose period holds a figure we do not have. */
const WITHHELD_STROKE = PROJECTION_INK;
/** How much of the series colour a short bar keeps. */
const WITHHELD_FILL = 0.45;
/**
 * The dash a short bar's edge is drawn in. The cue that is not a colour: a
 * faded fill alone disappears under greyscale and under most colour-blindness,
 * and a mark that means "not the whole figure" cannot be one only some readers
 * can see.
 */
const WITHHELD_DASH = "3 2";
/**
 * The height, in pixels, of the mark drawn where a bar would be when the period
 * has NO figure at all — every day withheld, nothing to add up. Tall enough to
 * carry the dash, short enough not to read as a small amount.
 */
const WITHHELD_EMPTY_HEIGHT = 6;

/** The words a short bar's tooltip adds after the period's name. */
export const WITHHELD_TOOLTIP_NOTE = "part of this period has no dollar figure";
/** What a screen reader says on a bar that is short. */
export const WITHHELD_BAR_LABEL = "Amount withheld: part of this period has no dollar figure";
/** What a screen reader says where a bar would be, when the whole period is withheld. */
export const WITHHELD_EMPTY_BAR_LABEL = "Amount withheld: no dollar figure for this period";

/**
 * Which periods the chart must draw as short, and which of those it must draw
 * a stand-in for because there is no bar to mark.
 */
export type WithheldMarks = {
  /** Periods holding some figure we do not have: the bar is drawn short. */
  withheldDays: ReadonlySet<string>;
  /**
   * Periods holding NO figure at all: recharts draws nothing for a bar of
   * height zero, so a mark stands in for the bar. A single-provider tenant
   * with one unanswered bill used to get an empty slot here, indistinguishable
   * from a period nobody spent anything in — the exact reading a withheld
   * figure exists to prevent.
   */
  emptyDays: ReadonlySet<string>;
  /**
   * Whether this series draws the stand-in. Exactly one series per chart
   * does: every series in a stack is handed the same zero-height rectangle at
   * the same spot, and N of them drawing N marks on top of one another is one
   * mark to the eye and N to a screen reader.
   */
  drawsEmptyMark: boolean;
};

/**
 * The geometry recharts hands a bar's shape, and the row the bar was drawn
 * from. Narrower than recharts' own `BarShapeProps` so a test can build one
 * by hand for the zero-height case that jsdom cannot lay out.
 */
export type WithheldBarShapeProps = RectangleProps & {
  payload?: { day?: unknown };
};

/**
 * One bar, drawn as recharts would unless its period is short.
 *
 * A short bar keeps recharts' own rectangle — so it still answers to
 * `.recharts-rectangle` and to the click that opens a period — faded and
 * dash-edged, wrapped in a group that says why to a screen reader. A period
 * with nothing to draw gets the stand-in instead. Handed to `<Bar shape>`
 * rather than done with `<Cell>`s because a cell can only restyle a
 * rectangle recharts decided to draw, and for a height of zero it decides
 * not to; a custom shape is called for every bar, zero-height ones included.
 */
export function withheldBarShape(
  props: WithheldBarShapeProps,
  marks: WithheldMarks,
): ReactElement | null {
  const day = typeof props.payload?.day === "string" ? props.payload.day : null;
  if (day === null || !marks.withheldDays.has(day)) {
    return <Rectangle {...props} />;
  }
  if (marks.emptyDays.has(day)) {
    if (!marks.drawsEmptyMark) return null;
    const { x = 0, y = 0, width = 0 } = props;
    return (
      <g role="graphics-symbol" aria-label={WITHHELD_EMPTY_BAR_LABEL} data-withheld="empty">
        <title>{WITHHELD_EMPTY_BAR_LABEL}</title>
        <rect
          x={x}
          // Up from the baseline, where the bar would have started.
          y={y - WITHHELD_EMPTY_HEIGHT}
          width={width}
          height={WITHHELD_EMPTY_HEIGHT}
          fill="none"
          stroke={WITHHELD_STROKE}
          strokeDasharray={WITHHELD_DASH}
        />
      </g>
    );
  }
  // A series with nothing in this period, stacked on one that has: recharts
  // would draw nothing for it, and a labelled group around nothing is a
  // second "withheld" a screen reader would read out for one bar.
  if (!props.height || !props.width) return null;
  return (
    <g role="graphics-symbol" aria-label={WITHHELD_BAR_LABEL} data-withheld="short">
      <title>{WITHHELD_BAR_LABEL}</title>
      <Rectangle
        {...props}
        fillOpacity={WITHHELD_FILL}
        stroke={WITHHELD_STROKE}
        strokeDasharray={WITHHELD_DASH}
      />
    </g>
  );
}

/**
 * The days a stacked chart has to mark, kept beside the rows rather than
 * widened into them: a row is a bag of series values and a flag in it would be
 * one more key for recharts to try to draw as a series.
 *
 * `emptyDays` is the subset with nothing in it at all: no series holds a
 * figure, so there is no bar for the dash to sit on, and a mark stands in for
 * one.
 */
export function withheldDaysOf(buckets: StackedBucket[]): {
  withheldDays: Set<string>;
  emptyDays: Set<string>;
} {
  const withheld = buckets.filter((b) => b.withheld);
  return {
    withheldDays: new Set(withheld.map((b) => b.day)),
    emptyDays: new Set(
      withheld.filter((b) => b.points.every((p) => p.value === 0)).map((b) => b.day),
    ),
  };
}

/**
 * A series' bar shape, only when some period is short: a custom shape makes
 * recharts hand over zero-height bars it would otherwise skip, and a chart
 * with nothing to mark has no use for them.
 */
export function withheldShapeFor(
  marks: WithheldMarks,
): ((props: WithheldBarShapeProps) => ReactElement | null) | undefined {
  if (marks.withheldDays.size === 0) return undefined;
  return (props) => withheldBarShape(props, marks);
}

/** The widened row's day, read off a clicked bar's `payload` without a cast. */
export function dayOfBarPayload(data: unknown): unknown {
  if (typeof data !== "object" || data === null || !("payload" in data)) return undefined;
  const payload = data.payload;
  if (typeof payload !== "object" || payload === null || !("day" in payload)) return undefined;
  return payload.day;
}
