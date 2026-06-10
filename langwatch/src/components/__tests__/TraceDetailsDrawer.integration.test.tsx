/**
 * @vitest-environment jsdom
 *
 * Integration tests for TraceDetailsDrawer.
 * Verifies that onOpenChange calls goBack() to handle both nested
 * and root drawer scenarios correctly (Issue #2278).
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render } from "@testing-library/react";

// Mock useDrawer hook
const mockGoBack = vi.fn();
const mockCloseDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    goBack: mockGoBack,
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    currentDrawer: "traceDetails",
    setFlowCallbacks: vi.fn(),
    getFlowCallbacks: vi.fn(),
  }),
  useDrawerParams: () => ({}),
  getDrawerStack: () => [],
  getComplexProps: () => ({}),
  setFlowCallbacks: vi.fn(),
  getFlowCallbacks: () => ({}),
}));

// Mock annotation comment store
const mockResetComment = vi.fn();
vi.mock("~/hooks/useAnnotationCommentStore", () => ({
  useAnnotationCommentStore: () => ({
    resetComment: mockResetComment,
  }),
}));

// Mock TraceDetails to avoid rendering the full component tree
vi.mock("~/components/traces/TraceDetails", () => ({
  TraceDetails: () => <div data-testid="trace-details">TraceDetails</div>,
}));

// NewTracesPromo pulls in tRPC (publicEnv → useOrganizationTeamProject) which
// requires withTRPC context this test does not provide. Also exports the
// `isDrawerSwapInProgress` flag-getter that TraceDetailsDrawer reads on
// every onOpenChange — stub it as always-false so the close flow runs.
vi.mock("~/components/messages/NewTracesPromo", () => ({
  NewTracesPromo: () => null,
  isDrawerSwapInProgress: () => false,
}));

// Capture the onOpenChange handler from Drawer.Root. The real
// handler destructures `{ open }` from its single argument (Chakra
// passes a details object on close), so type the captured signature
// accordingly.
let capturedOnOpenChange:
  | ((details: { open: boolean }) => void)
  | undefined;
vi.mock("~/components/ui/drawer", () => ({
  Drawer: {
    Root: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange?: (details: { open: boolean }) => void;
    }) => {
      capturedOnOpenChange = onOpenChange;
      return <div data-testid="drawer-root">{children}</div>;
    },
    Content: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
    Body: ({ children }: { children: React.ReactNode }) => (
      <div>{children}</div>
    ),
  },
}));

import { TraceDetailsDrawer } from "../TraceDetailsDrawer";

describe("TraceDetailsDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    capturedOnOpenChange = undefined;
  });

  describe("when onOpenChange fires", () => {
    it("calls goBack() to handle both nested and root drawer cases", () => {
      render(
        <TraceDetailsDrawer traceId="test-trace-id" selectedTab="messages" />,
      );

      expect(capturedOnOpenChange).toBeDefined();
      // Simulate Chakra firing the close event (open=false).
      capturedOnOpenChange!({ open: false });

      expect(mockGoBack).toHaveBeenCalledOnce();
    });

    it("resets comment state", () => {
      render(
        <TraceDetailsDrawer traceId="test-trace-id" selectedTab="messages" />,
      );

      // Simulate Chakra firing the close event (open=false).
      capturedOnOpenChange!({ open: false });

      expect(mockResetComment).toHaveBeenCalledOnce();
    });

    it("does not call closeDrawer directly", () => {
      render(
        <TraceDetailsDrawer traceId="test-trace-id" selectedTab="messages" />,
      );

      // Simulate Chakra firing the close event (open=false).
      capturedOnOpenChange!({ open: false });

      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });
  });
});
