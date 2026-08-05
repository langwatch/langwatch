import type { Tone } from "../report.types";
import { escapeHtml } from "./html-escape";
import { toneToken } from "./report-styles";

/**
 * The report's two charts, as inline SVG fragments.
 *
 * Every number is formatted with a fixed number of decimals and never through a
 * locale-aware formatter, because the same run has to produce the same file
 * byte for byte no matter which machine rendered it.
 *
 * Each chart carries its numbers twice: once as a picture, and once as a
 * visually hidden table. The table is what a screen reader reads, and print
 * swaps the two so a printed report still carries the figures.
 *
 * @see specs/scenarios/scenario-run-report.feature
 */

/** Percentage-of-total sizes are laid out in a 0-100 user space. */
const BAR_WIDTH = 100;
const BAR_HEIGHT = 8;
const SPARK_WIDTH = 100;
const SPARK_HEIGHT = 24;
const SPARK_PADDING = 2;

export interface BarSegment {
  label: string;
  value: number;
  tone: Tone;
}

/**
 * A pass rate rendered with one decimal place.
 *
 * The input is already a percentage in 0..100, which is the unit every producer
 * uses: `passRateFrom()` — the one function the run-history screen and this
 * report share — multiplies out, and `wilsonInterval()` returns its bounds the
 * same way. This multiplied again, so a conclusive run headlined "Pass rate
 * 8000.0%". It survived because every rate under the too-few-runs gate takes
 * the counts-only path and never reaches here, and because the fixtures fed it
 * fractions — asserting the right string for the wrong reason.
 */
export function formatRate(percentage: number): string {
  return `${percentage.toFixed(1)}%`;
}

function coord(value: number): string {
  return value.toFixed(2);
}

function hiddenTable({
  columns,
  rows,
  caption,
}: {
  columns: string[];
  rows: string[][];
  caption: string;
}): string {
  const head = columns
    .map((column) => `<th scope="col">${escapeHtml(column)}</th>`)
    .join("");
  const body = rows
    .map(
      (cells) =>
        `<tr>${cells.map((cell) => `<td>${escapeHtml(cell)}</td>`).join("")}</tr>`,
    )
    .join("");
  return `<table class="visually-hidden"><caption>${escapeHtml(caption)}</caption><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
}

function barRects({
  segments,
  total,
}: {
  segments: BarSegment[];
  total: number;
}): string {
  let offset = 0;
  return segments
    .map((segment) => {
      const width = (segment.value / total) * BAR_WIDTH;
      const rect = `<rect x="${coord(offset)}" y="0" width="${coord(width)}" height="${BAR_HEIGHT}" class="fill-${toneToken(segment.tone)}"></rect>`;
      offset += width;
      return rect;
    })
    .join("");
}

/**
 * A single bar split into one slice per outcome.
 *
 * States counts rather than shares: a bar next to "3 of 4" invites a reader to
 * eyeball a percentage the report has deliberately declined to state.
 */
export function passRateBar({ segments }: { segments: BarSegment[] }): string {
  // Outcomes nobody hit are dropped from the picture and its title, and kept in
  // the table: a run with no stalls should not read "0 stalled" six times over,
  // but "was that counted?" still deserves an answer.
  const present = segments.filter((segment) => segment.value > 0);
  const total = present.reduce((sum, segment) => sum + segment.value, 0);
  const summary = present
    .map((segment) => `${segment.value} ${segment.label}`)
    .join(", ");
  const title = total > 0 ? `Outcomes: ${summary}` : "No runs to chart";
  const content =
    total > 0
      ? barRects({ segments: present, total })
      : `<rect x="0" y="0" width="${BAR_WIDTH}" height="${BAR_HEIGHT}" class="chart-empty"></rect>`;

  return [
    `<svg class="chart outcome-bar" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}" preserveAspectRatio="none" role="img">`,
    `<title>${escapeHtml(title)}</title>`,
    content,
    "</svg>",
    hiddenTable({
      caption: "Runs by outcome",
      columns: ["Outcome", "Runs"],
      rows: segments.map((segment) => [segment.label, String(segment.value)]),
    }),
  ].join("");
}

export interface SparkPoint {
  label: string;
  /** Pass rate in 0..100, the unit `passRateFrom()` produces. */
  value: number;
}

function sparkCoordinates({ points }: { points: SparkPoint[] }): string[] {
  const span = SPARK_HEIGHT - SPARK_PADDING * 2;
  const lastIndex = points.length - 1;
  return points.map((point, index) => {
    const x =
      lastIndex === 0 ? SPARK_WIDTH / 2 : (index / lastIndex) * SPARK_WIDTH;
    // Clamped against 100, not 1 — reading a percentage as a fraction pinned
    // every point above 1% to the top of the box, so a trend that had moved
    // drew as a flat line at full marks.
    const fraction = Math.min(Math.max(point.value, 0), 100) / 100;
    const y = SPARK_PADDING + (1 - fraction) * span;
    return `${coord(x)},${coord(y)}`;
  });
}

/**
 * Pass rate across the runs leading up to this one, current run last.
 *
 * Returns a plain note rather than an empty picture when there is nothing to
 * plot: the first run of a suite has no trend, and a flat line at zero would
 * read as a collapse rather than as an absence.
 */
export function sparkline({ points }: { points: SparkPoint[] }): string {
  if (points.length === 0) {
    return `<p class="note tone-muted">No earlier runs to compare against.</p>`;
  }

  const coordinates = sparkCoordinates({ points });
  const current = coordinates[coordinates.length - 1] ?? "";
  const [currentX = "0", currentY = "0"] = current.split(",");
  const currentPoint = points[points.length - 1];
  const first = points[0];
  const earlier = points.length - 1;
  const title = `Pass rate across ${points.length} ${
    points.length === 1 ? "run" : "runs"
  }, ending at ${formatRate(currentPoint?.value ?? 0)}`;

  return [
    '<figure class="spark">',
    // Said in words above the line, because a line on its own is decoration:
    // it carries no scale, and a reader cannot tell what it is of.
    `<figcaption class="spark-caption">Pass rate over the last ${earlier === 1 ? "run" : `${earlier} runs`} and this one</figcaption>`,
    `<svg class="chart spark-chart" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" preserveAspectRatio="none" role="img">`,
    `<title>${escapeHtml(title)}</title>`,
    `<polyline class="spark-line" points="${coordinates.join(" ")}"></polyline>`,
    `<circle class="spark-current" cx="${currentX}" cy="${currentY}" r="1.6"></circle>`,
    "</svg>",
    // The ends of the line, so its shape has a scale attached to it. Without
    // these the same picture serves a fall from 90% and one from 30%.
    '<p class="spark-ends">',
    `<span>${escapeHtml(formatRate(first?.value ?? 0))} then</span>`,
    `<span class="spark-now">${escapeHtml(formatRate(currentPoint?.value ?? 0))} now</span>`,
    "</p>",
    "</figure>",
    hiddenTable({
      caption: "Pass rate by run",
      columns: ["Run", "Pass rate"],
      rows: points.map((point) => [point.label, formatRate(point.value)]),
    }),
  ].join("");
}
