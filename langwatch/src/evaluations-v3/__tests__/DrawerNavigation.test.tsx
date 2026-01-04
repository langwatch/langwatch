/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { ReactElement } from "react";

import { TargetTypeSelectorDrawer } from "~/components/targets/TargetTypeSelectorDrawer";
import { PromptListDrawer } from "~/components/prompts/PromptListDrawer";
import { AgentListDrawer } from "~/components/agents/AgentListDrawer";
import { AgentTypeSelectorDrawer } from "~/components/agents/AgentTypeSelectorDrawer";

const renderWithProviders = (ui: ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

// Mock useDrawer hook
const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: mockCloseDrawer,
    goBack: mockGoBack,
    canGoBack: false,
    drawerOpen: vi.fn(() => false),
  }),
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
  getFlowCallbacks: () => ({}),
}));

// Mock prompts hook
vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: () => ({
    data: [
      { id: "prompt-1", handle: "test-prompt", version: 1, model: "gpt-4" },
    ],
    isLoading: false,
  }),
}));

// Mock agents query
vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getAll: {
        useQuery: () => ({
          data: [
            {
              id: "agent-1",
              name: "Test Agent",
              type: "code",
              updatedAt: new Date(),
            },
          ],
          isLoading: false,
        }),
      },
    },
  },
}));

// Mock project hook
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test" },
  }),
}));

describe("Drawer Navigation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  describe("TargetTypeSelectorDrawer", () => {
    it("navigates to promptList when prompt is selected", () => {
      renderWithProviders(<TargetTypeSelectorDrawer open={true} />);

      const promptCard = screen.getByTestId("target-type-prompt");
      fireEvent.click(promptCard);

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "promptList",
        {},
        { replace: true },
      );
    });

    it("navigates to agentList when agent is selected", () => {
      renderWithProviders(<TargetTypeSelectorDrawer open={true} />);

      const agentCard = screen.getByTestId("target-type-agent");
      fireEvent.click(agentCard);

      expect(mockOpenDrawer).toHaveBeenCalledWith(
        "agentList",
        {},
        { replace: true },
      );
    });

    it("calls custom onSelect callback when provided", () => {
      const customOnSelect = vi.fn();
      renderWithProviders(
        <TargetTypeSelectorDrawer open={true} onSelect={customOnSelect} />,
      );

      const promptCard = screen.getByTestId("target-type-prompt");
      fireEvent.click(promptCard);

      expect(customOnSelect).toHaveBeenCalledWith("prompt");
      // Should NOT navigate when custom callback is provided
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });
  });

  describe("PromptListDrawer", () => {
    it("navigates to promptEditor when New Prompt is clicked", () => {
      renderWithProviders(<PromptListDrawer open={true} />);

      const newPromptButton = screen.getByTestId("new-prompt-button");
      fireEvent.click(newPromptButton);

      expect(mockOpenDrawer).toHaveBeenCalledWith("promptEditor");
    });

    it("calls onSelect without closing (callback handles navigation)", () => {
      const onSelect = vi.fn();
      renderWithProviders(<PromptListDrawer open={true} onSelect={onSelect} />);

      const promptCard = screen.getByTestId("prompt-card-prompt-1");
      fireEvent.click(promptCard);

      expect(onSelect).toHaveBeenCalledWith({
        id: "prompt-1",
        name: "test-prompt",
      });
      // closeDrawer is NOT called - the onSelect callback is responsible for navigation
      // This allows the callback to navigate to another drawer (e.g., promptEditor)
      // without the flow callbacks being cleared
      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });
  });

  describe("AgentListDrawer", () => {
    it("navigates to agentTypeSelector when New Agent is clicked", () => {
      renderWithProviders(<AgentListDrawer open={true} />);

      const newAgentButton = screen.getByTestId("new-agent-button");
      fireEvent.click(newAgentButton);

      expect(mockOpenDrawer).toHaveBeenCalledWith("agentTypeSelector");
    });

    it("calls onSelect and closes when an agent is selected", () => {
      const onSelect = vi.fn();
      renderWithProviders(<AgentListDrawer open={true} onSelect={onSelect} />);

      const agentCard = screen.getByTestId("agent-card-agent-1");
      fireEvent.click(agentCard);

      expect(onSelect).toHaveBeenCalled();
      expect(mockCloseDrawer).toHaveBeenCalled();
    });
  });

  describe("AgentTypeSelectorDrawer", () => {
    it("navigates to agentCodeEditor when code is selected", () => {
      renderWithProviders(<AgentTypeSelectorDrawer open={true} />);

      const codeCard = screen.getByTestId("agent-type-code");
      fireEvent.click(codeCard);

      expect(mockOpenDrawer).toHaveBeenCalledWith("agentCodeEditor");
    });

    it("navigates to workflowSelector when workflow is selected", () => {
      renderWithProviders(<AgentTypeSelectorDrawer open={true} />);

      const workflowCard = screen.getByTestId("agent-type-workflow");
      fireEvent.click(workflowCard);

      expect(mockOpenDrawer).toHaveBeenCalledWith("workflowSelector");
    });
  });
});
