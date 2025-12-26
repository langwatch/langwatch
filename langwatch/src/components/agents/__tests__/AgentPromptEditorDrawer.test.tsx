/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentPromptEditorDrawer } from "../AgentPromptEditorDrawer";
import { api } from "~/utils/api";

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

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
  }),
  getComplexProps: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
    modelProviders: {},
  }),
}));

// Mock existing agent for editing
const mockAgent = {
  id: "agent-1",
  name: "Test Agent",
  type: "signature",
  config: {
    llm: { model: "openai/gpt-4o", temperature: 0.7, maxTokens: 1000 },
    prompt: "You are a helpful assistant.",
    messages: [{ role: "user", content: "{{input}}" }],
    inputs: [{ identifier: "input", type: "str" }],
    outputs: [{ identifier: "output", type: "str" }],
  },
  workflowId: null,
  projectId: "test-project-id",
  archivedAt: null,
  createdAt: new Date("2025-01-10T10:00:00Z"),
  updatedAt: new Date("2025-01-15T10:00:00Z"),
};

// Mock create mutation
const mockCreateMutate = vi.fn();
const mockUpdateMutate = vi.fn();

// Mock the API
vi.mock("~/utils/api", () => ({
  api: {
    agents: {
      getById: {
        useQuery: vi.fn(() => ({
          data: null,
          isLoading: false,
        })),
      },
      create: {
        useMutation: vi.fn(() => ({
          mutate: mockCreateMutate,
          isPending: false,
        })),
      },
      update: {
        useMutation: vi.fn(() => ({
          mutate: mockUpdateMutate,
          isPending: false,
        })),
      },
    },
    llmModelCost: {
      getModelLimits: {
        useQuery: vi.fn(() => ({
          data: { maxTokens: 4096, contextWindow: 8192 },
          isLoading: false,
        })),
      },
    },
    modelProvider: {
      getAllForProject: {
        useQuery: vi.fn(() => ({
          data: [],
          isLoading: false,
        })),
      },
    },
    useContext: vi.fn(() => ({
      agents: {
        getAll: { invalidate: vi.fn() },
        getById: { invalidate: vi.fn() },
      },
    })),
  },
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AgentPromptEditorDrawer", () => {
  const mockOnSave = vi.fn();
  const mockOnClose = vi.fn();
  const mockOnBack = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (props = {}) => {
    return render(
      <AgentPromptEditorDrawer
        open={true}
        onClose={mockOnClose}
        onSave={mockOnSave}
        onBack={mockOnBack}
        {...props}
      />,
      { wrapper: Wrapper }
    );
  };

  describe("Basic rendering - New Agent", () => {
    it("shows New Prompt Agent header", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("New Prompt Agent")).toBeInTheDocument();
      });
    });

    it("shows back button", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      });
    });

    it("shows agent name input", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("agent-name-input")).toBeInTheDocument();
      });
    });

    it("shows model selector", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("Model")).toBeInTheDocument();
      });
    });

    it("shows system prompt field", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByText("System Prompt")).toBeInTheDocument();
      });
    });

    it("shows Create Agent button", async () => {
      renderDrawer();
      await waitFor(() => {
        expect(screen.getByTestId("save-agent-button")).toBeInTheDocument();
        expect(screen.getByText("Create Agent")).toBeInTheDocument();
      });
    });
  });

  describe("Basic rendering - Edit Agent", () => {
    beforeEach(() => {
      vi.mocked(api.agents.getById.useQuery).mockReturnValue({
        data: mockAgent,
        isLoading: false,
      } as ReturnType<typeof api.agents.getById.useQuery>);
    });

    it("shows Edit Prompt Agent header when editing", async () => {
      renderDrawer({ agentId: "agent-1" });
      await waitFor(() => {
        expect(screen.getByText("Edit Prompt Agent")).toBeInTheDocument();
      });
    });

    it("shows Save Changes button when editing", async () => {
      renderDrawer({ agentId: "agent-1" });
      await waitFor(() => {
        expect(screen.getByText("Save Changes")).toBeInTheDocument();
      });
    });

    it("loads agent name from existing agent", async () => {
      renderDrawer({ agentId: "agent-1" });
      await waitFor(() => {
        const nameInput = screen.getByTestId("agent-name-input") as HTMLInputElement;
        expect(nameInput.value).toBe("Test Agent");
      });
    });
  });

  describe("Navigation", () => {
    it("calls onBack when clicking back button", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("back-button")).toBeInTheDocument();
      });

      await user.click(screen.getByTestId("back-button"));

      expect(mockOnBack).toHaveBeenCalled();
    });
  });

  describe("Form submission - Create", () => {
    it("calls create mutation with form data when saving new agent", async () => {
      const user = userEvent.setup();

      // Mock successful mutation
      vi.mocked(api.agents.create.useMutation).mockReturnValue({
        mutate: mockCreateMutate,
        isPending: false,
      } as unknown as ReturnType<typeof api.agents.create.useMutation>);

      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("agent-name-input")).toBeInTheDocument();
      });

      // Clear and enter name
      const nameInput = screen.getByTestId("agent-name-input");
      await user.clear(nameInput);
      await user.type(nameInput, "My New Agent");

      // Click save
      await user.click(screen.getByTestId("save-agent-button"));

      expect(mockCreateMutate).toHaveBeenCalledWith(
        expect.objectContaining({
          projectId: "test-project-id",
          name: "My New Agent",
          type: "signature",
          config: expect.objectContaining({
            llm: expect.any(Object),
            inputs: expect.any(Array),
            outputs: expect.any(Array),
          }),
        })
      );
    });
  });

  describe("Loading state", () => {
    it("shows spinner when loading existing agent", async () => {
      vi.mocked(api.agents.getById.useQuery).mockReturnValue({
        data: undefined,
        isLoading: true,
      } as ReturnType<typeof api.agents.getById.useQuery>);

      renderDrawer({ agentId: "agent-1" });

      await waitFor(() => {
        const spinner = document.querySelector(".chakra-spinner");
        expect(spinner).toBeInTheDocument();
      });
    });
  });

  describe("Validation", () => {
    it("disables save button when name is empty", async () => {
      renderDrawer();

      await waitFor(() => {
        const saveButton = screen.getByTestId("save-agent-button");
        expect(saveButton).toBeDisabled();
      });
    });

    it("enables save button when name is provided", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("agent-name-input")).toBeInTheDocument();
      });

      const nameInput = screen.getByTestId("agent-name-input");
      await user.type(nameInput, "Valid Name");

      await waitFor(() => {
        const saveButton = screen.getByTestId("save-agent-button");
        expect(saveButton).not.toBeDisabled();
      });
    });
  });
});
