/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentTypeSelectorDrawer } from "../AgentTypeSelectorDrawer";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

const mockOpenDrawer = vi.fn();
const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  getComplexProps: () => ({}),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AgentTypeSelectorDrawer", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <AgentTypeSelectorDrawer
        open={true}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        {...props}
      />,
      { wrapper: Wrapper }
    );
  };

  describe("Basic rendering", () => {
    it("shows Choose Agent Type header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Choose Agent Type")).toBeInTheDocument();
      });
    });

    it("shows all three agent type options", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Prompt Agent")).toBeInTheDocument();
        expect(screen.getByText("Code Agent")).toBeInTheDocument();
        expect(screen.getByText("Workflow Agent")).toBeInTheDocument();
      });
    });

    it("shows descriptions for each type", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Use an LLM with a configured prompt to generate responses")).toBeInTheDocument();
        expect(screen.getByText("Write custom Python code to process inputs and generate outputs")).toBeInTheDocument();
        expect(screen.getByText("Use an existing workflow as the agent implementation")).toBeInTheDocument();
      });
    });
  });

  describe("Type selection", () => {
    it("calls onSelect with 'signature' and opens prompt editor when clicking Prompt Agent", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("agent-type-signature")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("agent-type-signature"));

      expect(mockOnSelect).toHaveBeenCalledWith("signature");
      expect(mockOpenDrawer).toHaveBeenCalledWith("agentPromptEditor");
    });

    it("calls onSelect with 'code' and opens code editor when clicking Code Agent", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("agent-type-code")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("agent-type-code"));

      expect(mockOnSelect).toHaveBeenCalledWith("code");
      expect(mockOpenDrawer).toHaveBeenCalledWith("agentCodeEditor");
    });

    it("calls onSelect with 'workflow' and opens workflow selector when clicking Workflow Agent", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("agent-type-workflow")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("agent-type-workflow"));

      expect(mockOnSelect).toHaveBeenCalledWith("workflow");
      expect(mockOpenDrawer).toHaveBeenCalledWith("workflowSelector");
    });
  });
});
