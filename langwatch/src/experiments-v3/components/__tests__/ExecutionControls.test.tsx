/**
 * @vitest-environment jsdom
 *
 * Tests for ExecutionControls component.
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ExecutionControls, MiniRunButton } from "../ExecutionControls";

// Mock the useExecuteEvaluation hook
const mockExecute = vi.fn();
const mockAbort = vi.fn();
const mockReset = vi.fn();

vi.mock("../../hooks/useExecuteEvaluation", () => ({
  useExecuteEvaluation: () => ({
    status: mockStatus,
    runId: mockRunId,
    progress: mockProgress,
    totalCost: 0,
    error: mockError,
    execute: mockExecute,
    abort: mockAbort,
    reset: mockReset,
  }),
}));

// Mock state variables
let mockStatus: "idle" | "running" | "stopped" | "completed" | "error" = "idle";
let mockRunId: string | null = null;
let mockProgress = { completed: 0, total: 0 };
let mockError: string | null = null;

const renderControls = (props = {}) => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <ExecutionControls {...props} />
    </ChakraProvider>,
  );
};

const renderMiniButton = (props: {
  onClick: () => void;
  isRunning?: boolean;
  disabled?: boolean;
}) => {
  return render(
    <ChakraProvider value={defaultSystem}>
      <MiniRunButton {...props} />
    </ChakraProvider>,
  );
};

describe("ExecutionControls", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockStatus = "idle";
    mockRunId = null;
    mockProgress = { completed: 0, total: 0 };
    mockError = null;
  });

  afterEach(() => {
    cleanup();
  });

  describe("Idle State", () => {
    it("renders Evaluate button when idle", () => {
      renderControls();

      const button = screen.getByTestId("execution-control-button");
      expect(button).toBeInTheDocument();
      expect(screen.getByText("Evaluate")).toBeInTheDocument();
    });

    it("disables button when isReady is false", () => {
      renderControls({ isReady: false });

      const button = screen.getByTestId("execution-control-button");
      expect(button).toBeDisabled();
    });

    it("calls execute when clicked", async () => {
      const user = userEvent.setup();
      renderControls();

      const button = screen.getByTestId("execution-control-button");
      await user.click(button);

      expect(mockExecute).toHaveBeenCalled();
    });
  });

  describe("Running State", () => {
    beforeEach(() => {
      mockStatus = "running";
      mockRunId = "run-123";
      mockProgress = { completed: 2, total: 5 };
    });

    it("renders Stop button when running", () => {
      renderControls();

      expect(screen.getByText("Stop")).toBeInTheDocument();
    });

    it("shows progress indicator", () => {
      renderControls();

      expect(screen.getByText("2/5")).toBeInTheDocument();
    });

    it("calls abort when clicked", async () => {
      const user = userEvent.setup();
      renderControls();

      const button = screen.getByTestId("execution-control-button");
      await user.click(button);

      expect(mockAbort).toHaveBeenCalled();
    });
  });

  describe("Completed State", () => {
    beforeEach(() => {
      mockStatus = "completed";
      mockProgress = { completed: 5, total: 5 };
    });

    it("shows completion message", () => {
      renderControls();

      expect(screen.getByText(/5\/5 completed/)).toBeInTheDocument();
    });

    it("shows Evaluate button again", () => {
      renderControls();

      expect(screen.getByText("Evaluate")).toBeInTheDocument();
    });
  });

  describe("Error State", () => {
    beforeEach(() => {
      mockStatus = "error";
      mockError = "Something went wrong";
    });

    it("shows error message", () => {
      renderControls();

      expect(screen.getByText(/Execution failed/)).toBeInTheDocument();
    });
  });

  describe("Stopped State", () => {
    beforeEach(() => {
      mockStatus = "stopped";
      mockProgress = { completed: 3, total: 5 };
    });

    it("shows stopped message with progress", () => {
      renderControls();

      expect(screen.getByText(/Stopped at 3\/5/)).toBeInTheDocument();
    });
  });

  describe("Compact Mode", () => {
    it("renders smaller button in compact mode", () => {
      renderControls({ compact: true });

      const button = screen.getByTestId("execution-control-button");
      expect(button).toBeInTheDocument();
    });
  });
});

describe("MiniRunButton", () => {
  afterEach(() => {
    cleanup();
  });

  it("renders play icon when not running", () => {
    const onClick = vi.fn();
    renderMiniButton({ onClick });

    // Should have an SVG element (play icon)
    expect(document.querySelector("svg")).toBeInTheDocument();
  });

  it("renders spinner when running", () => {
    const onClick = vi.fn();
    renderMiniButton({ onClick, isRunning: true });

    // Should have a button (spinner renders inside)
    expect(screen.getByRole("button")).toBeInTheDocument();
  });

  it("calls onClick when clicked", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    renderMiniButton({ onClick });

    const button = screen.getByRole("button");
    await user.click(button);

    expect(onClick).toHaveBeenCalled();
  });

  it("stops event propagation", async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    const parentClick = vi.fn();

    render(
      <ChakraProvider value={defaultSystem}>
        <div onClick={parentClick}>
          <MiniRunButton onClick={onClick} />
        </div>
      </ChakraProvider>,
    );

    const button = screen.getByRole("button");
    await user.click(button);

    expect(onClick).toHaveBeenCalled();
    expect(parentClick).not.toHaveBeenCalled();
  });

  it("disables when disabled prop is true", () => {
    const onClick = vi.fn();
    renderMiniButton({ onClick, disabled: true });

    const button = screen.getByRole("button");
    expect(button).toBeDisabled();
  });
});
