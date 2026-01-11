/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, cleanup } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { TargetCellContent } from "../TargetCell";
import type { TargetConfig } from "../../../types";

// Mock hooks
const mockOpenDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
  }),
}));

vi.mock("../../../hooks/useEvaluationsV3Store", () => ({
  useEvaluationsV3Store: () => ({
    evaluators: [],
    activeDatasetId: "dataset-1",
    datasets: [],
    removeEvaluator: vi.fn(),
    setEvaluatorMapping: vi.fn(),
    removeEvaluatorMapping: vi.fn(),
  }),
}));

const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

const createTarget = (overrides: Partial<TargetConfig> = {}): TargetConfig => ({
  id: "target-1",
  name: "Test Target",
  type: "prompt",
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
  mappings: {},
  ...overrides,
});

describe("TargetCellContent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Trace Link", () => {
    it("renders trace button when traceId is provided", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Test output"
          evaluatorResults={{}}
          row={0}
          traceId="trace_abc123"
        />,
        { wrapper: Wrapper }
      );

      const traceButton = screen.getByTestId("trace-link-target-1");
      expect(traceButton).toBeInTheDocument();
    });

    it("opens trace drawer when trace button is clicked", async () => {
      const user = (await import("@testing-library/user-event")).default.setup();
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Test output"
          evaluatorResults={{}}
          row={0}
          traceId="trace_abc123"
        />,
        { wrapper: Wrapper }
      );

      const traceButton = screen.getByTestId("trace-link-target-1");
      await user.click(traceButton);

      expect(mockOpenDrawer).toHaveBeenCalledWith("traceDetails", { traceId: "trace_abc123" });
    });

    it("does not render trace button when traceId is null", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Test output"
          evaluatorResults={{}}
          row={0}
          traceId={null}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.queryByTestId("trace-link-target-1")).not.toBeInTheDocument();
    });

    it("does not render trace button when traceId is undefined", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Test output"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.queryByTestId("trace-link-target-1")).not.toBeInTheDocument();
    });
  });

  describe("Output Display", () => {
    it("renders output text", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Hello world"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Hello world")).toBeInTheDocument();
    });

    it("renders 'No output yet' when output is empty", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output={null}
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("No output yet")).toBeInTheDocument();
    });

    it("renders loading skeleton when isLoading is true", () => {
      const target = createTarget();

      const { container } = render(
        <TargetCellContent
          target={target}
          output={null}
          evaluatorResults={{}}
          row={0}
          isLoading={true}
        />,
        { wrapper: Wrapper }
      );

      // Skeleton elements should be present
      expect(container.querySelector('[class*="skeleton"]')).toBeInTheDocument();
    });

    it("renders error message when error is provided", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output={null}
          evaluatorResults={{}}
          row={0}
          error="Something went wrong"
        />,
        { wrapper: Wrapper }
      );

      expect(screen.getByText("Something went wrong")).toBeInTheDocument();
    });
  });
});
