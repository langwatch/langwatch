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

// Capture the onOpenChange handler from Drawer.Root
let capturedOnOpenChange: (() => void) | undefined;
vi.mock("~/components/ui/drawer", () => ({
  Drawer: {
    Root: ({
      children,
      onOpenChange,
    }: {
      children: React.ReactNode;
      onOpenChange?: () => void;
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
      capturedOnOpenChange!();

      expect(mockGoBack).toHaveBeenCalledOnce();
    });

    it("resets comment state", () => {
      render(
        <TraceDetailsDrawer traceId="test-trace-id" selectedTab="messages" />,
      );

      capturedOnOpenChange!();

      expect(mockResetComment).toHaveBeenCalledOnce();
    });

    it("does not call closeDrawer directly", () => {
      render(
        <TraceDetailsDrawer traceId="test-trace-id" selectedTab="messages" />,
      );

      capturedOnOpenChange!();

      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });
  });
});
