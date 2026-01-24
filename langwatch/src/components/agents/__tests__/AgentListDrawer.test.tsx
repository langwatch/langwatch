/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { api } from "~/utils/api";
import { AgentListDrawer } from "../AgentListDrawer";

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
    closeDrawer: vi.fn(),
    openDrawer: vi.fn(),
    drawerOpen: vi.fn(() => false),
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

// Mock agents data
const mockAgents = [
  {
    id: "agent-1",
    name: "GPT-4 Assistant",
    type: "signature",
    config: { model: "openai/gpt-4o" },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-10T10:00:00Z"),
    updatedAt: new Date("2025-01-15T10:00:00Z"),
  },
  {
    id: "agent-2",
    name: "Python Processor",
    type: "code",
    config: { code: "def execute(input): return input" },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-05T10:00:00Z"),
    updatedAt: new Date("2025-01-12T10:00:00Z"),
  },
  {
    id: "agent-3",
    name: "Custom Pipeline",
    type: "workflow",
    config: {},
    workflowId: "workflow-123",
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-01T10:00:00Z"),
    updatedAt: new Date("2025-01-08T10:00:00Z"),
  },
  {
    id: "agent-4",
    name: "My API Agent",
    type: "http",
    config: {
      url: "https://api.example.com/chat",
      method: "POST",
      bodyTemplate: '{"input": "{{input}}"}',
    },
    workflowId: null,
    projectId: "test-project-id",
    archivedAt: null,
    createdAt: new Date("2025-01-02T10:00:00Z"),
    updatedAt: new Date("2025-01-16T10:00:00Z"),
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
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AgentListDrawer", () => {
  const mockOnSelect = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnCreateNew = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <AgentListDrawer
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
    it("shows Choose Agent header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Choose Agent")).toBeInTheDocument();
      });
    });

    it("shows New Agent button at top", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("new-agent-button")).toBeInTheDocument();
        expect(screen.getByText("New Agent")).toBeInTheDocument();
      });
    });

    it("shows agent list with all agents", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("GPT-4 Assistant")).toBeInTheDocument();
        expect(screen.getByText("Python Processor")).toBeInTheDocument();
        expect(screen.getByText("Custom Pipeline")).toBeInTheDocument();
      });
    });

    it("shows agent type labels", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Prompt")).toBeInTheDocument();
        expect(screen.getByText("Code")).toBeInTheDocument();
        expect(screen.getByText("Workflow")).toBeInTheDocument();
      });
    });

    it("shows HTTP agent with correct type label", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("My API Agent")).toBeInTheDocument();
        expect(screen.getByText("HTTP")).toBeInTheDocument();
      });
    });
  });

  describe("Selection", () => {
    it("calls onSelect when clicking an agent", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("GPT-4 Assistant")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("agent-card-agent-1"));

      expect(mockOnSelect).toHaveBeenCalledWith(
        expect.objectContaining({
          id: "agent-1",
          name: "GPT-4 Assistant",
          type: "signature",
        }),
      );
    });

    it("closes drawer after selection", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("GPT-4 Assistant")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("agent-card-agent-1"));

      expect(mockOnClose).toHaveBeenCalled();
    });
  });

  describe("Create new agent", () => {
    it("calls onCreateNew when clicking New Agent button", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("new-agent-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("new-agent-button"));

      expect(mockOnCreateNew).toHaveBeenCalled();
    });
  });

  describe("Loading state", () => {
    it("shows spinner when loading", async () => {
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe("Empty state", () => {
    it("shows empty message when no agents", async () => {
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("No agents yet")).toBeInTheDocument();
        expect(
          screen.getByText("Create your first agent to get started"),
        ).toBeInTheDocument();
      });
    });

    it("shows create first agent button in empty state", async () => {
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByTestId("create-first-agent-button"),
        ).toBeInTheDocument();
      });
    });

    it("calls onCreateNew when clicking create first agent", async () => {
      const user = userEvent.setup();
      vi.mocked(api.agents.getAll.useQuery).mockReturnValue({
        data: [],
        isLoading: false,
      } as ReturnType<typeof api.agents.getAll.useQuery>);

      renderDrawer();

      await waitFor(() => {
        expect(
          screen.getByTestId("create-first-agent-button"),
        ).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("create-first-agent-button"));

      expect(mockOnCreateNew).toHaveBeenCalled();
    });
  });
});
