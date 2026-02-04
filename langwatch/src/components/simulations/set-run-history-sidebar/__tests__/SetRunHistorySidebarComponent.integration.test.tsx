/**
 * @vitest-environment jsdom
 *
 * Integration tests for SetRunHistorySidebarComponent.
 *
 * Tests the empty state message for internal vs user-created sets.
 *
 * @see specs/scenarios/internal-scenario-namespace.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SetRunHistorySidebarComponent } from "../SetRunHistorySidebarComponent";
import type { useSetRunHistorySidebarController } from "../useSetRunHistorySidebarController";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

function createMockProps(
  overrides: Partial<ReturnType<typeof useSetRunHistorySidebarController>> = {}
): ReturnType<typeof useSetRunHistorySidebarController> {
  return {
    runs: [],
    onRunClick: vi.fn(),
    isLoading: false,
    scenarioSetId: "test-set",
    error: null,
    pagination: {
      page: 1,
      limit: 8,
      totalPages: 1,
      totalCount: 0,
      hasPrevPage: false,
      hasNextPage: false,
      onPageChange: vi.fn(),
      onPrevPage: vi.fn(),
      onNextPage: vi.fn(),
    },
    ...overrides,
  };
}

describe("<SetRunHistorySidebarComponent/>", () => {
  afterEach(() => {
    cleanup();
  });

  describe("given an internal set ID with no runs", () => {
    const internalSetId = "__internal__proj_abc123__on-platform-scenarios";

    describe("when the empty state is displayed", () => {
      it('shows "On-Platform Scenarios" in the message', () => {
        const props = createMockProps({
          scenarioSetId: internalSetId,
          runs: [],
          isLoading: false,
        });

        render(<SetRunHistorySidebarComponent {...props} />, {
          wrapper: Wrapper,
        });

        expect(screen.getByText("On-Platform Scenarios")).toBeInTheDocument();
        expect(screen.queryByText(internalSetId)).not.toBeInTheDocument();
      });
    });
  });

  describe("given a user-created set ID with no runs", () => {
    const userSetId = "production-tests";

    describe("when the empty state is displayed", () => {
      it("shows the raw set ID in the message", () => {
        const props = createMockProps({
          scenarioSetId: userSetId,
          runs: [],
          isLoading: false,
        });

        render(<SetRunHistorySidebarComponent {...props} />, {
          wrapper: Wrapper,
        });

        expect(screen.getByText(userSetId)).toBeInTheDocument();
      });
    });
  });

  describe("given no set ID with no runs", () => {
    describe("when the empty state is displayed", () => {
      it('shows "unknown" as fallback', () => {
        const props = createMockProps({
          scenarioSetId: undefined,
          runs: [],
          isLoading: false,
        });

        render(<SetRunHistorySidebarComponent {...props} />, {
          wrapper: Wrapper,
        });

        expect(screen.getByText("unknown")).toBeInTheDocument();
      });
    });
  });
});
