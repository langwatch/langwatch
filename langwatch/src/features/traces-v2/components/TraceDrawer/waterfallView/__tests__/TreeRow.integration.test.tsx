/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { SpanTreeNode } from "~/server/api/routers/tracesV2.schemas";
import { TreeRow } from "../TreeRow";
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
  isPinned: false,
  isCollapsed: false,
  hasChildren: false,
  hiddenDescendantCount: 0,
  isDimmed: false,
  signals: [],
  onToggleCollapse: vi.fn(),
  onSelect: vi.fn(),
  onTogglePin: vi.fn(),
};

function renderRow(logCount: number) {
  return render(
    <ChakraProvider value={defaultSystem}>
      <TreeRow node={node()} logCount={logCount} {...baseProps} />
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
});
