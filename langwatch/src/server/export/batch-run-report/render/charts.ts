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

/** A pass rate in 0..1 rendered as a percentage with one decimal place. */
export function formatRate(rate: number): string {
  return `${(rate * 100).toFixed(1)}%`;
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
    `<svg class="chart" viewBox="0 0 ${BAR_WIDTH} ${BAR_HEIGHT}" preserveAspectRatio="none" role="img">`,
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
  /** Pass rate in 0..1. */
  value: number;
}

function sparkCoordinates({ points }: { points: SparkPoint[] }): string[] {
  const span = SPARK_HEIGHT - SPARK_PADDING * 2;
  const lastIndex = points.length - 1;
  return points.map((point, index) => {
    const x =
      lastIndex === 0 ? SPARK_WIDTH / 2 : (index / lastIndex) * SPARK_WIDTH;
    const y =
      SPARK_PADDING + (1 - Math.min(Math.max(point.value, 0), 1)) * span;
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
  const title = `Pass rate across ${points.length} runs, ending at ${formatRate(currentPoint?.value ?? 0)}`;

  return [
    `<svg class="chart" viewBox="0 0 ${SPARK_WIDTH} ${SPARK_HEIGHT}" preserveAspectRatio="none" role="img">`,
    `<title>${escapeHtml(title)}</title>`,
    `<polyline class="spark-line" points="${coordinates.join(" ")}"></polyline>`,
    `<circle class="spark-current" cx="${currentX}" cy="${currentY}" r="1.6"></circle>`,
    "</svg>",
    hiddenTable({
      caption: "Pass rate by run",
      columns: ["Run", "Pass rate"],
      rows: points.map((point) => [point.label, formatRate(point.value)]),
    }),
  ].join("");
}
