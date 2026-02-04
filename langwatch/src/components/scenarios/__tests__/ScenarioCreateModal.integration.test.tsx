/**
 * @vitest-environment jsdom
 */
import { describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ScenarioCreateModal } from "../ScenarioCreateModal";

// Mock useOrganizationTeamProject
const mockProject = {
  id: "project-123",
  slug: "my-project",
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: mockProject,
  }),
}));

// Mock useDrawer
const mockOpenDrawer = vi.fn();
vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    openDrawer: mockOpenDrawer,
    closeDrawer: vi.fn(),
    drawerOpen: vi.fn().mockReturnValue(false),
  }),
}));

// Mock tRPC
const mockMutateAsync = vi.fn();
vi.mock("~/utils/api", () => ({
  api: {
    scenarios: {
      create: {
        useMutation: () => ({
          mutateAsync: mockMutateAsync,
          isPending: false,
        }),
      },
    },
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({
          data: [],
          isLoading: false,
        }),
      },
    },
    useContext: () => ({
      scenarios: {
        getAll: {
          invalidate: vi.fn(),
        },
      },
    }),
  },
}));

// Mock ModelSelector hooks
vi.mock("../../ModelSelector", () => ({
  allModelOptions: [],
  useModelSelectionOptions: () => ({
    modelOption: { isDisabled: false },
  }),
}));

// Create a variable for mock that can be modified per test
let mockHasEnabledProviders = true;

// Mock useModelProvidersSettings
vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    hasEnabledProviders: mockHasEnabledProviders,
    isLoading: false,
  }),
}));

// Mock toaster
const mockToasterCreate = vi.fn();
vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: (args: unknown) => mockToasterCreate(args),
  },
}));

// Mock fetch for AI generation API
const mockGeneratedScenario = {
  name: "Generated Scenario",
  situation: "A generated situation",
  criteria: ["Criterion 1", "Criterion 2"],
  labels: ["support"],
};

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

/**
 * Helper to get the dialog content element.
 */
function getDialogContent() {
  const dialogs = screen.getAllByRole("dialog");
  return dialogs[dialogs.length - 1]!;
}

describe("<ScenarioCreateModal/>", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ id: "new-scenario-id", name: "Generated Scenario" });
    mockToasterCreate.mockClear();
    // Reset to having providers by default
    mockHasEnabledProviders = true;

    // Mock fetch for AI generation
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ scenario: mockGeneratedScenario }),
    });
  });

  describe("when open", () => {
    it("displays scenario title", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Create new scenario")).toBeInTheDocument();
    });

    it("displays scenario placeholder text", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(
        within(dialog).getByPlaceholderText(
          "Explain your agent, its goals and what behavior you want to test."
        )
      ).toBeInTheDocument();
    });

    it("displays Customer Support example pill", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Customer Support")).toBeInTheDocument();
    });

    it("displays RAG Q&A example pill", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("RAG Q&A")).toBeInTheDocument();
    });

    it("displays Tool-calling Agent example pill", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Tool-calling Agent")).toBeInTheDocument();
    });

    it("displays close button", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(
        within(dialog).getByRole("button", { name: /close/i })
      ).toBeInTheDocument();
    });
  });

  describe("when user clicks Customer Support pill", () => {
    it("fills textarea with template", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByText("Customer Support"));

      const textarea = within(dialog).getByRole("textbox");
      expect(textarea).toHaveValue(
        "A customer support agent that handles complaints. Test an angry customer who was charged twice and wants a refund."
      );
    });
  });

  describe("when user clicks RAG Q&A pill", () => {
    it("fills textarea with template", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByText("RAG Q&A"));

      const textarea = within(dialog).getByRole("textbox");
      expect(textarea).toHaveValue(
        "A knowledge bot that answers questions from documentation. Test a question that requires combining info from multiple sources."
      );
    });
  });

  describe("when user clicks Tool-calling Agent pill", () => {
    it("fills textarea with template", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByText("Tool-calling Agent"));

      const textarea = within(dialog).getByRole("textbox");
      expect(textarea).toHaveValue(
        "An agent that uses tools to complete tasks. Test a request that requires calling multiple tools in sequence."
      );
    });
  });

  describe("when user clicks Generate with AI", () => {
    it("calls AI generation API and creates scenario with generated content", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "My test scenario description" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /generate with ai/i }));

      // Verify AI generation API was called
      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalledWith(
          "/api/scenario/generate",
          expect.objectContaining({
            method: "POST",
            body: JSON.stringify({
              prompt: "My test scenario description",
              currentScenario: null,
              projectId: "project-123",
            }),
          })
        );
      });

      // Verify scenario was created with generated content
      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          projectId: "project-123",
          name: "Generated Scenario",
          situation: "A generated situation",
          criteria: ["Criterion 1", "Criterion 2"],
          labels: ["support"],
        });
      });

      // Verify drawer was opened (without initialPrompt since content is already generated)
      await waitFor(() => {
        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "scenarioEditor",
          expect.objectContaining({
            urlParams: {
              scenarioId: "new-scenario-id",
            },
          }),
          { resetStack: true }
        );
      });
    });
  });

  describe("when user clicks Skip", () => {
    it("creates scenario and opens drawer without initialPrompt", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /i'll write it myself/i }));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          projectId: "project-123",
          name: "Untitled",
          situation: "",
          criteria: [],
          labels: [],
        });
      });

      await waitFor(() => {
        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "scenarioEditor",
          expect.objectContaining({
            urlParams: {
              scenarioId: "new-scenario-id",
            },
          }),
          { resetStack: true }
        );
      });
    });
  });

  describe("when scenario creation fails", () => {
    it("shows error toast with message", async () => {
      const errorMessage = "Network error: Failed to connect";
      mockMutateAsync.mockRejectedValueOnce(new Error(errorMessage));

      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /i'll write it myself/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith({
          title: "Failed to create scenario",
          description: errorMessage,
          type: "error",
          meta: { closable: true },
        });
      });

      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it("shows generic error for non-Error exceptions", async () => {
      mockMutateAsync.mockRejectedValueOnce("Unknown failure");

      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /i'll write it myself/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith({
          title: "Failed to create scenario",
          description: "An unexpected error occurred",
          type: "error",
          meta: { closable: true },
        });
      });
    });
  });

  describe("when open is true", () => {
    it("renders dialog in open state", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialogs = screen.queryAllByRole("dialog");
      const openDialogs = dialogs.filter(
        (d: HTMLElement) => d.getAttribute("data-state") === "open"
      );
      expect(openDialogs.length).toBeGreaterThan(0);
    });
  });
});

describe("<ScenarioCreateModal/>", () => {
  describe("when no model providers are configured", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockMutateAsync.mockResolvedValue({ id: "new-scenario-id", name: "Generated Scenario" });
      mockToasterCreate.mockClear();
      // Set to no providers
      mockHasEnabledProviders = false;
    });

    it("shows warning message instead of form", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialogs = screen.queryAllByRole("dialog");
      const dialog = dialogs[dialogs.length - 1]!;

      // Should show warning message when no providers configured
      expect(within(dialog).getByText("No model provider configured")).toBeInTheDocument();
    });

    it("hides textarea", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialogs = screen.queryAllByRole("dialog");
      const dialog = dialogs[dialogs.length - 1]!;

      expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("hides generate button", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialogs = screen.queryAllByRole("dialog");
      const dialog = dialogs[dialogs.length - 1]!;

      expect(within(dialog).queryByRole("button", { name: /generate with ai/i })).not.toBeInTheDocument();
    });
  });
});
