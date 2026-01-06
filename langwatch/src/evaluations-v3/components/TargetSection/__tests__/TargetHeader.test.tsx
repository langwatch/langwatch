/** @vitest-environment jsdom */

import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { TargetConfig } from "../../../types";
import { TargetHeader } from "../../TargetSection/TargetHeader";

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

// Mock useLatestPromptVersion to avoid needing SessionProvider
vi.mock("~/prompts/hooks/useLatestPromptVersion", () => ({
  useLatestPromptVersion: () => ({
    currentVersion: undefined,
    latestVersion: undefined,
    isOutdated: false,
    isLoading: false,
    nextVersion: undefined,
  }),
}));

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("TargetHeader", () => {
  const mockOnEdit = vi.fn();
  const mockOnRemove = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("Prompt target", () => {
    const promptTarget: TargetConfig = {
      id: "target-1",
      name: "my-assistant",
      type: "prompt",
      promptId: "prompt-123",
      promptVersionId: "version-456",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("renders prompt target with name and icon", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByText("my-assistant")).toBeInTheDocument();
    });

    it("shows play button on the far right", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByTestId("target-play-button")).toBeInTheDocument();
    });

    it("opens menu when clicking on the header", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
    });

    it("calls onEdit when clicking Edit Prompt", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Edit Prompt"));

      expect(mockOnEdit).toHaveBeenCalledWith(promptTarget);
    });

    it("calls onRemove when clicking Remove from Workbench", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={promptTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Remove from Workbench"));

      expect(mockOnRemove).toHaveBeenCalledWith(promptTarget.id);
    });
  });

  describe("Unpublished modifications indicator", () => {
    const promptTargetWithLocalConfig: TargetConfig = {
      id: "target-3",
      name: "modified-prompt",
      type: "prompt",
      promptId: "prompt-123",
      promptVersionId: "version-456",
      localPromptConfig: {
        llm: { model: "openai/gpt-4o", temperature: 0.7 },
        messages: [{ role: "system", content: "Modified content" }],
        inputs: [],
        outputs: [{ identifier: "output", type: "str" }],
      },
      inputs: [],
      outputs: [],
      mappings: {},
    };

    const promptTargetWithoutLocalConfig: TargetConfig = {
      id: "target-4",
      name: "published-prompt",
      type: "prompt",
      promptId: "prompt-456",
      promptVersionId: "version-789",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("does not show orange dot when no localPromptConfig", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTargetWithoutLocalConfig}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(
        screen.queryByTestId("unpublished-indicator"),
      ).not.toBeInTheDocument();
    });

    it("shows orange dot when localPromptConfig exists", () => {
      renderWithProviders(
        <TargetHeader
          target={promptTargetWithLocalConfig}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByTestId("unpublished-indicator")).toBeInTheDocument();
    });

    it("does not show orange dot for agent targets even with localPromptConfig", () => {
      const agentWithLocalConfig: TargetConfig = {
        id: "target-5",
        name: "Agent",
        type: "agent",
        dbAgentId: "agent-123",
        // Even if this were somehow set, agents shouldn't show it
        inputs: [],
        outputs: [],
        mappings: {},
      };

      renderWithProviders(
        <TargetHeader
          target={agentWithLocalConfig}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(
        screen.queryByTestId("unpublished-indicator"),
      ).not.toBeInTheDocument();
    });
  });

  describe("Agent target", () => {
    const agentTarget: TargetConfig = {
      id: "target-2",
      name: "Python Processor",
      type: "agent",
      dbAgentId: "agent-123",
      inputs: [],
      outputs: [],
      mappings: {},
    };

    it("renders agent target with name", () => {
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      expect(screen.getByText("Python Processor")).toBeInTheDocument();
    });

    it("shows Edit Agent option for agents", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));

      await waitFor(() => {
        expect(screen.getByText("Edit Agent")).toBeInTheDocument();
        expect(screen.getByText("Remove from Workbench")).toBeInTheDocument();
      });
    });

    it("calls onEdit when clicking Edit Agent", async () => {
      const user = userEvent.setup();
      renderWithProviders(
        <TargetHeader
          target={agentTarget}
          onEdit={mockOnEdit}
          onRemove={mockOnRemove}
        />,
      );

      await user.click(screen.getByTestId("target-header-button"));
      await waitFor(() => {
        expect(screen.getByText("Edit Agent")).toBeInTheDocument();
      });
      await user.click(screen.getByText("Edit Agent"));

      expect(mockOnEdit).toHaveBeenCalledWith(agentTarget);
    });
  });
});
