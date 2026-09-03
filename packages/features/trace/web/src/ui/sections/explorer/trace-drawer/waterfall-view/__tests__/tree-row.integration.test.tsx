/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "@langwatch/trace-contract";
import { TreeRow } from "../tree-row";
import type { WaterfallTreeNode } from "../types";

afterEach(cleanup);

function span(over: Partial<SpanTreeNode> = {}): SpanTreeNode {
  return {
    spanId: "span-1",
    parentSpanId: null,
    name: "claude_code.tool",
    type: "tool",
    startTimeMs: 0,
    endTimeMs: 100,
    durationMs: 100,
    status: "ok",
    model: null,
    ...over,
  };
}

function node(over: Partial<SpanTreeNode> = {}): WaterfallTreeNode {
  return { span: span(over), children: [], depth: 0, isOrphaned: false };
}

const baseProps = {
  rootStart: 0,
  rootDuration: 1000,
  isSelected: false,
  isPrompt: false,
  isCollapsed: false,
  hasChildren: false,
  hiddenDescendantCount: 0,
  isDimmed: false,
  signals: [],
  onToggleCollapse: vi.fn(),
  onSelect: vi.fn(),
};

function renderRow(logCount: number) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TreeRow node={node()} logCount={logCount} {...baseProps} />
    </ChakraProvider>,
  );
}

function renderNamed(spanName: string, over: Partial<Parameters<typeof TreeRow>[0]> = {}) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TreeRow node={node({ name: spanName })} logCount={0} {...baseProps} {...over} />
    </ChakraProvider>,
  );
}

describe("TreeRow", () => {
  describe("given a span with correlated log records", () => {
    it("shows a logs indicator", () => {
      renderRow(3);
      expect(screen.getByLabelText("Has 3 log records")).toBeInTheDocument();
    });
  });

  describe("given a span with a single log record", () => {
    it("uses the singular form", () => {
      renderRow(1);
      expect(screen.getByLabelText("Has 1 log record")).toBeInTheDocument();
    });
  });

  describe("given a span with no logs", () => {
    it("shows no indicator", () => {
      renderRow(0);
      expect(screen.queryByLabelText(/Has \d+ log/)).not.toBeInTheDocument();
    });
  });

  describe("given a span name the row is too narrow to spell out", () => {
    /** @scenario "A span name too long for its row can still be read in full" */
    it("carries the whole name on the name itself", () => {
      renderNamed("order-lookup-verified");

      // The markers beside it can squeeze the name down to a few characters,
      // and a reader left with "order-look…" has lost which span they are on.
      expect(screen.getByText("order-lookup-verified")).toHaveAttribute(
        "title",
        "order-lookup-verified",
      );
    });
  });

  describe("given a span the reviewer has renamed but not saved", () => {
    it("carries the pending name rather than the captured one", () => {
      renderNamed("order-lookup", {
        isEditing: true,
        draftName: "order-lookup-verified",
        onToggleDelete: vi.fn(),
      });

      expect(screen.getByText("order-lookup-verified")).toHaveAttribute(
        "title",
        "order-lookup-verified",
      );
    });
  });
});
