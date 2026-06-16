/**
 * @vitest-environment jsdom
 *
 * Summary view mode in TraceDrawerShell renders the ConversationContext
 * strip (inside a flexShrink=0 / maxHeight wrapper) when the trace has a
 * conversationId, wired to drawerStore's
 * `paneState.conversationContext.collapsed` and
 * `togglePaneCollapsed("conversationContext")`. Mounting the full shell
 * needs a drawer + queries + presence stack, so this test renders the
 * summary branch's JSX contract with the real ConversationContext
 * component and a mocked store/hook boundary.
 */

import { Box, ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";

const togglePaneCollapsed = vi.fn();

const storeState = {
  viewMode: "summary",
  paneState: {
    conversationContext: { collapsed: true, size: 30 },
    visualization: { collapsed: false, size: 40 },
    spanDetail: { collapsed: false, size: 30 },
  },
  togglePaneCollapsed,
};

vi.mock("../../../stores/drawerStore", () => ({
  useDrawerStore: (selector: (s: typeof storeState) => unknown) =>
    selector(storeState),
}));

vi.mock("../../../hooks/useTraceDrawerNavigation", () => ({
  useTraceDrawerNavigation: () => ({ navigateToTrace: vi.fn() }),
}));

vi.mock("../../../hooks/useConversationContext", () => ({
  useConversationContext: (conversationId: string | null, traceId: string) => ({
    conversationId,
    total: 2,
    position: 2,
    turns: [
      {
        traceId: "trace_prev",
        timestamp: 1,
        name: "prev",
        rootSpanType: null,
        status: "ok",
        input: "earlier question",
        output: "earlier answer",
      },
      {
        traceId,
        timestamp: 2,
        name: "curr",
        rootSpanType: null,
        status: "ok",
        input: "current question",
        output: "current answer",
      },
    ],
    previous: {
      traceId: "trace_prev",
      timestamp: 1,
      name: "prev",
      rootSpanType: null,
      status: "ok",
      input: "earlier question",
      output: "earlier answer",
    },
    next: null,
    isLoading: false,
  }),
}));

import { ConversationContext } from "../ConversationContext";

interface SummaryTrace {
  traceId: string;
  conversationId: string | null;
}

/**
 * Mirrors TraceDrawerShell's `viewMode === "summary"` branch: the strip
 * wrapper + ConversationContext only mount when the trace has a
 * conversationId, collapse state comes from the drawer store's
 * conversationContext pane, and the toggle dispatches
 * `togglePaneCollapsed("conversationContext")`.
 */
function SummaryBranch({ trace }: { trace: SummaryTrace }) {
  const collapsed = storeState.paneState.conversationContext.collapsed;
  return (
    <>
      {trace.conversationId && (
        <Box flexShrink={0} maxHeight="40%" overflow="auto">
          <ConversationContext
            conversationId={trace.conversationId}
            traceId={trace.traceId}
            collapsed={collapsed}
            onToggleCollapsed={() =>
              storeState.togglePaneCollapsed("conversationContext")
            }
          />
        </Box>
      )}
    </>
  );
}

const renderSummaryBranch = (trace: SummaryTrace) =>
  render(
    <ChakraProvider value={defaultSystem}>
      <SummaryBranch trace={trace} />
    </ChakraProvider>,
  );

describe("Summary view conversation context strip", () => {
  afterEach(() => {
    cleanup();
    togglePaneCollapsed.mockClear();
  });

  describe("given a trace with a conversationId in summary mode", () => {
    it("renders the conversation context region", () => {
      renderSummaryBranch({ traceId: "trace_1", conversationId: "conv_1" });
      expect(screen.getByText(/conversation context/i)).toBeInTheDocument();
      expect(screen.getByText(/turn 2 of 2/i)).toBeInTheDocument();
    });

    it("reflects the store's collapsed state on the header toggle", () => {
      renderSummaryBranch({ traceId: "trace_1", conversationId: "conv_1" });
      const header = screen.getByRole("button", {
        name: /conversation context/i,
      });
      expect(header).toHaveAttribute("aria-expanded", "false");
    });

    describe("when the context header toggle is clicked", () => {
      it("invokes togglePaneCollapsed with conversationContext", () => {
        renderSummaryBranch({ traceId: "trace_1", conversationId: "conv_1" });
        fireEvent.click(
          screen.getByRole("button", { name: /conversation context/i }),
        );
        expect(togglePaneCollapsed).toHaveBeenCalledTimes(1);
        expect(togglePaneCollapsed).toHaveBeenCalledWith("conversationContext");
      });
    });
  });

  describe("given a trace without a conversationId", () => {
    it("does not render the conversation context region", () => {
      renderSummaryBranch({ traceId: "trace_1", conversationId: null });
      expect(
        screen.queryByText(/conversation context/i),
      ).not.toBeInTheDocument();
    });
  });
});
