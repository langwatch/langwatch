/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { TreeRow } from "../TreeRow";
import type { WaterfallTreeNode } from "../types";

const span = {
  spanId: "span-1",
  parentSpanId: null,
  name: "web_search",
  type: "tool",
  // The pill under the name, which goes with the row when it is removed.
  toolName: "search_the_web",
  startTimeMs: 0,
  endTimeMs: 10,
  durationMs: 10,
  status: "ok",
} as unknown as SpanTreeNode;

const node: WaterfallTreeNode = {
  span,
  children: [],
  depth: 0,
  isOrphaned: false,
};

function renderRow(over: Partial<Parameters<typeof TreeRow>[0]> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TreeRow
        node={node}
        rootStart={0}
        rootDuration={10}
        isSelected={false}
        isPrompt={false}
        logCount={0}
        isCollapsed={false}
        hasChildren={false}
        hiddenDescendantCount={0}
        isDimmed={false}
        signals={[]}
        onToggleCollapse={vi.fn()}
        onSelect={vi.fn()}
        {...over}
      />
    </ChakraProvider>,
  );
}

describe("TreeRow with a correction", () => {
  afterEach(cleanup);

  describe("given a span a correction removes", () => {
    describe("when the reader is on the corrected trace", () => {
      /** @scenario "A deleted span is listed and struck through in the corrected trace" */
      it("lists the span and marks it as deleted", () => {
        const { getByText } = renderRow({ isDeletedByCorrection: true });

        expect(getByText("web_search")).toBeInTheDocument();
        expect(getByText("Deleted")).toBeInTheDocument();
      });

      /** @scenario "A deleted span is listed and struck through in the corrected trace" */
      it("strikes through its name and the tool it ran", () => {
        const { getByText } = renderRow({ isDeletedByCorrection: true });

        expect(getByText("web_search")).toHaveStyle({
          textDecoration: "line-through",
        });
        expect(getByText("search_the_web")).toHaveStyle({
          textDecoration: "line-through",
        });
      });

      /** @scenario "A deleted span is not also coloured as changed" */
      it("does not also read as edited", () => {
        const { queryByText } = renderRow({
          isDeletedByCorrection: true,
          isCorrected: true,
        });

        expect(queryByText("Edited")).not.toBeInTheDocument();
      });
    });

    describe("when the reader is on the captured trace", () => {
      /** @scenario "A deleted span reads plainly in the captured trace" */
      it("reads like any other row, with nothing said about the removal", () => {
        const { getByText, queryByText } = renderRow();

        expect(queryByText("Deleted")).not.toBeInTheDocument();
        expect(getByText("web_search")).not.toHaveStyle({
          textDecoration: "line-through",
        });
      });
    });
  });

  describe("given the trace is being corrected", () => {
    describe("when the row is rendered", () => {
      /** @scenario "Deleting a span marks it and its descendants" */
      /** @scenario "Each row's delete action names the span it removes" */
      it("offers to delete the span, named after that span", () => {
        const onToggleDelete = vi.fn();
        const { getByLabelText } = renderRow({
          isEditing: true,
          onToggleDelete,
        });

        fireEvent.click(getByLabelText("Delete span web_search"));

        expect(onToggleDelete).toHaveBeenCalledWith("span-1");
      });
    });

    describe("when the span is already removed by the correction", () => {
      /** @scenario "Restoring a deleted span brings it back" */
      /** @scenario "Each row's delete action names the span it removes" */
      it("offers to restore it, named after that span", () => {
        const onToggleDelete = vi.fn();
        const { getByLabelText } = renderRow({
          isEditing: true,
          isDraftDeleted: true,
          onToggleDelete,
        });

        fireEvent.click(getByLabelText("Restore span web_search"));

        expect(onToggleDelete).toHaveBeenCalledWith("span-1");
      });
    });

    describe("when the reviewer has renamed the span but not saved yet", () => {
      /** @scenario "A pending rename shows in the waterfall while editing" */
      it("lists the span under the name being typed", () => {
        const { getByText, queryByText } = renderRow({
          isEditing: true,
          draftName: "search the web",
          onToggleDelete: vi.fn(),
        });

        expect(getByText("search the web")).toBeInTheDocument();
        expect(queryByText("web_search")).not.toBeInTheDocument();
      });

      /** @scenario "A pending rename shows in the waterfall while editing" */
      it("names the delete action after the pending name", () => {
        const { getByLabelText } = renderRow({
          isEditing: true,
          draftName: "search the web",
          onToggleDelete: vi.fn(),
        });

        expect(getByLabelText("Delete span search the web")).toBeInTheDocument();
      });
    });
  });

  describe("given the trace is only being read", () => {
    describe("when the row is rendered", () => {
      it("offers no delete affordance", () => {
        const { queryByLabelText } = renderRow();

        expect(queryByLabelText("Delete span web_search")).not.toBeInTheDocument();
      });
    });
  });
});
