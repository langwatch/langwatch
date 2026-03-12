/**
 * @vitest-environment jsdom
 *
 * Unit tests for TraceMessage component.
 * Regression test for issue #2278: traces drawer cannot be closed from suites/run.
 *
 * The bug: clicking "View Trace" inside ScenarioRunDetailDrawer used openDrawer(),
 * which replaced the parent drawer URL, making it impossible to close.
 * The fix: an optional onViewTrace callback that bypasses URL-based navigation.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Mock useDrawer
const mockOpenDrawer = vi.fn();
const mockDrawerOpen = vi.fn(() => false);
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    canGoBack: false,
    drawerOpen: mockDrawerOpen,
  }),
  useDrawerParams: () => ({}),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project", apiKey: "key" },
  }),
}));

// Mock the tRPC API — simulate a successful trace query
vi.mock("~/utils/api", () => ({
  api: {
    traces: {
      getById: {
        useQuery: () => ({
          isLoading: false,
          isError: false,
          data: { traceId: "trace-123" },
        }),
      },
    },
  },
}));

import { TraceMessage } from "../TraceMessage";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("TraceMessage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when onViewTrace callback is provided", () => {
    it("calls onViewTrace instead of openDrawer on click", () => {
      const onViewTrace = vi.fn();
      render(<TraceMessage traceId="trace-123" onViewTrace={onViewTrace} />, {
        wrapper: Wrapper,
      });

      const button = screen.getByRole("button", { name: /view trace/i });
      fireEvent.click(button);

      expect(onViewTrace).toHaveBeenCalledWith("trace-123");
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });

  describe("when onViewTrace callback is not provided", () => {
    it("calls openDrawer with traceDetails on click", () => {
      render(<TraceMessage traceId="trace-456" />, {
        wrapper: Wrapper,
      });

      const button = screen.getByRole("button", { name: /view trace/i });
      fireEvent.click(button);

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", {
        traceId: "trace-456",
        selectedTab: "traceDetails",
      });
    });
  });
});
