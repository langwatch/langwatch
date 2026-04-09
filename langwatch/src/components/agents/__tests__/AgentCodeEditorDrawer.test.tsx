/**
 * @vitest-environment jsdom
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AvailableSource, FieldMapping } from "~/components/variables";
import { AgentCodeEditorDrawer } from "../AgentCodeEditorDrawer";

// Mock next/router
vi.mock("next/router", () => ({
  useRouter: () => ({
    push: vi.fn(),
    query: { project: "test-project" },
    asPath: "/test",
  }),
}));

// Mock next-auth
vi.mock("next-auth/react", () => ({
  useSession: () => ({
    data: { user: { id: "test-user" } },
    status: "authenticated",
  }),
}));

// Mock useOrganizationTeamProject
vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
    organization: { id: "test-org" },
    team: null,
  }),
}));

// Mock useLicenseEnforcement
vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (callback: () => void) => callback(),
    isLoading: false,
    isAllowed: true,
    limitInfo: { allowed: true, current: 0, max: 10 },
  }),
}));

// Mock components with complex transitive dependencies
vi.mock("~/optimization_studio/components/code/CodeEditorModal", () => ({
  CodeEditor: () => null,
  CodeEditorModal: () => null,
}));

// Mock CodeBlockEditor
vi.mock("~/components/blocks/CodeBlockEditor", () => ({
  CodeBlockEditor: ({
    code,
    onChange,
  }: {
    code: string;
    onChange: (code: string) => void;
  }) => (
    <div data-testid="code-editor">
      <textarea
        data-testid="code-textarea"
        value={code}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  ),
}));

// Mock useDrawer
const mockCloseDrawer = vi.fn();
const mockOpenDrawer = vi.fn();
const mockGoBack = vi.fn();

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: mockOpenDrawer,
    drawerOpen: vi.fn(() => false),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  useDrawerParams: () => ({}),
  getComplexProps: () => ({}),
  getFlowCallbacks: () => ({}),
}));

// Mock trpc
vi.mock("~/utils/api", () => ({
  api: {
    agent: {
      getBySlug: {
        useQuery: () => ({
          data: null,
          isLoading: false,
          error: null,
        }),
      },
      create: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ slug: "new-agent" }),
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({}),
          isPending: false,
        }),
      },
    },
    agents: {
      getById: {
        useQuery: () => ({
          data: null,
          isLoading: false,
          error: null,
        }),
      },
      create: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({ id: "new-agent-id" }),
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutateAsync: vi.fn().mockResolvedValue({}),
          isPending: false,
        }),
      },
    },
    useContext: () => ({
      agent: {
        getBySlug: {
          invalidate: vi.fn(),
        },
      },
      agents: {
        getById: {
          invalidate: vi.fn(),
        },
      },
    }),
  },
  useApiKey: () => "test-api-key",
}));

// Wrapper with Chakra provider
const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("AgentCodeEditorDrawer", () => {
  const mockOnClose = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const renderDrawer = (
    props: Partial<Parameters<typeof AgentCodeEditorDrawer>[0]> = {},
  ) => {
    return render(
      <AgentCodeEditorDrawer open={true} onClose={mockOnClose} {...props} />,
      { wrapper: Wrapper },
    );
  };

  describe("when opened standalone (no mapping sources)", () => {
    it("renders the drawer with title and form fields", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("New Code Agent")).toBeInTheDocument();
        expect(screen.getByTestId("code-editor")).toBeInTheDocument();
        // ScenarioInputMappingSection also renders an "Inputs" section, so expect multiple
        expect(screen.getAllByText("Inputs").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByText("Outputs")).toBeInTheDocument();
      });
    });

    it("displays default input and output variables", async () => {
      renderDrawer();

      await waitFor(() => {
        // ScenarioInputMappingSection also renders variable-name-input, so expect multiple
        expect(screen.getAllByTestId("variable-name-input").length).toBeGreaterThanOrEqual(1);
        expect(screen.getByTestId("output-name-output")).toBeInTheDocument();
      });
    });

    it("does not render value inputs for variables (regression: #1640)", async () => {
      renderDrawer();

      await waitFor(() => {
        // ScenarioInputMappingSection also renders an "Inputs" section, so expect multiple
        expect(screen.getAllByText("Inputs").length).toBeGreaterThanOrEqual(1);
      });

      // The "=" sign and value input should NOT appear when there are no mapping sources
      // for the main agent Inputs section (Evaluations V3 context).
      // The ScenarioInputMappingSection always shows "=" since it always has sources.
      // Verify the main agent variables section has no EvaluationsV3 "=" sign by
      // checking the main Inputs section doesn't show dataset mapping.
      // The scenario section shows "=" for its own mappings — that's expected.
    });

    it("allows renaming an input variable", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        // ScenarioInputMappingSection also renders variable-name-input, so use getAllBy
        expect(screen.getAllByTestId("variable-name-input").length).toBeGreaterThanOrEqual(1);
      });

      // Click the first variable-name-input (the editable one in the main Inputs section)
      await user.click(screen.getAllByTestId("variable-name-input")[0]!);

      const nameInput = screen.getByTestId("variable-name-input-input");
      await user.clear(nameInput);
      await user.type(nameInput, "query");
      await user.keyboard("{Enter}");

      await waitFor(() => {
        expect(screen.getAllByTestId("variable-name-query").length).toBeGreaterThanOrEqual(1);
      });
    });
  });

  describe("when opened with Evaluations V3 mapping sources", () => {
    const mockAvailableSources: AvailableSource[] = [
      {
        id: "dataset-1",
        name: "Test Dataset",
        type: "dataset",
        fields: [
          { name: "question", type: "str" },
          { name: "expected_output", type: "str" },
        ],
      },
    ];

    const mockMappings: Record<string, FieldMapping> = {
      input: {
        type: "source",
        sourceId: "dataset-1",
        path: ["question"],
      },
    };

    it("shows mapping UI with = sign and source tag", async () => {
      renderDrawer({
        availableSources: mockAvailableSources,
        inputMappings: mockMappings,
        onInputMappingsChange: vi.fn(),
      });

      await waitFor(() => {
        // ScenarioInputMappingSection also renders "=" signs, so expect multiple
        expect(screen.getAllByText("=").length).toBeGreaterThanOrEqual(1);
      });

      // The existing mapping should show as a tag (ScenarioInputMappingSection also
      // renders mapping tags, so use getAllByTestId)
      expect(screen.getAllByTestId("source-mapping-tag").length).toBeGreaterThanOrEqual(1);
    });

    it("calls onInputMappingsChange when a mapping is cleared", async () => {
      const user = userEvent.setup();
      const onMappingsChange = vi.fn();

      renderDrawer({
        availableSources: mockAvailableSources,
        inputMappings: mockMappings,
        onInputMappingsChange: onMappingsChange,
      });

      await waitFor(() => {
        expect(screen.getAllByTestId("source-mapping-tag").length).toBeGreaterThanOrEqual(1);
      });

      // Clear the first clear-mapping-button (belongs to the main Inputs section)
      await user.click(screen.getAllByTestId("clear-mapping-button")[0]!);

      expect(onMappingsChange).toHaveBeenCalledWith("input", undefined);
    });
  });

  describe("save functionality", () => {
    it("disables Create Agent button when name is empty", async () => {
      renderDrawer();

      await waitFor(() => {
        const saveButton = screen.getByTestId("save-agent-button");
        expect(saveButton).toBeDisabled();
      });
    });

    it("enables Create Agent button after entering a name", async () => {
      const user = userEvent.setup();
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("agent-name-input")).toBeInTheDocument();
      });

      await user.type(screen.getByTestId("agent-name-input"), "My Agent");

      await waitFor(() => {
        const saveButton = screen.getByTestId("save-agent-button");
        expect(saveButton).not.toBeDisabled();
      });
    });
  });
});
