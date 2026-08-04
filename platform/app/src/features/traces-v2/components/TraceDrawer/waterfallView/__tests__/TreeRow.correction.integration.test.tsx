/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { TreeRow } from "../TreeRow";
import type { WaterfallTreeNode } from "../types";

const span = {
  spanId: "span-1",
  parentSpanId: null,
  name: "web_search",
  type: "tool",
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
        isPinned={false}
        isCollapsed={false}
        hasChildren={false}
        hiddenDescendantCount={0}
        isDimmed={false}
        signals={[]}
        onToggleCollapse={vi.fn()}
        onSelect={vi.fn()}
        onTogglePin={vi.fn()}
        {...over}
      />
    </ChakraProvider>,
  );
}

describe("TreeRow with a correction", () => {
  afterEach(cleanup);

  describe("given a span a correction removes", () => {
    describe("when the reader is on the captured trace", () => {
      /** @scenario "A deleted span is marked in the captured trace" */
      it("lists the span and marks it as deleted", () => {
        const { getByText } = renderRow({ isDeletedByCorrection: true });

        expect(getByText("web_search")).toBeInTheDocument();
        expect(getByText("Deleted")).toBeInTheDocument();
      });
    });

    describe("when the reader is on the corrected trace", () => {
      it("carries no marker, because the row is not there at all", () => {
        const { queryByText } = renderRow();

        expect(queryByText("Deleted")).not.toBeInTheDocument();
      });
    });
  });

  describe("given the trace is being corrected", () => {
    describe("when the row is rendered", () => {
      /** @scenario "Deleting a span marks it and its descendants" */
      it("offers to delete the span", () => {
        const onToggleDelete = vi.fn();
        const { getByLabelText } = renderRow({
          isEditing: true,
          onToggleDelete,
        });

        fireEvent.click(getByLabelText("Delete span"));

        expect(onToggleDelete).toHaveBeenCalledWith("span-1");
      });
    });

    describe("when the span is already removed by the correction", () => {
      /** @scenario "Restoring a deleted span brings it back" */
      it("offers to restore it", () => {
        const onToggleDelete = vi.fn();
        const { getByLabelText } = renderRow({
          isEditing: true,
          isDraftDeleted: true,
          onToggleDelete,
        });

        fireEvent.click(getByLabelText("Restore span"));

        expect(onToggleDelete).toHaveBeenCalledWith("span-1");
      });
    });
  });

  describe("given the trace is only being read", () => {
    describe("when the row is rendered", () => {
      it("offers no delete affordance", () => {
        const { queryByLabelText } = renderRow();

        expect(queryByLabelText("Delete span")).not.toBeInTheDocument();
      });
    });
  });
});
