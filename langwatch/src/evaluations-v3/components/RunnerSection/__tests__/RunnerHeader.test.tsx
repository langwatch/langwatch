/** @vitest-environment jsdom */
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";

import { RunnerHeader } from "../RunnerHeader";
import type { RunnerConfig } from "../../../types";

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    pathname: "/test",
    push: vi.fn(),
    replace: vi.fn(),
    events: { on: vi.fn(), off: vi.fn() },
  }),
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("RunnerHeader", () => {
  const mockOnEdit = vi.fn();
  const mockOnRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Prompt runner", () => {
    const promptRunner: RunnerConfig = {
      id: "runner-1",
      name: "my-assistant",
      type: "prompt",
      promptId: "prompt-123",
      promptVersionId: "version-456",
      inputs: [],
      outputs: [],
      mappings: {},
      evaluatorIds: [],
    };

    it("renders prompt runner with name and icon", () => {
      renderWithProviders(
        <RunnerHeader
          runner={promptRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      expect(screen.getByText("my-assistant")).toBeInTheDocument();
    });

    it("shows play button on the far right", () => {
      renderWithProviders(
        <RunnerHeader
          runner={promptRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      expect(screen.getByTestId("runner-play-button")).toBeInTheDocument();
    });

    it("opens menu when clicking on the header", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <RunnerHeader
          runner={promptRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      await user.click(screen.getByTestId("runner-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
    });

    it("calls onEdit when clicking Edit Prompt", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <RunnerHeader
          runner={promptRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      await user.click(screen.getByTestId("runner-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Edit Prompt"));

      expect(mockOnEdit).toHaveBeenCalledWith(promptRunner);
    });

    it("calls onRemove when clicking Remove from Workbench", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <RunnerHeader
          runner={promptRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      await user.click(screen.getByTestId("runner-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Remove from Workbench"));

      expect(mockOnRemove).toHaveBeenCalledWith(promptRunner.id);
    });
  });

  describe("Agent runner", () => {
    const agentRunner: RunnerConfig = {
      id: "runner-2",
      name: "Python Processor",
      type: "agent",
      dbAgentId: "agent-123",
      inputs: [],
      outputs: [],
      mappings: {},
      evaluatorIds: [],
    };

    it("renders agent runner with name", () => {
      renderWithProviders(
        <RunnerHeader
          runner={agentRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      expect(screen.getByText("Python Processor")).toBeInTheDocument();
    });

    it("shows Edit Agent option for agents", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <RunnerHeader
          runner={agentRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      await user.click(screen.getByTestId("runner-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Agent")).toBeInTheDocument();
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
    });

    it("calls onEdit when clicking Edit Agent", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <RunnerHeader
          runner={agentRunner}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />
      );

      await user.click(screen.getByTestId("runner-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Edit Agent")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Edit Agent"));

      expect(mockOnEdit).toHaveBeenCalledWith(agentRunner);
    });
  });
});
