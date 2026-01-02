/**
 * @vitest-environment jsdom
 *
 * Integration test for prompt editor local changes in evaluations context.
 * Tests that:
 * 1. Flow callbacks are properly set when editing a runner's prompt
 * 2. Changes to prompts are saved locally via onLocalConfigChange callback
 * 3. Closing the drawer does NOT prompt for save when onLocalConfigChange is set
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, cleanup } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import { forwardRef } from "react";

import { PromptEditorDrawer } from "~/components/prompts/PromptEditorDrawer";
import { useEvaluationsV3Store } from "../hooks/useEvaluationsV3Store";

// Mock rich-textarea since jsdom doesn't support getBoundingClientRect/elementFromPoint properly
vi.mock("rich-textarea", () => ({
  RichTextarea: forwardRef<
    HTMLTextAreaElement,
    {
      value?: string;
      onChange?: (e: React.ChangeEvent<HTMLTextAreaElement>) => void;
      onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
      onSelectionChange?: (pos: { focused: boolean }) => void;
      placeholder?: string;
      disabled?: boolean;
      autoHeight?: boolean;
      style?: React.CSSProperties;
      children?: (value: string) => React.ReactNode;
      onFocus?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
      onBlur?: (e: React.FocusEvent<HTMLTextAreaElement>) => void;
    }
  >(({ children, autoHeight, onSelectionChange, ...props }, ref) => {
    return <textarea ref={ref} {...props} />;
  }),
}));

// Track router state
let mockRouterQuery: Record<string, string> = {};
const mockPush = vi.fn();

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: mockRouterQuery,
    asPath: "/test",
    push: mockPush,
    replace: mockPush,
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: "test-project", slug: "test-project" },
  }),
}));

// Complete mock prompt data matching VersionedPrompt schema
const mockPromptData = {
  id: "prompt-1",
  name: "test-prompt",
  handle: "test-prompt",
  scope: "PROJECT",
  version: 1,
  versionId: "version-1",
  versionCreatedAt: new Date(),
  model: "gpt-4",
  temperature: 0.7,
  maxTokens: 1000,
  prompt: "You are a helpful assistant.",
  projectId: "test-project",
  messages: [{ role: "system", content: "You are a helpful assistant." }],
  inputs: [{ identifier: "input", type: "str" }],
  outputs: [{ identifier: "output", type: "str" }],
};

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      prompts: {
        getByIdOrHandle: { invalidate: vi.fn() },
        getAllPromptsForProject: { invalidate: vi.fn() },
      },
    }),
    prompts: {
      getByIdOrHandle: {
        useQuery: ({ idOrHandle }: { idOrHandle: string }) => ({
          data: idOrHandle ? mockPromptData : null,
          isLoading: false,
        }),
      },
      create: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      update: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      updateHandle: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      restoreVersion: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      delete: {
        useMutation: () => ({ mutate: vi.fn(), isPending: false }),
      },
      versions: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
      getAllVersionsForPrompt: {
        useQuery: () => ({ data: [], isLoading: false }),
      },
    },
    llmModelCost: {
      getModelLimits: {
        useQuery: () => ({
          data: { maxTokens: 128000, inputTokenCost: 0.01, outputTokenCost: 0.03 },
          isLoading: false,
        }),
      },
    },
    modelProvider: {
      getAllForProject: {
        useQuery: () => ({
          data: [{ provider: "openai", enabled: true }],
          isLoading: false,
        }),
      },
    },
  },
}));

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("Prompt Editor Local Changes", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockRouterQuery = {};
    useEvaluationsV3Store.getState().reset();

    // Set up a runner with a prompt
    useEvaluationsV3Store.setState({
      runners: [
        {
          id: "runner-1",
          type: "prompt",
          name: "test-prompt",
          promptId: "prompt-1",
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          mappings: {},
          localPromptConfig: undefined,
        },
      ],
    });

    // Mock window.confirm to track if it's called
    vi.spyOn(window, "confirm").mockImplementation(() => true);
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  describe("when onLocalConfigChange callback is provided (evaluations context)", () => {
    it("does NOT show save confirmation when closing with changes", async () => {
      const user = userEvent.setup();
      const mockOnLocalConfigChange = vi.fn();

      mockRouterQuery = {
        "drawer.open": "promptEditor",
        "drawer.promptId": "prompt-1",
        "drawer.runnerId": "runner-1",
      };

      // Render PromptEditorDrawer with onLocalConfigChange (as CurrentDrawer would via flow callbacks)
      render(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-1"
          onLocalConfigChange={mockOnLocalConfigChange}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(
        () => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Make a change to trigger "unsaved changes" state
      const textareas = screen.getAllByRole("textbox");
      if (textareas[0]) {
        await user.type(textareas[0], " modified");
      }

      // Close the drawer
      const closeButton = screen.getByLabelText(/close/i);
      await user.click(closeButton);

      // KEY ASSERTION: window.confirm should NOT be called
      // because onLocalConfigChange is provided (evaluations context)
      expect(window.confirm).not.toHaveBeenCalled();
    }, 10000);

    it("calls onLocalConfigChange when changes are made", async () => {
      const user = userEvent.setup();
      const mockOnLocalConfigChange = vi.fn();

      mockRouterQuery = {
        "drawer.open": "promptEditor",
        "drawer.promptId": "prompt-1",
      };

      render(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-1"
          onLocalConfigChange={mockOnLocalConfigChange}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(
        () => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Type something to trigger local config change
      const textareas = screen.getAllByRole("textbox");
      if (textareas[0]) {
        await user.type(textareas[0], " modified");
      }

      // Wait for debounced callback
      await waitFor(
        () => {
          expect(mockOnLocalConfigChange).toHaveBeenCalled();
        },
        { timeout: 2000 },
      );

      // Verify the callback was called with a local config object
      const lastCall = mockOnLocalConfigChange.mock.calls[mockOnLocalConfigChange.mock.calls.length - 1];
      expect(lastCall?.[0]).toBeDefined();
      expect(lastCall?.[0]).toHaveProperty("messages");
    }, 10000);
  });

  describe("when onLocalConfigChange is NOT provided (standalone prompt editing)", () => {
    it("shows save confirmation when closing with unsaved changes", async () => {
      const user = userEvent.setup();

      mockRouterQuery = {
        "drawer.open": "promptEditor",
      };

      // Render without onLocalConfigChange (like when editing from prompts page)
      render(
        <PromptEditorDrawer
          open={true}
          // No onLocalConfigChange - standalone mode
        />,
        { wrapper: Wrapper },
      );

      await waitFor(
        () => {
        expect(screen.getByText("New Prompt")).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Type something to create unsaved changes
      const textareas = screen.getAllByRole("textbox");
      if (textareas[0]) {
        await user.type(textareas[0], "some content");
      }

      // Close the drawer
      const closeButton = screen.getByLabelText(/close/i);
      await user.click(closeButton);

      // KEY ASSERTION: window.confirm SHOULD be called
      // because onLocalConfigChange is NOT provided
      expect(window.confirm).toHaveBeenCalled();
    }, 10000);
  });

  describe("flow callbacks integration", () => {
    it("updateRunner is called when onLocalConfigChange fires with config", async () => {
      const user = userEvent.setup();

      // Create a mock that simulates what EvaluationsV3Table does
      const updateRunner = useEvaluationsV3Store.getState().updateRunner;
      const mockOnLocalConfigChange = vi.fn((localConfig) => {
        if (localConfig) {
          updateRunner("runner-1", { localPromptConfig: localConfig });
        }
      });

      mockRouterQuery = {
        "drawer.open": "promptEditor",
        "drawer.promptId": "prompt-1",
      };

      render(
        <PromptEditorDrawer
          open={true}
          promptId="prompt-1"
          onLocalConfigChange={mockOnLocalConfigChange}
        />,
        { wrapper: Wrapper },
      );

      await waitFor(
        () => {
        expect(screen.getByText("Edit Prompt")).toBeInTheDocument();
        },
        { timeout: 5000 },
      );

      // Type to trigger changes
      const textareas = screen.getAllByRole("textbox");
      if (textareas[0]) {
        await user.type(textareas[0], " modified");
      }

      // Wait for the store to be updated
      await waitFor(
        () => {
          const runner = useEvaluationsV3Store
            .getState()
            .runners.find((r) => r.id === "runner-1");
          expect(runner?.localPromptConfig).toBeDefined();
        },
        { timeout: 2000 },
      );
    }, 10000);
  });
});
