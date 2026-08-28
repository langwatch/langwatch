/**
 * @vitest-environment jsdom
 *
 * Opening a seeded prompt and touching nothing must not report a modified
 * prompt. The dirty flag is what tells a reader whether their work is safe, and
 * a drawer that claims changes on an untouched prompt teaches people to dismiss
 * the warning, which is exactly when it stops protecting anything.
 *
 * This file mocks BOUNDARIES only. `usePromptConfigForm`, the versioned-prompt
 * converter and `areFormValuesEqual` are the real ones, because the defect
 * lived in what those three do to each other: the form settles on values the
 * server document never carried, and the comparison then reads unlike shapes as
 * an edit.
 *
 * @see specs/prompts/prompt-editor-dirty-state.feature
 */
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useFormContext } from "react-hook-form";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockCloseDrawer = vi.fn();

vi.mock("~/utils/compat/next-router", () => ({
  useRouter: () => ({ push: vi.fn(), query: {}, asPath: "/test" }),
}));

vi.mock("~/hooks/useDrawer", () => ({
  useDrawer: () => ({
    closeDrawer: mockCloseDrawer,
    openDrawer: vi.fn(),
    canGoBack: false,
    goBack: vi.fn(),
  }),
  getComplexProps: () => ({}),
  useDrawerParams: () => ({}),
  getFlowCallbacks: () => undefined,
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project-id", defaultModel: "openai/gpt-4o" },
    projectId: "test-project-id",
    organization: { id: "test-org-id" },
    team: { id: "test-team-id" },
  }),
}));

vi.mock("~/hooks/useModelProvidersSettings", () => ({
  useModelProvidersSettings: () => ({
    modelMetadata: {
      "openai/gpt-4o": {
        name: "gpt-4o",
        contextLength: 128000,
        maxCompletionTokens: 16384,
      },
    },
    isLoading: false,
  }),
}));

vi.mock("~/hooks/useLicenseEnforcement", () => ({
  useLicenseEnforcement: () => ({
    checkAndProceed: (callback: () => void) => callback(),
    isLoading: false,
    isAllowed: true,
    limitInfo: { allowed: true, current: 2, max: 5 },
  }),
}));

vi.mock("~/stores/upgradeModalStore", () => ({
  useUpgradeModalStore: (selector: (state: { open: () => void }) => unknown) =>
    typeof selector === "function"
      ? selector({ open: vi.fn() })
      : { open: vi.fn() },
}));

vi.mock(
  "~/optimization_studio/components/code/workflow-code-editor.transport",
  async (importOriginal) => ({
    ...(await importOriginal<
      typeof import("~/optimization_studio/components/code/workflow-code-editor.transport")
    >()),
    CodeEditor: () => null,
  }),
);

vi.mock("@langwatch/workflow-web", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@langwatch/workflow-web")>()),
  TypeLabel: ({ type }: { type: string }) => <span>{type}</span>,
}));

// The model picker reaches for provider and cost queries this file has no
// interest in. It reads the live form value so a real edit is still visible.
vi.mock("~/prompts/forms/fields/ModelSelectFieldMini", () => ({
  ModelSelectFieldMini: () => {
    // eslint-disable-next-line react-hooks/rules-of-hooks
    const { watch } = useFormContext();
    const model = watch("version.configData.llm.model");
    return <button data-testid="model-select">{model ?? "(no model)"}</button>;
  },
}));

vi.mock("~/components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

vi.mock("~/hooks/prompts/usePromptHandleCheck", () => ({
  usePromptHandleCheck: () => ({
    checkHandleUniqueness: vi.fn().mockResolvedValue(true),
  }),
}));

/**
 * A prompt as the seeder writes one: a system prompt, one input, one output,
 * and no demonstrations. The form derives demonstration columns from the inputs
 * and outputs, which is the derived value the stored document never carries.
 */
const SEEDED_PROMPT = {
  id: "prompt-seeded",
  name: "Seeded Prompt",
  handle: "seeded-prompt",
  scope: "PROJECT" as const,
  version: 1,
  versionId: "version-seeded",
  versionCreatedAt: new Date("2026-01-01T00:00:00.000Z"),
  prompt: "You are a helpful assistant.",
  messages: [],
  inputs: [{ identifier: "question", type: "str" as const }],
  outputs: [{ identifier: "answer", type: "str" as const }],
  model: "openai/gpt-4o",
  temperature: 0.7,
  maxTokens: 4096,
  demonstrations: { inline: { records: {}, columnTypes: [] } },
  parameters: {},
};

const mockUpdate = vi.fn();

vi.mock("~/utils/api", () => ({
  api: {
    publicEnv: {
      useQuery: () => ({ data: { IS_SAAS: false }, isLoading: false }),
    },
    modelProvider: {
      getResolvedDefault: {
        useQuery: () => ({
          data: { model: "openai/gpt-4o", source: "test", scope: "PROJECT" },
          isLoading: false,
        }),
      },
    },
    llmModelCost: {
      getModelLimits: {
        useQuery: () => ({
          data: { maxOutputTokens: 16384, maxContextTokens: 128000 },
          isLoading: false,
        }),
      },
    },
    prompts: {
      getByIdOrHandle: {
        useQuery: () => ({ data: SEEDED_PROMPT, isLoading: false }),
      },
      getAllVersionsForPrompt: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      create: { useMutation: () => ({ mutate: vi.fn(), isPending: false }) },
      update: { useMutation: () => ({ mutate: mockUpdate, isPending: false }) },
      updateHandle: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
    },
    useUtils: () => ({
      prompts: {
        getAllPromptsForProject: { invalidate: vi.fn() },
        getByIdOrHandle: { invalidate: vi.fn(), fetch: vi.fn() },
      },
    }),
  },
}));

// Import after mocks
import { PromptEditorDrawer } from "../PromptEditorDrawer";

const renderDrawer = () =>
  render(
    <ChakraProvider value={defaultSystem}>
      <PromptEditorDrawer open={true} promptId={SEEDED_PROMPT.id} />
    </ChakraProvider>,
  );

describe("PromptEditorDrawer dirty state", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.spyOn(window, "confirm").mockReturnValue(true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("given a seeded prompt opened and not edited", () => {
    /** @scenario "An untouched prompt is not reported as modified" */
    it("shows no modified dot", async () => {
      renderDrawer();

      await screen.findByText("seeded-prompt");
      // The dot follows the same state as the save label, so waiting for the
      // settled label is what makes the absence of the dot mean something.
      await waitFor(() => {
        expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
          "Saved",
        );
      });

      expect(screen.queryByTestId("unsaved-changes-indicator")).toBeNull();
    });

    /** @scenario "An untouched prompt is not reported as modified" */
    it("keeps the save affordance out of its dirty state", async () => {
      renderDrawer();

      await screen.findByText("seeded-prompt");
      await waitFor(() => {
        expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
          "Saved",
        );
      });
    });

    /** @scenario "Closing an untouched prompt warns about nothing" */
    it("closes with no unsaved-changes warning", async () => {
      renderDrawer();

      await screen.findByText("seeded-prompt");
      await waitFor(() => {
        expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
          "Saved",
        );
      });

      await userEvent.click(screen.getByRole("button", { name: "Close" }));
      expect(window.confirm).not.toHaveBeenCalled();
    });
  });

  describe("given one character typed into the prompt", () => {
    /** @scenario "A real edit is still reported as modified" */
    it("reports the prompt as modified", async () => {
      renderDrawer();

      await screen.findByText("seeded-prompt");
      await waitFor(() => {
        expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
          "Saved",
        );
      });

      const promptField = screen.getByPlaceholderText(
        "Enter your prompt...",
      ) as HTMLTextAreaElement;
      fireEvent.change(promptField, {
        target: { value: `${promptField.value}!` },
      });

      await waitFor(() => {
        expect(
          screen.getByTestId("unsaved-changes-indicator"),
        ).toBeInTheDocument();
      });
      expect(screen.getByTestId("save-prompt-button")).toHaveTextContent(
        "Update to v2",
      );
    });
  });
});
