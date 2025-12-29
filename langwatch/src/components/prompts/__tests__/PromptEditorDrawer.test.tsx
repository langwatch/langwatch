/**
 * @vitest-environment jsdom
 */
import { render, screen, cleanup, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { useForm, FormProvider } from "react-hook-form";
import type { ReactNode } from "react";

// All mocks need to be set up before any imports
const mockCloseDrawer = vi.fn();
const mockGoBack = vi.fn();

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
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: mockGoBack,
  }),
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", defaultModel: "openai/gpt-4o" },
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

// Mock usePromptConfigForm to return a real form
const mockDefaultFormValues = {
  isNew: true,
  version: {
    versionId: "",
    configData: {
      llm: { model: "openai/gpt-4o", temperature: 0.7 },
      messages: [{ role: "system", content: "" }],
      inputs: [{ identifier: "input", type: "str" }],
      outputs: [{ identifier: "output", type: "str" }],
    },
    commitMessage: "",
  },
};

vi.mock("~/prompts/hooks/usePromptConfigForm", () => ({
  usePromptConfigForm: ({ initialConfigValues }: { initialConfigValues?: unknown }) => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const methods = useForm({
      defaultValues: initialConfigValues ?? mockDefaultFormValues,
    });
    return { methods };
  },
}));

const mockPromptDataWithMessages = {
  id: "prompt-123",
  handle: "test-prompt",
  version: 3,
  versionId: "version-456",
  prompt: "You are a helpful assistant.",
  messages: [],
  inputs: [{ identifier: "question", type: "str" }],
  outputs: [{ identifier: "answer", type: "str" }],
  configData: {
    model: "openai/gpt-4o",
    prompt: "You are a helpful assistant.",
    messages: [],
    inputs: [{ identifier: "question", type: "str" }],
    outputs: [{ identifier: "answer", type: "str" }],
    temperature: 0.7,
    max_tokens: 1000,
    llm: {
      model: "openai/gpt-4o",
      temperature: 0.7,
    },
  },
};

const mockGetByIdOrHandle = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    prompts: {
      getByIdOrHandle: {
        useQuery: () => mockGetByIdOrHandle(),
      },
      create: {
        useMutation: () => ({
          mutate: mockCreate,
          isPending: false,
        }),
      },
      update: {
        useMutation: () => ({
          mutate: mockUpdate,
          isPending: false,
        }),
      },
    },
    useContext: () => ({
      prompts: {
        getAllPromptsForProject: { invalidate: vi.fn() },
        getByIdOrHandle: { invalidate: vi.fn() },
      },
    }),
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

// Mock the form components since they're complex
vi.mock("~/prompts/forms/fields/ModelSelectFieldMini", () => ({
  ModelSelectFieldMini: () => (
    <button data-testid="model-select">gpt-4o</button>
  ),
}));

vi.mock(
  "~/prompts/forms/prompt-config-form/components/VersionHistoryButton",
  () => ({
    VersionHistoryButton: ({
      hasUnsavedChanges,
      onDiscardChanges,
    }: {
      configId: string;
      hasUnsavedChanges?: boolean;
      onDiscardChanges?: () => void;
    }) => (
      <div data-testid="version-history-button">
        {hasUnsavedChanges && (
          <button
            data-testid="discard-local-changes-button"
            onClick={onDiscardChanges}
          >
            Discard
          </button>
        )}
      </div>
    ),
  })
);

vi.mock(
  "~/prompts/forms/fields/message-history-fields/PromptMessagesField",
  () => ({
    PromptMessagesField: () => <div data-testid="messages-field">Messages</div>,
  })
);

vi.mock("~/prompts/forms/fields/PromptConfigVersionFieldGroup", () => ({
  InputsFieldGroup: () => <div data-testid="inputs-field">Inputs</div>,
  OutputsFieldGroup: () => <div data-testid="outputs-field">Outputs</div>,
}));

// Mock buildDefaultFormValues
vi.mock("~/prompts/utils/buildDefaultFormValues", () => ({
  buildDefaultFormValues: () => mockDefaultFormValues,
}));

// Mock the conversion utils
vi.mock("~/prompts/utils/llmPromptConfigUtils", () => ({
  formValuesToTriggerSaveVersionParams: vi.fn((values) => values),
  versionedPromptToPromptConfigFormValuesWithSystemMessage: vi.fn((prompt) => ({
    isNew: false,
    version: {
      versionId: prompt.versionId,
      configData: {
        llm: prompt.configData?.llm ?? { model: "openai/gpt-4o", temperature: 0.7 },
        messages: [{ role: "system", content: prompt.prompt ?? "" }],
        inputs: prompt.inputs ?? [],
        outputs: prompt.outputs ?? [],
      },
      commitMessage: "",
    },
  })),
}));

// Mock areFormValuesEqual - start with default implementation
const mockAreFormValuesEqual = vi.fn(() => true);
vi.mock("~/prompts/utils/areFormValuesEqual", () => ({
  areFormValuesEqual: () => mockAreFormValuesEqual(),
}));

// Import after mocks
import { PromptEditorDrawer } from "../PromptEditorDrawer";

const renderWithProviders = (ui: React.ReactElement) => {
  return render(<ChakraProvider value={defaultSystem}>{ui}</ChakraProvider>);
};

describe("PromptEditorDrawer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockGetByIdOrHandle.mockReturnValue({ data: undefined, isLoading: false });
    // Default: form values equal saved values (no changes)
    mockAreFormValuesEqual.mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
  });

  describe("Create mode", () => {
    it("renders New Prompt header when creating", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByText("New Prompt")).toBeInTheDocument();
    });

    it("shows prompt handle input field", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("prompt-handle-input")).toBeInTheDocument();
    });

    it("shows model selector in header", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("model-select")).toBeInTheDocument();
    });

    it("shows messages field", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("messages-field")).toBeInTheDocument();
    });

    it("shows inputs field group", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("inputs-field")).toBeInTheDocument();
    });

    it("shows outputs field group", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("outputs-field")).toBeInTheDocument();
    });

    it("shows Saved button initially (no changes)", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
        "Saved"
      );
    });

    it("does not show version history button in create mode", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(
        screen.queryByTestId("version-history-button")
      ).not.toBeInTheDocument();
    });

    it("Save button is disabled when no handle entered", () => {
      renderWithProviders(<PromptEditorDrawer open={true} />);
      expect(screen.getByTestId("save-prompt-button")).toBeDisabled();
    });
  });

  describe("Edit mode", () => {
    beforeEach(() => {
      mockGetByIdOrHandle.mockReturnValue({
        data: mockPromptDataWithMessages,
        isLoading: false,
      });
    });

    it("renders Edit Prompt header when editing", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
    });

    it("does not show handle input field when editing", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(
        screen.queryByTestId("prompt-handle-input")
      ).not.toBeInTheDocument();
    });

    it("shows version history button when editing", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(screen.getByTestId("version-history-button")).toBeInTheDocument();
    });

    it("shows Saved button when no changes made", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
        "Saved"
      );
    });
  });

  describe("Local config persistence (evaluations context)", () => {
    const mockOnLocalConfigChange = vi.fn();

    beforeEach(() => {
      mockGetByIdOrHandle.mockReturnValue({
        data: mockPromptDataWithMessages,
        isLoading: false,
      });
      mockOnLocalConfigChange.mockClear();
    });

    it("does not show warning dialog when onLocalConfigChange is provided", async () => {
      const mockConfirm = vi.spyOn(window, "confirm").mockReturnValue(false);

      renderWithProviders(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-123"
          onLocalConfigChange={mockOnLocalConfigChange}
        />
      );

      // Close drawer - should not call confirm since onLocalConfigChange is provided
      const closeButton = screen.getByRole("button", { name: /close/i });
      await userEvent.click(closeButton);

      // Should NOT have called window.confirm
      expect(mockConfirm).not.toHaveBeenCalled();

      mockConfirm.mockRestore();
    });

    it("loads initialLocalConfig when provided", () => {
      const initialLocalConfig = {
        llm: { model: "openai/gpt-4", temperature: 0.5 },
        messages: [{ role: "system" as const, content: "Modified content" }],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      renderWithProviders(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-123"
          initialLocalConfig={initialLocalConfig}
          onLocalConfigChange={mockOnLocalConfigChange}
        />
      );

      // The drawer should render with the prompt loaded
      expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
    });
  });

  describe("Discard changes", () => {
    const mockOnLocalConfigChange = vi.fn();

    beforeEach(() => {
      mockGetByIdOrHandle.mockReturnValue({
        data: mockPromptDataWithMessages,
        isLoading: false,
      });
      mockOnLocalConfigChange.mockClear();
    });

    it("shows discard button in version history when there are unsaved changes", () => {
      // Simulate unsaved changes
      mockAreFormValuesEqual.mockReturnValue(false);

      const initialLocalConfig = {
        llm: { model: "openai/gpt-4", temperature: 0.5 },
        messages: [{ role: "system" as const, content: "Modified content" }],
        inputs: [{ identifier: "input", type: "str" as const }],
        outputs: [{ identifier: "output", type: "str" as const }],
      };

      renderWithProviders(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-123"
          initialLocalConfig={initialLocalConfig}
          onLocalConfigChange={mockOnLocalConfigChange}
        />
      );

      // Since areFormValuesEqual returns false, hasUnsavedChanges is true
      // the discard button should be visible in version history
      expect(
        screen.getByTestId("discard-local-changes-button")
      ).toBeInTheDocument();
    });

    it("does not show discard button when no unsaved changes", () => {
      renderWithProviders(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-123"
          onLocalConfigChange={mockOnLocalConfigChange}
        />
      );

      // No initialLocalConfig means no unsaved changes
      expect(
        screen.queryByTestId("discard-local-changes-button")
      ).not.toBeInTheDocument();
    });

    it("discard button not shown for new prompts", () => {
      // Reset mocks for new prompt scenario
      mockAreFormValuesEqual.mockReturnValue(true);
      mockGetByIdOrHandle.mockReturnValue({ data: undefined, isLoading: false });

      renderWithProviders(
        <PromptEditorDrawer
          open={true}
          onLocalConfigChange={mockOnLocalConfigChange}
        />
      );

      // New prompts don't have version history, so no version history button at all
      expect(
        screen.queryByTestId("version-history-button")
      ).not.toBeInTheDocument();
      // And no discard button
      expect(
        screen.queryByTestId("discard-local-changes-button")
      ).not.toBeInTheDocument();
    });
  });

  describe("Header structure", () => {
    beforeEach(() => {
      mockGetByIdOrHandle.mockReturnValue({
        data: mockPromptDataWithMessages,
        isLoading: false,
      });
    });

    it("has model selector in header", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(screen.getByTestId("model-select")).toBeInTheDocument();
    });

    it("has version history button in header when editing", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(screen.getByTestId("version-history-button")).toBeInTheDocument();
    });

    it("has save button in header", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      expect(screen.getByTestId("save-prompt-button")).toBeInTheDocument();
    });

    it("does not have save button in footer", () => {
      renderWithProviders(
        <PromptEditorDrawer open={true} promptId="prompt-123" />
      );
      // The drawer should not have a footer with save button
      // Only one save button should exist (in header)
      const saveButtons = screen.getAllByTestId("save-prompt-button");
      expect(saveButtons).toHaveLength(1);
    });
  });
});
