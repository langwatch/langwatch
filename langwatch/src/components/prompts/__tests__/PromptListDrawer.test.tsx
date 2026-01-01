/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PromptListDrawer } from "../PromptListDrawer";

// Mock dependencies
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: {},
    asPath: "/test",
  }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    canGoBack: false,
    goBack: mockGoBack,
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: () => mockUseAllPromptsForProject(),
}));

vi.mock("~/server/modelProviders/iconsMap", () => ({
  modelProviderIcons: {},
}));

const mockCloseDrawer = vi.fn();
const mockOpenDrawer = vi.fn();
const mockGoBack = vi.fn();
let mockUseAllPromptsForProject = vi.fn();

const mockPrompts = [
  { id: "prompt-1", handle: "my-assistant", model: "openai/gpt-4o", version: 3 },
  { id: "prompt-2", handle: "code-reviewer", model: "anthropic/claude-3", version: 1 },
  { id: "prompt-3", handle: "shared/ts-guidelines", model: "openai/gpt-4o", version: 2 },
  { id: "prompt-4", handle: "shared/go-guidelines", model: "openai/gpt-4o", version: 1 },
];

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("PromptListDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseAllPromptsForProject = vi.fn().mockReturnValue({
      data: mockPrompts,
      isLoading: false,
    });
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props: Partial<React.ComponentProps<typeof PromptListDrawer>> = {}) => {
    return render(<PromptListDrawer open={true} {...props} />, { wrapper: Wrapper });
  };

  describe("Basic rendering", () => {
    it("renders the drawer header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Choose Prompt")).toBeInTheDocument();
      });
    });

    it("shows New Prompt button", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("new-prompt-button")).toBeInTheDocument();
      });
    });

    it("shows loading state", async () => {
      mockUseAllPromptsForProject = vi.fn().mockReturnValue({
        data: undefined,
        isLoading: true,
      });
      renderDrawer();
      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty state when no prompts exist", async () => {
      mockUseAllPromptsForProject = vi.fn().mockReturnValue({
        data: [],
        isLoading: false,
      });
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("No prompts yet")).toBeInTheDocument();
        expect(screen.getByText("Create your first prompt to get started")).toBeInTheDocument();
      });
    });

    it("shows create first prompt button in empty state", async () => {
      mockUseAllPromptsForProject = vi.fn().mockReturnValue({
        data: [],
        isLoading: false,
      });
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("create-first-prompt-button")).toBeInTheDocument();
      });
    });
  });

  describe("Prompt list display", () => {
    it("shows prompts without folder prefix directly", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("my-assistant")).toBeInTheDocument();
        expect(screen.getByText("code-reviewer")).toBeInTheDocument();
      });
    });

    it("shows prompts in folders grouped together", async () => {
      renderDrawer();
      await waitFor(() => {
        // Folder should be visible
        expect(screen.getByTestId("folder-shared")).toBeInTheDocument();
      });
    });

    it("shows version info for prompts", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("v3")).toBeInTheDocument(); // my-assistant version
        // Multiple v1 prompts exist, so check for at least one
        expect(screen.getAllByText("v1").length).toBeGreaterThan(0);
      });
    });
  });

  describe("Prompt selection", () => {
    it("calls onSelect when clicking a prompt", async () => {
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderDrawer({ onSelect });

      await waitFor(() => {
        expect(screen.getByTestId("prompt-card-prompt-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("prompt-card-prompt-1"));

      expect(onSelect).toHaveBeenCalledWith({
        id: "prompt-1",
        name: "my-assistant",
      });
    });

    it("does not auto-close drawer after selection (callback handles closing/navigation)", async () => {
      // The onSelect callback is responsible for closing the drawer or navigating.
      // This allows consumers to navigate to another drawer (e.g., promptEditor)
      // without the flow callbacks being cleared by closeDrawer.
      const user = userEvent.setup();
      const onSelect = vi.fn();
      renderDrawer({ onSelect });

      await waitFor(() => {
        expect(screen.getByTestId("prompt-card-prompt-1")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("prompt-card-prompt-1"));

      // closeDrawer is NOT called - the callback is responsible for closing/navigation
      expect(mockCloseDrawer).not.toHaveBeenCalled();
    });
  });

  describe("New Prompt button", () => {
    it("calls onCreateNew when clicking New Prompt", async () => {
      const user = userEvent.setup();
      const onCreateNew = vi.fn();
      renderDrawer({ onCreateNew });

      await waitFor(() => {
        expect(screen.getByTestId("new-prompt-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("new-prompt-button"));

      expect(onCreateNew).toHaveBeenCalled();
    });

    it("opens promptEditor drawer by default", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("new-prompt-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("new-prompt-button"));

      expect(mockOpenDrawer).toHaveBeenCalledWith("promptEditor");
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

  describe("Search functionality", () => {
    it("shows search input when prompts exist", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("prompt-search-input")).toBeInTheDocument();
      });
    });

    it("does not show search input in empty state", async () => {
      mockUseAllPromptsForProject = vi.fn().mockReturnValue({
        data: [],
        isLoading: false,
      });
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("No prompts yet")).toBeInTheDocument();
      });
      expect(screen.queryByTestId("prompt-search-input")).not.toBeInTheDocument();
    });

    it("filters prompts by name", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("prompt-search-input")).toBeInTheDocument();
      });

      // All prompts should be visible initially
      expect(screen.getByText("my-assistant")).toBeInTheDocument();
      expect(screen.getByText("code-reviewer")).toBeInTheDocument();

      // Type in search
      await user.type(screen.getByTestId("prompt-search-input"), "assist");

      // Only matching prompt should be visible
      expect(screen.getByText("my-assistant")).toBeInTheDocument();
      expect(screen.queryByText("code-reviewer")).not.toBeInTheDocument();
    });

    it("shows no results message when search has no matches", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("prompt-search-input")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("prompt-search-input"), "nonexistent");

      await waitFor(() => {
        expect(screen.getByTestId("no-search-results")).toBeInTheDocument();
      });
    });

    it("clears search when clicking Clear search button", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("prompt-search-input")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("prompt-search-input"), "nonexistent");

      await waitFor(() => {
        expect(screen.getByText("Clear search")).toBeInTheDocument();
      });

      await user.click(screen.getByText("Clear search"));

      // All prompts should be visible again
      await waitFor(() => {
        expect(screen.getByText("my-assistant")).toBeInTheDocument();
        expect(screen.getByText("code-reviewer")).toBeInTheDocument();
      });
    });
  });
});
