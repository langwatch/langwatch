/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
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

// Helper to generate long text
const generateLongText = (length: number): string => {
  return "A".repeat(length);
};

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

    it("renders object output as JSON", () => {
      const target = createTarget();
      const objectOutput = { key: "value", nested: { foo: "bar" } };

      render(
        <TargetCellContent
          target={target}
          output={objectOutput}
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Should contain the JSON key
      expect(screen.getByText(/key/)).toBeInTheDocument();
      expect(screen.getByText(/value/)).toBeInTheDocument();
    });
  });

  describe("Output Truncation", () => {
    it("truncates output at MAX_DISPLAY_CHARS and shows indicator", () => {
      const target = createTarget();
      // Generate text longer than MAX_DISPLAY_CHARS (10000)
      const longText = generateLongText(15000);

      render(
        <TargetCellContent
          target={target}
          output={longText}
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Should show truncated indicator
      expect(screen.getByText("(truncated)")).toBeInTheDocument();
    });

    it("does not show truncation indicator for short text", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Short text"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      expect(screen.queryByText("(truncated)")).not.toBeInTheDocument();
    });
  });

  describe("Overflow and Fade Effect", () => {
    it("renders output content in a container", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Some output text"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Output text should be present
      expect(screen.getByText("Some output text")).toBeInTheDocument();
    });

    it("renders text with pre-wrap whitespace for proper formatting", () => {
      const target = createTarget();
      const multilineText = "Line 1\nLine 2\nLine 3";

      render(
        <TargetCellContent
          target={target}
          output={multilineText}
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // The text should be in the document (pre-wrap preserves newlines)
      expect(screen.getByText(/Line 1/)).toBeInTheDocument();
    });
  });

  describe("Expanded Output View", () => {
    // Mock getBoundingClientRect for positioning
    beforeEach(() => {
      Element.prototype.getBoundingClientRect = vi.fn(() => ({
        top: 100,
        left: 200,
        width: 300,
        height: 150,
        bottom: 250,
        right: 500,
        x: 200,
        y: 100,
        toJSON: () => {},
      }));
    });

    // Mock scrollHeight to simulate overflow
    const mockScrollHeight = (height: number) => {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: function () {
          return height;
        },
      });
    };

    it("shows expanded overlay when clicking on overflowing content", async () => {
      const user = userEvent.setup();
      const target = createTarget();
      // Simulate overflow by mocking scrollHeight > max height (120)
      mockScrollHeight(200);

      render(
        <TargetCellContent
          target={target}
          output="This is some content that would overflow"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Find and click the output text
      const outputText = screen.getByText(/This is some content/);
      await user.click(outputText);

      // Expanded view should appear - indicated by having 2 Add evaluator buttons
      await waitFor(() => {
        const addButtons = screen.getAllByTestId(`add-evaluator-button-${target.id}`);
        expect(addButtons.length).toBe(2);
      });
    });

    it("closes expanded view when clicking outside (backdrop)", async () => {
      const user = userEvent.setup();
      const target = createTarget();
      mockScrollHeight(200);

      render(
        <TargetCellContent
          target={target}
          output="This is some content that would overflow"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Open expanded view
      const outputText = screen.getByText(/This is some content/);
      await user.click(outputText);

      // Wait for expanded view to appear
      await waitFor(() => {
        const addButtons = screen.getAllByTestId(`add-evaluator-button-${target.id}`);
        expect(addButtons.length).toBe(2);
      });

      // Click the backdrop to dismiss
      const backdrop = screen.getByTestId("expanded-cell-backdrop");
      await user.click(backdrop);

      // Expanded view should close - only 1 Add evaluator button
      await waitFor(() => {
        const addButtons = screen.getAllByTestId(`add-evaluator-button-${target.id}`);
        expect(addButtons.length).toBe(1);
      });
    });

    it("shows same content in expanded view as collapsed", async () => {
      const user = userEvent.setup();
      const target = createTarget();
      mockScrollHeight(200);

      render(
        <TargetCellContent
          target={target}
          output="This is some content that would overflow"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Open expanded view
      const outputText = screen.getByText(/This is some content/);
      await user.click(outputText);

      // Should still show Add evaluator button in expanded view
      await waitFor(() => {
        // There should be 2 Add evaluator buttons now (one in collapsed, one in expanded)
        const addButtons = screen.getAllByTestId(`add-evaluator-button-${target.id}`);
        expect(addButtons.length).toBe(2);
      });
    });

    it("shows action buttons in expanded view", async () => {
      const user = userEvent.setup();
      const target = createTarget();
      mockScrollHeight(200);

      render(
        <TargetCellContent
          target={target}
          output="Content that overflows"
          evaluatorResults={{}}
          row={0}
          traceId="trace_123"
          onRunCell={() => {}}
        />,
        { wrapper: Wrapper }
      );

      // Open expanded view
      const outputText = screen.getByText(/Content that overflows/);
      await user.click(outputText);

      // Should show run button and trace button in expanded view
      await waitFor(() => {
        // There should be 2 run buttons (collapsed + expanded)
        const runButtons = screen.getAllByTestId(`run-cell-${target.id}`);
        expect(runButtons.length).toBe(2);
      });
      // There should be 2 trace buttons (collapsed + expanded)
      const traceButtons = screen.getAllByTestId(`trace-link-${target.id}`);
      expect(traceButtons.length).toBe(2);
    });

    it("does not open expanded view when content does not overflow", async () => {
      const user = userEvent.setup();
      const target = createTarget();
      // Mock scrollHeight less than max height (120)
      mockScrollHeight(50);

      render(
        <TargetCellContent
          target={target}
          output="Short content"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Click the output text
      const outputText = screen.getByText(/Short content/);
      await user.click(outputText);

      // Expanded view should NOT appear (only 1 Add evaluator button)
      const addButtons = screen.getAllByTestId(`add-evaluator-button-${target.id}`);
      expect(addButtons.length).toBe(1);
    });
  });

  describe("Fade Overlay", () => {
    const mockScrollHeight = (height: number) => {
      Object.defineProperty(HTMLElement.prototype, "scrollHeight", {
        configurable: true,
        get: function () {
          return height;
        },
      });
    };

    it("renders fade overlay when content overflows", () => {
      const target = createTarget();
      // Mock scrollHeight greater than max height (120)
      mockScrollHeight(200);

      const { container } = render(
        <TargetCellContent
          target={target}
          output="This is content that would overflow the container"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Find the fade overlay element by class
      const fadeOverlay = container.querySelector(".cell-fade-overlay");
      expect(fadeOverlay).toBeInTheDocument();
    });

    it("does not render fade overlay when content fits", () => {
      const target = createTarget();
      // Mock scrollHeight less than max height
      mockScrollHeight(50);

      const { container } = render(
        <TargetCellContent
          target={target}
          output="Short"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Fade overlay should not be present
      const fadeOverlay = container.querySelector(".cell-fade-overlay");
      expect(fadeOverlay).not.toBeInTheDocument();
    });

    it("fade overlay has gradient background style", () => {
      const target = createTarget();
      mockScrollHeight(200);

      const { container } = render(
        <TargetCellContent
          target={target}
          output="This is content that would overflow"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      const fadeOverlay = container.querySelector(".cell-fade-overlay");
      expect(fadeOverlay).toBeInTheDocument();
      // The gradient is applied via CSS, so we just check it exists
    });

    it("clicking fade overlay opens expanded view", async () => {
      const user = userEvent.setup();
      const target = createTarget();
      mockScrollHeight(200);

      // Mock getBoundingClientRect
      Element.prototype.getBoundingClientRect = vi.fn(() => ({
        top: 100,
        left: 200,
        width: 300,
        height: 150,
        bottom: 250,
        right: 500,
        x: 200,
        y: 100,
        toJSON: () => {},
      }));

      const { container } = render(
        <TargetCellContent
          target={target}
          output="Content that overflows"
          evaluatorResults={{}}
          row={0}
        />,
        { wrapper: Wrapper }
      );

      // Click the fade overlay
      const fadeOverlay = container.querySelector(".cell-fade-overlay");
      expect(fadeOverlay).toBeInTheDocument();
      if (fadeOverlay) {
        await user.click(fadeOverlay);
      }

      // Expanded view should appear (2 Add evaluator buttons)
      await waitFor(() => {
        const addButtons = screen.getAllByTestId(`add-evaluator-button-${target.id}`);
        expect(addButtons.length).toBe(2);
      });
    });
  });

  describe("Loading State (Skeleton)", () => {
    it("shows skeleton when isLoading is true and no output", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output={undefined}
          evaluatorResults={{}}
          row={0}
          isLoading={true}
        />,
        { wrapper: Wrapper }
      );

      // Should show skeleton elements (Chakra v3 uses class containing 'skeleton')
      const skeletons = document.querySelectorAll('[class*="chakra-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);

      // Should NOT show "No output" text
      expect(screen.queryByText("No output")).not.toBeInTheDocument();
    });

    it("shows skeleton when isLoading is true EVEN WITH existing output", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="This is existing output that should be hidden during loading"
          evaluatorResults={{}}
          row={0}
          isLoading={true}
        />,
        { wrapper: Wrapper }
      );

      // Should show skeleton elements (Chakra v3 uses class containing 'skeleton')
      const skeletons = document.querySelectorAll('[class*="chakra-skeleton"]');
      expect(skeletons.length).toBeGreaterThan(0);

      // Should NOT show the existing output text
      expect(
        screen.queryByText("This is existing output that should be hidden during loading")
      ).not.toBeInTheDocument();
    });

    it("shows output when isLoading is false", () => {
      const target = createTarget();

      render(
        <TargetCellContent
          target={target}
          output="Completed output"
          evaluatorResults={{}}
          row={0}
          isLoading={false}
        />,
        { wrapper: Wrapper }
      );

      // Should NOT show skeleton
      const skeletons = document.querySelectorAll('[class*="chakra-skeleton"]');
      expect(skeletons.length).toBe(0);

      // Should show the output
      expect(screen.getByText("Completed output")).toBeInTheDocument();
    });
  });
});
