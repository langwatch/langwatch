/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RunnerTypeSelectorDrawer } from "../RunnerTypeSelectorDrawer";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

const mockCloseDrawer = vi.fn();
const mockOpenDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    canGoBack: false,
    goBack: mockGoBack,
  }),
  getComplexProps: () => ({}),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("RunnerTypeSelectorDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props: Partial<React.ComponentProps<typeof RunnerTypeSelectorDrawer>> = {}) => {
    return render(<RunnerTypeSelectorDrawer open={true} {...props} />, { wrapper: Wrapper });
  };

  describe("Basic rendering", () => {
    it("renders the drawer header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Add to Evaluation")).toBeInTheDocument();
      });
    });

    it("shows two runner type options", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("runner-type-prompt")).toBeInTheDocument();
        expect(screen.getByTestId("runner-type-agent")).toBeInTheDocument();
      });
    });

    it("shows Prompt option with description", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Prompt")).toBeInTheDocument();
        expect(screen.getByText("Use a versioned prompt from your Prompts library")).toBeInTheDocument();
      });
    });

    it("shows Agent option with description", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Agent")).toBeInTheDocument();
        expect(screen.getByText("Use a code executor or workflow-based agent")).toBeInTheDocument();
      });
    });
  });

  describe("Selection behavior", () => {
    it("calls onSelect with 'prompt' when clicking Prompt", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderDrawer({ onSelect });

      await waitFor(() => {
        expect(screen.getByTestId("runner-type-prompt")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("runner-type-prompt"));

      expect(onSelect).toHaveBeenCalledWith("prompt");
    });

    it("calls onSelect with 'agent' when clicking Agent", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderDrawer({ onSelect });

      await waitFor(() => {
        expect(screen.getByTestId("runner-type-agent")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("runner-type-agent"));

      expect(onSelect).toHaveBeenCalledWith("agent");
    });

    it("opens promptList drawer when selecting Prompt", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("runner-type-prompt")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("runner-type-prompt"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("promptList");
    });

    it("opens agentList drawer when selecting Agent", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("runner-type-agent")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("runner-type-agent"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("agentList");
    });
  });

  describe("Cancel button", () => {
    it("closes drawer when clicking Cancel", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Cancel")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Cancel"));

      expect(mockCloseDrawer).toHaveBeenCalled();
    });
  });
});
