/**
 * @vitest-environment jsdom
 *
 * What tells a reader that a correction changed a row, other than its colour.
 * The tint and the edge tick are the fast signal while scanning; the badge is
 * what carries the same fact to a reader who cannot separate the hues.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render } from "@testing-library/react";
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

describe("TreeRow", () => {
  afterEach(cleanup);

  describe("given a span the stored correction changed", () => {
    /** @scenario "A corrected span is marked in the tree" */
    it("marks the row as edited in words, not only in colour", () => {
      const { getByText } = renderRow({ isCorrected: true });

      expect(getByText("Edited")).toBeInTheDocument();
    });
  });

  describe("given a span the reviewer has renamed but not saved", () => {
    it("marks the row as edited too", () => {
      const { getByText } = renderRow({
        isEditing: true,
        draftName: "search the web",
        onToggleDelete: vi.fn(),
      });

      expect(getByText("Edited")).toBeInTheDocument();
    });
  });

  describe("given a span the correction removes", () => {
    it("says only that it was deleted, which is the whole change", () => {
      const { getByText, queryByText } = renderRow({
        isCorrected: true,
        isDeletedByCorrection: true,
      });

      expect(getByText("Deleted")).toBeInTheDocument();
      expect(queryByText("Edited")).not.toBeInTheDocument();
    });
  });

  describe("given a span no correction touched", () => {
    it("carries no marker", () => {
      const { queryByText } = renderRow();

      expect(queryByText("Edited")).not.toBeInTheDocument();
    });
  });
});
