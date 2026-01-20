/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "~/utils/api";
import { AgentPickerModal } from "../AgentPickerModal";

// Mock dependencies
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
  }),
}));

vi.mock("~/hooks/useRecentTargets", () => ({
  useRecentTargets: () => ({
    recentPromptIds: [],
    recentAgentIds: ["agent-1"],
    addRecentPrompt: vi.fn(),
    addRecentAgent: vi.fn(),
  }),
}));

// Mock agents data
const mockAgents = [
  {
    id: "agent-1",
    name: "Production API",
    type: "http",
  },
  {
    id: "agent-2",
    name: "Staging API",
    type: "http",
  },
  {
    id: "agent-3",
    name: "Code Agent",
    type: "code", // Not HTTP, should be filtered out
  },
];

// Mock the API
vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getAll: {
        useQuery: vi.fn(() => ({
          data: mockAgents,
          isLoading: false,
        })),
      },
    },
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AgentPickerModal", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    // Reset the mock to default state
    vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
      data: mockAgents,
      isLoading: false,
    } as ReturnType<typeof api.agents.getAll.useQuery>);
  });

  afterEach(() => {
    cleanup();
  });

  const renderModal = (props = {}) => {
    return render(
      <AgentPickerModal
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
        expect(screen.getByText("Run with Agent")).toBeInTheDocument();
      });
    });

    it("shows search input", async () => {
      renderModal();
      await waitFor(() => {
        expect(
          screen.getByPlaceholderText("Search agents..."),
        ).toBeInTheDocument();
      });
    });

    it("shows only HTTP agents", async () => {
      renderModal();
      await waitFor(() => {
        // Production API appears in both Recent and All sections
        expect(screen.getAllByText("Production API").length).toBeGreaterThan(0);
        expect(screen.getByText("Staging API")).toBeInTheDocument();
        // Code agent should be filtered out
        expect(screen.queryByText("Code Agent")).not.toBeInTheDocument();
      });
    });

    it("shows agent type as secondary text", async () => {
      renderModal();
      await waitFor(() => {
        // Both HTTP agents should show "HTTP" as the type
        const httpLabels = screen.getAllByText("HTTP");
        expect(httpLabels.length).toBeGreaterThan(0);
      });
    });

    it("shows Recent section for recently used agents", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("Recent")).toBeInTheDocument();
      });
    });

    it("shows All Agents section", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("All Agents")).toBeInTheDocument();
      });
    });
  });

  describe("Search functionality", () => {
    it("filters agents by name", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getAllByText("Production API").length).toBeGreaterThan(0);
      });

      const searchInput = screen.getByPlaceholderText("Search agents...");
      await user.type(searchInput, "Production");

      await waitFor(() => {
        expect(screen.getAllByText("Production API").length).toBeGreaterThan(0);
        expect(screen.queryByText("Staging API")).not.toBeInTheDocument();
      });
    });

    it("shows Search Results section when searching", async () => {
      const user = userEvent.setup();
      renderModal();

      const searchInput = screen.getByPlaceholderText("Search agents...");
      await user.type(searchInput, "test");

      await waitFor(() => {
        expect(screen.getByText("Search Results")).toBeInTheDocument();
        expect(screen.queryByText("All Agents")).not.toBeInTheDocument();
      });
    });

    it("shows no results message when no matches", async () => {
      const user = userEvent.setup();
      renderModal();

      const searchInput = screen.getByPlaceholderText("Search agents...");
      await user.type(searchInput, "nonexistent");

      await waitFor(() => {
        expect(screen.getByText("No agents found")).toBeInTheDocument();
      });
    });
  });

  describe("Selection", () => {
    it("calls onSelect with agent id when clicking an agent", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getAllByText("Production API").length).toBeGreaterThan(0);
      });

      // Click the first instance (in Recent section)
      const rows = screen.getAllByTestId("agent-row-agent-1");
      await user.click(rows[0]!);

      expect(mockOnSelect).toHaveBeenCalledWith("agent-1");
    });

    it("closes modal after selection", async () => {
      const user = userEvent.setup();
      renderModal();

      await waitFor(() => {
        expect(screen.getAllByText("Production API").length).toBeGreaterThan(0);
      });

      const rows = screen.getAllByTestId("agent-row-agent-1");
      await user.click(rows[0]!);

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Create new agent", () => {
    it("shows create new agent button", async () => {
      renderModal();
      await waitFor(() => {
        expect(screen.getByText("Create new agent")).toBeInTheDocument();
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

  describe("when no HTTP agents exist", () => {
    it("shows empty state", async () => {
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: [{ id: "code-only", name: "Code Agent", type: "code" }],
        isLoading: false,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderModal();

      await waitFor(() => {
        expect(screen.getByText("No agents yet")).toBeInTheDocument();
        expect(
          screen.getByText(
            "Create an agent to test your scenario against an external HTTP endpoint.",
          ),
        ).toBeInTheDocument();
      });
    });

    it("shows empty state when agent list is empty", async () => {
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderModal();

      await waitFor(() => {
        expect(screen.getByText("No agents yet")).toBeInTheDocument();
      });
    });
  });

  describe("when loading", () => {
    it("shows spinner", async () => {
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderModal();

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });
});
