/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PromptPickerModal } from "../PromptPickerModal";

// Mock dependencies
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
  }),
}));

vi.mock("~/hooks/useRecentTargets", () => ({
  useRecentTargets: () => ({
    recentPromptIds: ["prompt-1"],
    recentAgentIds: [],
    addRecentPrompt: vi.fn(),
    addRecentAgent: vi.fn(),
  }),
}));

// Mock prompts data
const mockPrompts = [
  {
    id: "prompt-1",
    handle: "greeting-prompt",
    version: 1,
    model: "gpt-4",
  },
  {
    id: "prompt-2",
    handle: "summary-prompt",
    version: 2,
    model: "gpt-3.5-turbo",
  },
  {
    id: "prompt-3",
    handle: null,
    version: 1,
    model: "gpt-4o",
  },
  {
    id: "prompt-draft",
    handle: "draft-prompt",
    version: 0, // Not published
    model: "gpt-4",
  },
];

vi.mock("~/prompts/hooks/useAllPromptsForProject", () => ({
  useAllPromptsForProject: vi.fn(() => ({
    data: mockPrompts,
    isLoading: false,
  })),
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("PromptPickerModal", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderModal = (props = {}) => {
    return render(
      <PromptPickerModal
        open={true}
        onClose={mockOnClose}
        onSelect={mockOnSelect}
        onCreateNew={mockOnCreateNew}
        {...props}
      />,
      { wrapper: Wrapper },
    );
  };

  describe("Basic rendering", () => {
    it("shows dialog title", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("Run with Prompt")).toBeInTheDocument();
      });
    });

    it("shows search input", async () => {
      renderModal();
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Search prompts..."),
        ).toBeInTheDocument();
      });
    });

    it("shows only published prompts (version > 0)", async () => {
      renderModal();
      await waitFor(() => {
        // greeting-prompt appears in both Recent and All sections
        expect(screen.getAllByText("greeting-prompt").length).toBeGreaterThan(
          0,
        );
        expect(screen.getByText("summary-prompt")).toBeInTheDocument();
        // prompt-3 has no handle, so it shows the id
        expect(screen.getByText("prompt-3")).toBeInTheDocument();
        // draft-prompt has version 0, should not appear
        expect(screen.queryByText("draft-prompt")).not.toBeInTheDocument();
      });
    });

    it("shows model name as secondary text", async () => {
      renderModal();
      await waitFor(() => {
        // gpt-4 appears twice (in Recent and All Prompts for greeting-prompt)
        expect(screen.getAllByText("gpt-4").length).toBeGreaterThan(0);
        expect(screen.getByText("gpt-3.5-turbo")).toBeInTheDocument();
      });
    });

    it("shows Recent section for recently used prompts", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("Recent")).toBeInTheDocument();
      });
    });

    it("shows All Prompts section", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("All Prompts")).toBeInTheDocument();
      });
    });
  });

  describe("Search functionality", () => {
    it("filters prompts by handle", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getAllByText("greeting-prompt").length).toBeGreaterThan(
          0,
        );
      });

      const searchInput = screen.getByPlaceholderText("Search prompts...");
      await user.type(searchInput, "greeting");

      await waitFor(() => {
        expect(screen.getAllByText("greeting-prompt").length).toBeGreaterThan(
          0,
        );
        expect(screen.queryByText("summary-prompt")).not.toBeInTheDocument();
      });
    });

    it("shows Search Results section when searching", async () => {
      const user = userEvent.setup();
      renderModal();

      const searchInput = screen.getByPlaceholderText("Search prompts...");
      await user.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Search Results")).toBeInTheDocument();
        expect(screen.queryByText("All Prompts")).not.toBeInTheDocument();
      });
    });

    it("shows no results message when no matches", async () => {
      const user = userEvent.setup();
      renderModal();

      const searchInput = screen.getByPlaceholderText("Search prompts...");
      await user.type(searchInput, "nonexistent");

      await waitFor(() => {
        expect(screen.getByText("No prompts found")).toBeInTheDocument();
      });
    });
  });

  describe("Selection", () => {
    it("calls onSelect with prompt id when clicking a prompt", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getAllByText("greeting-prompt").length).toBeGreaterThan(
          0,
        );
      });

      // Click the first instance (in Recent section)
      const rows = screen.getAllByTestId("prompt-row-prompt-1");
      await user.click(rows[0]!);

      expect(mockOnSelect).toHaveBeenCalledWith("prompt-1");
    });

    it("closes modal after selection", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getAllByText("greeting-prompt").length).toBeGreaterThan(
          0,
        );
      });

      const rows = screen.getAllByTestId("prompt-row-prompt-1");
      await user.click(rows[0]!);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Create new prompt", () => {
    it("shows create new prompt button", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("Create new prompt")).toBeInTheDocument();
      });
    });

    it("calls onCreateNew when clicking create button", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getByTestId("picker-create-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("picker-create-button"));

      expect(mockOnCreateNew).toHaveBeenCalled();
    });
  });

  describe("when no prompts exist", () => {
    it("shows empty state", async () => {
      const { useAllPromptsForProject } = await import(
        "~/prompts/hooks/useAllPromptsForProject"
      );
      vi.mocked(useAllPromptsForProject).mockReturnValue({
        data: [],
        isLoading: false,
      } as unknown as ReturnType<typeof useAllPromptsForProject>);

      renderModal();

      await waitFor(() => {
        expect(screen.getByText("No prompts yet")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Create a prompt to test your scenario against a prompt configuration.",
          ),
        ).toBeInTheDocument();
      });
    });
  });

  describe("when loading", () => {
    it("shows spinner", async () => {
      const { useAllPromptsForProject } = await import(
        "~/prompts/hooks/useAllPromptsForProject"
      );
      vi.mocked(useAllPromptsForProject).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as unknown as ReturnType<typeof useAllPromptsForProject>);

      renderModal();

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });
});
