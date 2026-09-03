/**
 * What an annotation export says, as data.
 *
 * The two exports the family offers built their header row and their data rows
 * inside a component callback, which is why neither had a test that did not
 * first render a table. They are pure here: a header row and a matrix of
 * strings, which is exactly what a CSV is.
 *
 * THE TWO ARE DELIBERATELY NOT THE SAME EXPORT. The queue lists export ONE ROW
 * PER QUEUE ITEM with a column per active score type, because that is what the
 * list on screen shows. All Annotations exports ONE ROW PER ANNOTATION, scores
 * as one JSON cell, because that page's rows are traces and its subject is the
 * comments underneath them — a reviewer who marked six spans of one trace said
 * six things, and a per-trace row would report one.
 */

import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import {
  annotationRatingExportLabel,
  annotationScores,
  suggestionExportLine,
  type AnnotationRow,
  type AnnotationTrace,
} from "./annotation-row";

/** A header row and the rows under it. */
export type AnnotationExport = {
  fields: string[];
  rows: string[][];
};

/** A score type the project still collects, and therefore still exports. */
export type ActiveScoreType = { id: string; name: string };

/** `<name> - YYYY-MM-DD.csv`, the file name every export here uses. */
export function csvFileName(name: string, today = new Date()): string {
  return `${name} - ${today.toISOString().split("T")[0]}.csv`;
}

/** Every distinct annotator on a row, in the order they first appear. */
function annotatorNames(annotations: AnnotationWithUser[]): string {
  return Array.from(
    new Set(
      annotations
        .map((annotation) => annotation.user?.name)
        .filter((name): name is string => !!name),
    ),
  ).join(", ");
}

/** What one row answered for one score type, reason included. */
function scoreCell({ row, scoreTypeId }: { row: AnnotationRow; scoreTypeId: string }): string {
  return row.annotations
    .flatMap((annotation) => {
      const score = annotationScores({ annotation }).find((answer) => answer.name === scoreTypeId);
      if (!score) return [];
      const value = score.values.join(", ");
      return [score.reason ? `${value} (${score.reason})` : value];
    })
    .join("\n");
}

/**
 * The rows on screen, as the reviewer sees them.
 *
 * `dateColumnLabel` is the list's own — "Date queued" on a queue, "Date
 * annotated" on All Annotations — so the export's first column is named the
 * same thing the column it came from is.
 */
export function annotationListExport({
  rows,
  activeScoreTypes,
  dateColumnLabel,
}: {
  rows: readonly AnnotationRow[];
  activeScoreTypes: readonly ActiveScoreType[];
  dateColumnLabel: string;
}): AnnotationExport {
  return {
    fields: [
      dateColumnLabel,
      "Status",
      "Queued by",
      "Trace ID",
      "Input",
      "Output",
      "Comments",
      "Suggestions",
      ...activeScoreTypes.map((scoreType) => scoreType.name),
      "Annotators",
    ],
    rows: rows.map((row) => [
      row.date ? row.date.toISOString() : "",
      row.doneAt ? "Completed" : "Pending",
      row.createdByUser?.name ?? "",
      row.traceId,
      row.trace?.input?.value ?? "",
      row.trace?.output?.value ?? "",
      row.annotations
        .map((annotation) => annotation.comment)
        .filter(Boolean)
        .join("\n"),
      row.annotations
        .map((annotation) => suggestionExportLine({ annotation, traceId: row.traceId }))
        .filter(Boolean)
        .join("\n"),
      ...activeScoreTypes.map((scoreType) => scoreCell({ row, scoreTypeId: scoreType.id })),
      annotatorNames(row.annotations),
    ]),
  };
}

/**
 * Every annotation the All Annotations page holds, not the page on screen.
 *
 * The list pages through what it loaded; the export carries all of it, which is
 * the property the page's own test names.
 */
export function allAnnotationsExport({
  annotations,
  traces,
}: {
  annotations: readonly AnnotationWithUser[];
  traces: readonly AnnotationTrace[];
}): AnnotationExport {
  const traceById = new Map(traces.map((trace) => [trace.trace_id, trace]));
  return {
    fields: [
      "User",
      "Input",
      "Output",
      "Suggestions",
      "Comment",
      "Trace ID",
      "Rating",
      "Scoring",
      "Created at",
    ],
    rows: annotations.map((annotation) => {
      const trace = traceById.get(annotation.traceId);
      const createdAt =
        annotation.createdAt instanceof Date
          ? annotation.createdAt
          : annotation.createdAt
            ? new Date(annotation.createdAt)
            : null;
      return [
        annotation.user?.name ?? "",
        trace?.input?.value ?? "",
        trace?.output?.value ?? "",
        suggestionExportLine({ annotation, traceId: annotation.traceId }),
        annotation.comment ?? "",
        annotation.traceId ?? "",
        annotationRatingExportLabel(annotation.isThumbsUp),
        JSON.stringify(annotation.scoreOptions ?? {}),
        createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt.toLocaleString() : "",
      ];
    }),
  };
}
