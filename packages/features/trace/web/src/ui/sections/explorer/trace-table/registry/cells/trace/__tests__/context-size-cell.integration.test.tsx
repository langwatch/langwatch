/**
 * @vitest-environment jsdom
 *
 * The Context Size column: how full the window already was when the trace's
 * first model call ran. It sits next to Tokens and means something different,
 * so the cell says so on hover rather than leaving a reader to assume it is
 * another sum.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TraceListItem } from "../../../../../types/trace";
import { ContextSizeCell } from "../context-size-cell";

afterEach(cleanup);

function row(over: Partial<TraceListItem>): TraceListItem {
  return {
    traceId: "t1",
    timestamp: 0,
    name: "trace",
    serviceName: "claude-code",
    durationMs: 1,
    totalCost: 0,
    totalTokens: 0,
    models: [],
    labels: [],
    status: "ok",
    spanCount: 1,
    ...over,
  } as unknown as TraceListItem;
}

function renderCell(item: TraceListItem) {
  return render(
    <ChakraProvider value={defaultSystem}>
      {ContextSizeCell.render({ row: item } as never)}
    </ChakraProvider>,
  );
}

describe("ContextSizeCell", () => {
  describe("given a trace that reported a context size", () => {
    /** @scenario "Context size is shown in the trace list next to tokens" */
    it("shows the starting context, formatted", () => {
      renderCell(row({ contextSizeTokens: 156_800 }));
      expect(screen.getByText("156.8K")).toBeInTheDocument();
    });
  });

  describe("given a trace with no context size", () => {
    it("shows a dash rather than a zero, which would read as an empty context", () => {
      renderCell(row({ contextSizeTokens: null }));
      expect(screen.getByText("—")).toBeInTheDocument();
    });
  });
});
