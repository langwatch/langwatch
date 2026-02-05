/**
 * @vitest-environment jsdom
 *
 * Integration tests for SimulationLayout component.
 *
 * Tests the UI treatment for internal vs user-created sets in the header.
 *
 * @see specs/scenarios/internal-scenario-namespace.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Mock the useSimulationRouter hook
const mockUseSimulationRouter = vi.fn();
vi.mock("~/hooks/simulations", () => ({
  useSimulationRouter: () => mockUseSimulationRouter(),
}));

// Mock DashboardLayout to simplify testing
vi.mock("../../DashboardLayout", () => ({
  DashboardLayout: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="dashboard-layout">{children}</div>
  ),
}));

// Mock SetRunHistorySidebar to simplify testing
vi.mock("../set-run-history-sidebar", () => ({
  SetRunHistorySidebar: () => <div data-testid="sidebar" />,
}));

// Import after mocks are set up
import { SimulationLayout } from "../SimulationLayout";

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("<SimulationLayout/>", () => {
  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  describe("given an internal set ID in the URL", () => {
    const internalSetId = "__internal__proj_abc123__on-platform-scenarios";

    describe("when the header displays the scenario set", () => {
      it('shows "On-Platform Scenarios" instead of the internal namespace ID', () => {
        mockUseSimulationRouter.mockReturnValue({
          scenarioSetId: internalSetId,
        });

        render(
          <SimulationLayout>
            <div>content</div>
          </SimulationLayout>,
          { wrapper: Wrapper }
        );

        expect(screen.getByText("On-Platform Scenarios")).toBeInTheDocument();
        expect(screen.queryByText(internalSetId)).not.toBeInTheDocument();
      });
    });
  });

  describe("given a user-created set ID in the URL", () => {
    const userSetId = "my-custom-set";

    describe("when the header displays the scenario set", () => {
      it("shows the raw set ID", () => {
        mockUseSimulationRouter.mockReturnValue({
          scenarioSetId: userSetId,
        });

        render(
          <SimulationLayout>
            <div>content</div>
          </SimulationLayout>,
          { wrapper: Wrapper }
        );

        expect(screen.getByText(userSetId)).toBeInTheDocument();
      });
    });
  });

  describe("given no set ID in the URL", () => {
    describe("when the header displays the scenario set", () => {
      it('shows "unknown" as fallback', () => {
        mockUseSimulationRouter.mockReturnValue({
          scenarioSetId: undefined,
        });

        render(
          <SimulationLayout>
            <div>content</div>
          </SimulationLayout>,
          { wrapper: Wrapper }
        );

        expect(screen.getByText("unknown")).toBeInTheDocument();
      });
    });
  });
});
