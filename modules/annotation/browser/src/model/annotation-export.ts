/**
 * The list and all-annotations exports are pure CSV-ready data. The former
 * has one row per queue item; the latter has one row per annotation.
 */

import type { AnnotationWithUser } from "@langwatch/annotation-contract";
import { nowInstant, toDate, toZonedDateTime, type TimeInput } from "@langwatch/time";
import {
  annotationRatingExportLabel,
  annotationScores,
  suggestionExportLine,
  type AnnotationRow,
  type AnnotationTrace,
} from "./annotation-row.ts";

/** A header row and the rows under it. */
export type AnnotationExport = {
  fields: string[];
  rows: string[][];
};

/** A score type the project still collects, and therefore still exports. */
export type ActiveScoreType = { id: string; name: string };

/** `<name> - YYYY-MM-DD.csv`, the file name every export here uses. */
export function csvFileName(
  name: string,
  today: TimeInput = nowInstant().epochMilliseconds,
): string {
  return `${name} - ${toZonedDateTime(today).toPlainDate().toString()}.csv`;
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

/** The rows on screen; `dateColumnLabel` names the first column as the list does. */
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
      row.date ? row.date.toString() : "",
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

/** Every annotation the All Annotations page holds, not only the page on screen. */
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
      const createdAt = annotation.createdAt ? toDate(toZonedDateTime(annotation.createdAt)) : null;

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
