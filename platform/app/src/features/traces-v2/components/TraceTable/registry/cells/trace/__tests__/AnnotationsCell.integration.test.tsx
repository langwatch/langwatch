/**
 * @vitest-environment jsdom
 *
 * The Annotations column. A trace's reviews live in their own store, so the
 * cell reads what the list laid over the row: a count per kind of thing a
 * reviewer leaves behind, and an honest answer while it has none.
 *
 * See specs/traces-v2/trace-list-annotations-column.feature.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("~/hooks/useScoreNamesById", () => ({
  useScoreNamesById: () => new Map([["score-abc123", "goodness"]]),
}));

import type { AnnotationByTrace } from "~/hooks/useAnnotationsByTraceIds";
import type { TraceListItem } from "../../../../../../types/trace";
import { NO_TRACE_EVENTS } from "../../../../../../types/trace";
import { AnnotationsCell } from "../AnnotationsCell";

afterEach(cleanup);

/** One review of the row's trace, carrying only what a case is about. */
function annotation(fields: Partial<AnnotationByTrace>): AnnotationByTrace {
  return {
    id: `a-${Math.random()}`,
    traceId: "t1",
    comment: null,
    isThumbsUp: null,
    expectedOutput: null,
    scoreOptions: null,
    anchorKind: null,
    anchorId: null,
    anchorPath: null,
    createdAt: new Date("2026-08-01T10:00:00Z"),
    user: { id: "u1", name: "Ada", image: null },
    ...fields,
  } as AnnotationByTrace;
}

/** A row carrying nothing the cell reads, so each case sets only its state. */
function row(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 0,
    name: "trace",
    serviceName: "svc",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    evaluations: [],
    events: NO_TRACE_EVENTS,
    ...over,
  } as unknown as TraceListItem;
}

/**
 * Renders the cell the way the table does, through the registry entry rather
 * than the component, so a change to what the column registers is caught here.
 */
function renderCell(item: TraceListItem) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {AnnotationsCell.render({ row: item } as never)}
    </ChakraProvider>,
  );
}

const countOn = (testId: string) =>
  screen.getByTestId(testId).textContent?.trim();

describe("AnnotationsCell", () => {
  describe("given a trace two reviewers commented on", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A trace someone commented on shows a comment count" */
      it("counts the comments", () => {
        renderCell(
          row({
            annotations: [
              annotation({ comment: "too terse" }),
              annotation({ comment: "reads well" }),
            ],
          }),
        );

        expect(countOn("annotation-comments-chip")).toBe("2");
      });
    });
  });

  describe("given a trace with a better output suggested", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A trace with a better output suggested shows a suggestion count" */
      it("counts the suggestion apart from the comments", () => {
        renderCell(
          row({
            annotations: [
              annotation({
                comment: "too terse",
                expectedOutput: "A fuller answer.",
              }),
            ],
          }),
        );

        expect(countOn("annotation-suggestions-chip")).toBe("1");
        expect(countOn("annotation-comments-chip")).toBe("1");
      });
    });
  });

  describe("given a trace one reviewer scored twice", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A scored trace counts the scores given, not the reviews that gave them" */
      it("counts the scores rather than the reviewer who gave them", () => {
        renderCell(
          row({
            annotations: [
              annotation({
                scoreOptions: {
                  "score-abc123": { value: "mild" },
                  "score-def456": { value: "4" },
                },
              }),
            ],
          }),
        );

        expect(countOn("annotation-scores-chip")).toBe("2");
      });
    });
  });

  describe("given a comment left on one span of the trace", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A comment left on one part of a trace still counts on its row" */
      it("counts it on the row, as something said about that trace", () => {
        renderCell(
          row({
            annotations: [
              annotation({
                comment: "the model answered before the tool returned",
                anchorKind: "span",
                anchorId: "0af31b2c9d4e5f60",
              }),
            ],
          }),
        );

        expect(countOn("annotation-comments-chip")).toBe("1");
      });
    });
  });

  describe("given a reviewer who only rated the trace", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A reviewer who left only a rating still shows the rating" */
      it("shows the rating rather than the empty marker", () => {
        renderCell(
          row({
            annotations: [
              annotation({ isThumbsUp: true }),
              annotation({ isThumbsUp: true }),
              annotation({ isThumbsUp: false }),
            ],
          }),
        );

        expect(countOn("annotation-thumbs-up-chip")).toBe("2");
        expect(countOn("annotation-thumbs-down-chip")).toBe("1");
        expect(screen.queryByText("—")).not.toBeInTheDocument();
      });
    });
  });

  describe("given a trace nobody has annotated", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A trace nobody has annotated shows the empty marker" */
      it("shows the empty marker", () => {
        renderCell(row({ annotations: [] }));

        expect(screen.getByText("—")).toBeInTheDocument();
      });
    });
  });

  describe("given the page's annotations are still loading", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "The list still renders while annotations are in flight" */
      it("holds the space rather than claiming nobody reviewed the trace", () => {
        const { container } = renderCell(
          row({ annotations: [], annotationsLoading: true }),
        );

        expect(screen.queryByText("—")).not.toBeInTheDocument();
        expect(container.firstChild).toBeTruthy();
      });
    });
  });

  describe("given the page's annotations could not be read", () => {
    describe("when the Annotations cell renders", () => {
      /** @scenario "A failed annotations read says so rather than reading as empty" */
      it("says the annotations are unavailable instead of showing the empty marker", () => {
        renderCell(row({ annotations: [], annotationsUnavailable: true }));

        expect(screen.queryByText("—")).not.toBeInTheDocument();
        expect(screen.getByText("Unavailable")).toBeInTheDocument();
      });
    });
  });
});
