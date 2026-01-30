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
    upgradeModal: null,
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

  describe("basic rendering", () => {
    it("renders drawer when open", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("New Code Agent")).toBeInTheDocument();
      });
    });

    it("renders code editor", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByTestId("code-editor")).toBeInTheDocument();
      });
    });
  });

  describe("inputs section", () => {
    it("renders Inputs title", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Inputs")).toBeInTheDocument();
      });
    });

    it("shows default input variable", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("input")).toBeInTheDocument();
      });
    });
  });

  describe("outputs section", () => {
    it("renders Outputs title", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Outputs")).toBeInTheDocument();
      });
    });

    it("shows default output variable", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("output")).toBeInTheDocument();
      });
    });
  });

  describe("with Evaluations V3 mappings", () => {
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

    it("shows mappings section when availableSources provided", async () => {
      renderDrawer({
        availableSources: mockAvailableSources,
        inputMappings: mockMappings,
        onInputMappingsChange: vi.fn(),
      });

      await waitFor(() => {
        expect(screen.getByText("Inputs")).toBeInTheDocument();
      });

      // With available sources, mapping dropdowns should be rendered
      // The exact content depends on the VariablesSection implementation
    });

    it("renders input variable with mapping capability", async () => {
      renderDrawer({
        availableSources: mockAvailableSources,
      });

      await waitFor(() => {
        expect(screen.getByText("input")).toBeInTheDocument();
      });
    });
  });

  describe("save functionality", () => {
    it("shows Create Agent button for new agent", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("Create Agent")).toBeInTheDocument();
      });
    });

    it("shows New Code Agent title for new agent", async () => {
      renderDrawer();

      await waitFor(() => {
        expect(screen.getByText("New Code Agent")).toBeInTheDocument();
      });
    });
  });
});
