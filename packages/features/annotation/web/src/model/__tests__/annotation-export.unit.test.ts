/**
 * What an annotation export says.
 *
 * Both exports were closures inside a component, so neither had a test that did
 * not first render a table. These assert on the header row and the cells, which
 * is what a reviewer opens the file to read.
 *
 * Spec: packages/features/annotation/specs/annotations-list-selection.feature.
 */

import { describe, expect, it } from "vitest";
import { allAnnotationsExport, annotationListExport, csvFileName } from "../annotation-export";
import type { AnnotationRow, AnnotationWithUser } from "../annotation-row";

const annotation = (overrides: Partial<AnnotationWithUser> = {}): AnnotationWithUser => ({
  id: "annotation-1",
  projectId: "project-1",
  traceId: "trace-1",
  userId: "user-1",
  comment: null,
  isThumbsUp: null,
  scoreOptions: null,
  expectedOutput: null,
  anchorKind: null,
  anchorId: null,
  anchorPath: null,
  createdAt: new Date("2026-08-02T10:00:00Z"),
  updatedAt: new Date("2026-08-02T10:00:00Z"),
  user: { id: "user-1", name: "Ana", image: null },
  ...overrides,
});

const row = (overrides: Partial<AnnotationRow> = {}): AnnotationRow => ({
  id: "item-1",
  queueItemId: "item-1",
  traceId: "trace-1",
  date: new Date("2026-08-01T10:00:00Z"),
  doneAt: null,
  createdByUser: { id: "queuer", name: "Bo", image: null },
  trace: {
    trace_id: "trace-1",
    input: { value: "the question" },
    output: { value: "the answer" },
  },
  annotations: [],
  ...overrides,
});

describe("given the rows a queue list shows", () => {
  describe("when the reviewer exports them", () => {
    it("names one column per active score type, between the suggestions and the annotators", () => {
      const { fields } = annotationListExport({
        rows: [row()],
        activeScoreTypes: [
          { id: "score-1", name: "Helpfulness" },
          { id: "score-2", name: "Tone" },
        ],
        dateColumnLabel: "Date queued",
      });

      expect(fields).toEqual([
        "Date queued",
        "Status",
        "Queued by",
        "Trace ID",
        "Input",
        "Output",
        "Comments",
        "Suggestions",
        "Helpfulness",
        "Tone",
        "Annotators",
      ]);
    });

    it("carries the score value with the reason the reviewer gave", () => {
      const { fields, rows } = annotationListExport({
        rows: [
          row({
            annotations: [
              annotation({
                scoreOptions: { "score-1": { value: "good", reason: "on point" } },
              }),
            ],
          }),
        ],
        activeScoreTypes: [{ id: "score-1", name: "Helpfulness" }],
        dateColumnLabel: "Date queued",
      });

      expect(rows[0]![fields.indexOf("Helpfulness")]).toBe("good (on point)");
    });

    it("says whether the item is still waiting", () => {
      const { fields, rows } = annotationListExport({
        rows: [row(), row({ id: "item-2", doneAt: new Date("2026-08-03T10:00:00Z") })],
        activeScoreTypes: [],
        dateColumnLabel: "Date queued",
      });

      const status = fields.indexOf("Status");
      expect(rows[0]![status]).toBe("Pending");
      expect(rows[1]![status]).toBe("Completed");
    });

    it("names each annotator once however many things they said", () => {
      const { fields, rows } = annotationListExport({
        rows: [
          row({
            annotations: [
              annotation({ id: "a1", comment: "one" }),
              annotation({ id: "a2", comment: "two" }),
              annotation({
                id: "a3",
                comment: "three",
                user: { id: "user-2", name: "Bo", image: null },
              }),
            ],
          }),
        ],
        activeScoreTypes: [],
        dateColumnLabel: "Date queued",
      });

      expect(rows[0]![fields.indexOf("Annotators")]).toBe("Ana, Bo");
      expect(rows[0]![fields.indexOf("Comments")]).toBe("one\ntwo\nthree");
    });

    it("puts each suggestion under the part of the trace it was left on", () => {
      const { fields, rows } = annotationListExport({
        rows: [
          row({
            annotations: [
              annotation({ id: "a1", expectedOutput: "a better answer" }),
              annotation({
                id: "a2",
                expectedOutput: "thirty days",
                anchorKind: "field",
                anchorId: "span-abc123",
                anchorPath: "output",
              }),
            ],
          }),
        ],
        activeScoreTypes: [],
        dateColumnLabel: "Date queued",
      });

      expect(rows[0]![fields.indexOf("Suggestions")]).toBe(
        "a better answer\nSpan span-abc123 · Output: thirty days",
      );
    });
  });
});

describe("given every annotation the All Annotations page holds", () => {
  describe("when the reviewer exports them", () => {
    /**
     * ONE ROW PER ANNOTATION, not per trace. The page groups by trace on screen
     * because that is how a reviewer reads it; the export is of what was said.
     */
    it("writes a row for every annotation, even where two share a trace", () => {
      const { rows } = allAnnotationsExport({
        annotations: [
          annotation({ id: "a1", comment: "one" }),
          annotation({ id: "a2", comment: "two" }),
          annotation({ id: "a3", traceId: "trace-2", comment: "three" }),
        ],
        traces: [],
      });

      expect(rows).toHaveLength(3);
    });

    it("carries the trace's input and output beside the comment", () => {
      const { fields, rows } = allAnnotationsExport({
        annotations: [annotation({ comment: "reads well" })],
        traces: [
          {
            trace_id: "trace-1",
            input: { value: "the question" },
            output: { value: "the answer" },
          },
        ],
      });

      expect(rows[0]![fields.indexOf("Input")]).toBe("the question");
      expect(rows[0]![fields.indexOf("Output")]).toBe("the answer");
      expect(rows[0]![fields.indexOf("Comment")]).toBe("reads well");
    });

    it("says thumbs up or down in words rather than as a boolean", () => {
      const { fields, rows } = allAnnotationsExport({
        annotations: [
          annotation({ id: "a1", isThumbsUp: true }),
          annotation({ id: "a2", isThumbsUp: false }),
          annotation({ id: "a3", isThumbsUp: null }),
        ],
        traces: [],
      });

      const rating = fields.indexOf("Rating");
      expect(rows[0]![rating]).toBe("Thumbs Up");
      expect(rows[1]![rating]).toBe("Thumbs Down");
      expect(rows[2]![rating]).toBe("");
    });

    it("leaves a trace that no longer resolves with empty content rather than dropping the row", () => {
      const { fields, rows } = allAnnotationsExport({
        annotations: [annotation({ comment: "still worth reading" })],
        traces: [],
      });

      expect(rows).toHaveLength(1);
      expect(rows[0]![fields.indexOf("Input")]).toBe("");
      expect(rows[0]![fields.indexOf("Comment")]).toBe("still worth reading");
    });
  });
});

describe("given a file is being named", () => {
  describe("when the export is taken", () => {
    it("dates it, so two exports of the same list do not overwrite each other silently", () => {
      expect(csvFileName("Annotations", new Date("2026-08-08T12:00:00Z"))).toBe(
        "Annotations - 2026-08-08.csv",
      );
    });
  });
});
