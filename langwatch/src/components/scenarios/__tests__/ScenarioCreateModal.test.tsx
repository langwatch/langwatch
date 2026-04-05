/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi, beforeEach } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { ScenarioCreateModal } from "../ScenarioCreateModal";

// Mock useOrganizationTeamProject — use vi.fn so per-test overrides are possible
let mockProject: { id: string; slug: string; defaultModel?: string } = {
  id: "project-123",
  slug: "my-project",
};

const mockOrganization = {
  id: "org-123",
  name: "Test Org",
};

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: mockProject,
    organization: mockOrganization,
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

// Mock upgrade modal store (used by useLicenseEnforcement)
const mockOpenUpgradeModal = vi.fn();
vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: unknown) => {
    if (typeof selector === "function") {
      return (selector as (state: { open: typeof mockOpenUpgradeModal }) => unknown)({ open: mockOpenUpgradeModal });
    }
    return { open: mockOpenUpgradeModal };
  },
}));

// Mock tRPC - no create mutation needed since modal no longer creates
vi.mock("~/utils/api", () => ({
  api: {
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({
          data: [],
          isLoading: false,
        }),
      },
    },
    licenseEnforcement: {
      checkLimit: {
        useQuery: () => ({
          data: { allowed: true, current: 0, max: 100 },
          isLoading: false,
        }),
      },
      reportLimitBlocked: {
        useMutation: () => ({ mutate: vi.fn() }),
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

// Mock ModelSelector hooks — use a vi.fn so per-test overrides are possible
const mockUseModelSelectionOptions = vi.fn().mockReturnValue({
  modelOption: { isDisabled: false },
});

vi.mock("../../ModelSelector", () => ({
  allModelOptions: [],
  useModelSelectionOptions: (..._args: unknown[]) => mockUseModelSelectionOptions(),
}));

// Create variables for mock that can be modified per test
let mockHasEnabledProviders = true;
let mockProviders: Record<string, { enabled: boolean }> = {};

// Mock useModelProvidersSettings
vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    hasEnabledProviders: mockHasEnabledProviders,
    providers: mockProviders,
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
  afterEach(() => {
    vi.restoreAllMocks();
  });

  beforeEach(() => {
    vi.clearAllMocks();
    mockToasterCreate.mockClear();
    // Reset to having providers by default
    mockHasEnabledProviders = true;
    mockProviders = { openai: { enabled: true } };
    // Reset project to default (no Azure)
    mockProject = { id: "project-123", slug: "my-project" };
    // Reset model selection to enabled (default OpenAI model in registry)
    mockUseModelSelectionOptions.mockReturnValue({ modelOption: { isDisabled: false } });

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
    it("opens drawer with generated content without creating a DB record", async () => {
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

      // Verify drawer was opened with generated data as initialFormData (no scenarioId)
      await waitFor(() => {
        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "scenarioEditor",
          expect.objectContaining({
            initialFormData: mockGeneratedScenario,
          }),
          { resetStack: true }
        );
      });
    });
  });

  describe("when user clicks Skip", () => {
    it("opens drawer with empty initial data without creating a DB record", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      fireEvent.click(within(dialog).getByRole("button", { name: /i'll write it myself/i }));

      await waitFor(() => {
        expect(mockOpenDrawer).toHaveBeenCalledWith(
          "scenarioEditor",
          expect.objectContaining({
            initialFormData: {
              name: "",
              situation: "",
              criteria: [],
              labels: [],
            },
          }),
          { resetStack: true }
        );
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

  describe("when no model providers are configured", () => {
    beforeEach(() => {
      vi.clearAllMocks();
      mockToasterCreate.mockClear();
      // Set to no providers
      mockHasEnabledProviders = false;
      mockProviders = {};
    });

    it("shows warning message instead of form", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).getByText("No model provider configured")).toBeInTheDocument();
    });

    it("hides textarea", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).queryByRole("textbox")).not.toBeInTheDocument();
    });

    it("hides generate button", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).queryByRole("button", { name: /generate with ai/i })).not.toBeInTheDocument();
    });
  });
});

describe("when default model is Azure deployment not in registry", () => {
  describe("when azure provider IS enabled", () => {
    beforeEach(() => {
      mockProject = { id: "project-123", slug: "my-project", defaultModel: "azure/my-gpt4-deployment" };
      // modelOption=undefined because azure deployment is not in the static registry
      mockUseModelSelectionOptions.mockReturnValue({ modelOption: undefined });
      // Azure provider IS enabled
      mockHasEnabledProviders = true;
      mockProviders = { azure: { enabled: true } };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: mockGeneratedScenario }),
      });
    });

    it("does not show No model provider configured warning", () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      expect(within(dialog).queryByText("No model provider configured")).not.toBeInTheDocument();
    });

    it("proceeds with generation when description is provided", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test azure scenario" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /generate with ai/i }));

      await waitFor(() => {
        expect(global.fetch).toHaveBeenCalled();
      });
    });
  });

  describe("when azure provider is NOT enabled but another provider is", () => {
    beforeEach(() => {
      mockProject = { id: "project-123", slug: "my-project", defaultModel: "azure/my-gpt4-deployment" };
      // modelOption=undefined because azure deployment is not in the static registry
      mockUseModelSelectionOptions.mockReturnValue({ modelOption: undefined });
      // hasEnabledProviders=true simulates: OpenAI is configured, but Azure is NOT configured
      // yet the project's default model is azure/my-gpt4-deployment
      mockHasEnabledProviders = true;
      mockProviders = { openai: { enabled: true } };

      global.fetch = vi.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ scenario: mockGeneratedScenario }),
      });
    });

    it("shows API key error when generating because azure provider is not configured", async () => {
      render(
        <ScenarioCreateModal open={true} onClose={vi.fn()} />,
        { wrapper: Wrapper }
      );

      const dialog = getDialogContent();
      const textarea = within(dialog).getByRole("textbox");
      fireEvent.change(textarea, { target: { value: "Test azure scenario" } });
      fireEvent.click(within(dialog).getByRole("button", { name: /generate with ai/i }));

      await waitFor(() => {
        expect(within(dialog).getByText(/api keys not configured/i)).toBeInTheDocument();
      });
    });
  });
});


describe("when default model is Azure and provider is NOT configured at all", () => {
  beforeEach(() => {
    mockProject = { id: "project-123", slug: "my-project", defaultModel: "azure/my-gpt4-deployment" };
    mockUseModelSelectionOptions.mockReturnValue({ modelOption: undefined });
    mockHasEnabledProviders = false;
    mockProviders = {};
  });

  it("shows No model provider configured warning", () => {
    render(
      <ScenarioCreateModal open={true} onClose={vi.fn()} />,
      { wrapper: Wrapper }
    );

    const dialog = getDialogContent();
    expect(within(dialog).getByText("No model provider configured")).toBeInTheDocument();
  });
});
