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
    useContext: () => ({
      scenarios: {
        getAll: {
          invalidate: vi.fn(),
        },
      },
    }),
  },
}));

// Mock toaster
const mockToasterCreate = vi.fn();
vi.mock("../../ui/toaster", () => ({
  toaster: {
    create: (args: unknown) => mockToasterCreate(args),
  },
}));

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
    mockMutateAsync.mockResolvedValue({ id: "new-scenario-id", name: "Untitled" });
    mockToasterCreate.mockClear();
  });

  describe("configuration", () => {
    it("displays the correct title", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Create new scenario")).toBeInTheDocument();
    });

    it("displays the correct placeholder text", () => {
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

    it("displays Customer Support example template", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Customer Support")).toBeInTheDocument();
    });

    it("displays RAG Q&A example template", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("RAG Q&A")).toBeInTheDocument();
    });

    it("displays Tool-calling Agent example template", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("Tool-calling Agent")).toBeInTheDocument();
    });

    it("fills textarea with Customer Support template when clicked", () => {
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

    it("fills textarea with RAG Q&A template when clicked", () => {
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

    it("fills textarea with Tool-calling Agent template when clicked", () => {
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

  describe("onGenerate behavior", () => {
    it("creates a new scenario and opens drawer with initialPrompt", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "My test scenario description" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /generate with ai/i }));

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
              initialPrompt: "My test scenario description",
            },
          }),
          { resetStack: true }
        );
      });
    });
  });

  describe("onSkip behavior", () => {
    it("creates a new scenario and opens drawer without initialPrompt", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /skip/i }));

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

    it("shows error toast when scenario creation fails", async () => {
      const errorMessage = "Network error: Failed to connect";
      mockMutateAsync.mockRejectedValueOnce(new Error(errorMessage));

      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /skip/i }));

      await waitFor(() => {
        expect(mockToasterCreate).toHaveBeenCalledWith({
          title: "Failed to create scenario",
          description: errorMessage,
          type: "error",
          meta: { closable: true },
        });
      });

      // Should not open drawer when creation fails
      expect(mockOpenDrawer).not.toHaveBeenCalled();
    });

    it("shows generic error message for non-Error exceptions", async () => {
      mockMutateAsync.mockRejectedValueOnce("Unknown failure");

      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /skip/i }));

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

  describe("modal visibility", () => {
    it("passes open prop to AICreateModal", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialogs = screen.queryAllByRole("dialog");
      const openDialogs = dialogs.filter(
        (d) => d.getAttribute("data-state") === "open"
      );
      expect(openDialogs.length).toBeGreaterThan(0);
    });

    it("has a close button visible in idle state", () => {
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
});
