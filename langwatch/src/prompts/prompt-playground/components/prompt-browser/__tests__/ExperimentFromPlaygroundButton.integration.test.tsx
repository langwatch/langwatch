/**
 * @vitest-environment jsdom
 *
 * Integration tests for creating an experiment from the prompt playground.
 * Tests that:
 * 1. The Experiment button appears next to Compare
 * 2. Dialog shows correct message for single/multiple prompts
 * 3. Experiment is created with prompts as targets
 * 4. Unsaved changes result in localPromptConfig on targets
 */

import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import { ChakraProvider, defaultSystem } from "@chakra-ui/react";
import type { DeepPartial } from "react-hook-form";

import {
  clearStoreInstances,
  getStoreForTesting,
  type TabData,
} from "../../../prompt-playground-store/DraggableTabsBrowserStore";
import type { PromptConfigFormValues } from "~/prompts/types";
import { ExperimentFromPlaygroundButton } from "../ExperimentFromPlaygroundButton";

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => {
      store[key] = value;
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    },
  };
})();

vi.stubGlobal("localStorage", localStorageMock);

const TEST_PROJECT_ID = "test-project-123";
const mockRouterPush = vi.fn();

vi.mock("next/router", () => ({
  useRouter: () => ({
    query: { project: "test-project" },
    push: mockRouterPush,
    replace: vi.fn(),
    asPath: "/test-project/prompts",
  }),
}));

vi.mock("~/hooks/useOrganizationTeamProject", () => ({
  useOrganizationTeamProject: () => ({
    project: { id: TEST_PROJECT_ID, slug: "test-project" },
    projectId: TEST_PROJECT_ID,
    hasPermission: () => true,
  }),
}));

// Track mutation calls
type FieldMapping = {
  type: "source" | "value";
  source?: "dataset" | "target";
  sourceId?: string;
  sourceField?: string;
  value?: string;
};

let saveExperimentMutateCall:
  | {
      projectId: string;
      experimentId: undefined;
      state: {
        targets: Array<{
          id: string;
          type: string;
          promptId?: string;
          localPromptConfig?: {
            llm: { model: string };
            messages: Array<{ role: string; content: string }>;
          };
          mappings?: Record<string, Record<string, FieldMapping>>;
        }>;
      };
    }
  | undefined;

// Mock saved prompts - can be overridden per test
let mockSavedPrompts: Record<string, unknown> = {};

vi.mock("~/utils/api", () => ({
  api: {
    useContext: () => ({
      experiments: {
        getAllForEvaluationsList: { invalidate: vi.fn() },
      },
    }),
    // useQueries for fetching multiple saved prompts
    useQueries: (queryFn: (t: unknown) => unknown[]) => {
      const mockTrpc = {
        prompts: {
          getByIdOrHandle: (
            params: { idOrHandle: string; projectId: string; versionId?: string },
            _options: unknown
          ) => ({
            queryKey: ["prompts", params.idOrHandle],
            queryFn: () => mockSavedPrompts[params.idOrHandle] ?? null,
          }),
        },
      };
      const queries = queryFn(mockTrpc);
      // Return mock query results
      return queries.map((q: unknown) => {
        const query = q as { queryKey: string[] };
        return {
          data: mockSavedPrompts[query.queryKey[1] ?? ""] ?? null,
          isLoading: false,
        };
      });
    },
    experiments: {
      saveEvaluationsV3: {
        useMutation: (callbacks?: { onSuccess?: (data: { slug: string }) => void }) => ({
          mutate: (
            params: NonNullable<typeof saveExperimentMutateCall>
          ) => {
            saveExperimentMutateCall = params;
            callbacks?.onSuccess?.({ slug: "test-slug-123" });
          },
          isPending: false,
        }),
      },
    },
    prompts: {
      getByIdOrHandle: {
        useQuery: () => ({
          data: null,
          isLoading: false,
        }),
      },
    },
  },
}));

/**
 * Helper to create a minimal TabData object for testing
 */
const createTabData = (
  overrides?: Partial<{
    title: string;
    configId: string;
    handle: string;
    versionId: string;
    currentValues: DeepPartial<PromptConfigFormValues>;
  }>
): TabData => ({
  chat: {
    initialMessagesFromSpanData: [],
  },
  form: {
    currentValues: {
      configId: overrides?.configId,
      handle: overrides?.handle ?? null,
      scope: "PROJECT",
      versionMetadata: overrides?.versionId
        ? { versionId: overrides.versionId }
        : undefined,
      version: {
        configData: {
          messages: [{ role: "system", content: "You are helpful" }],
          inputs: [{ identifier: "input", type: "str" }],
          outputs: [{ identifier: "output", type: "str" }],
          llm: { model: "openai/gpt-4o" },
        },
      },
      ...overrides?.currentValues,
    },
  },
  meta: {
    title: overrides?.title ?? null,
    versionNumber: 1,
    scope: "PROJECT",
  },
  variableValues: {},
});

const Wrapper = ({ children }: { children: React.ReactNode }) => (
  <ChakraProvider value={defaultSystem}>{children}</ChakraProvider>
);

describe("ExperimentFromPlaygroundButton", () => {
  let store: ReturnType<typeof getStoreForTesting>;

  beforeEach(() => {
    localStorage.clear();
    clearStoreInstances();
    store = getStoreForTesting(TEST_PROJECT_ID);
    saveExperimentMutateCall = undefined;
    mockSavedPrompts = {};
    mockRouterPush.mockClear();
  });

  afterEach(() => {
    cleanup();
    clearStoreInstances();
    localStorage.clear();
  });

  describe("button visibility", () => {
    it("renders Experiment button with Flask icon", () => {
      store.getState().addTab({ data: createTabData({ title: "Test Prompt" }) });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      expect(screen.getByText("Experiment")).toBeInTheDocument();
    });

    it("is disabled when no tabs are open", () => {
      // Store has no tabs initially
      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      const button = screen.getByRole("button", { name: /experiment/i });
      expect(button).toBeDisabled();
    });
  });

  describe("dialog content", () => {
    it("shows singular message for single prompt", async () => {
      const user = userEvent.setup();
      store.getState().addTab({
        data: createTabData({ title: "My Prompt", configId: "prompt-1" }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/create new experiment with this prompt/i)
        ).toBeInTheDocument();
      });
    });

    it("shows plural message for multiple prompts", async () => {
      const user = userEvent.setup();
      // Add two tabs in same window
      store.getState().addTab({
        data: createTabData({ title: "Prompt 1", configId: "prompt-1" }),
      });
      store.getState().addTab({
        data: createTabData({ title: "Prompt 2", configId: "prompt-2" }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));

      await waitFor(() => {
        expect(
          screen.getByText(/create new experiment with these prompts/i)
        ).toBeInTheDocument();
      });
    });

    it("counts prompts across multiple windows", async () => {
      const user = userEvent.setup();
      // Add tab and split to create two windows
      store.getState().addTab({
        data: createTabData({ title: "Prompt 1", configId: "prompt-1" }),
      });
      const tabId = store.getState().windows[0]?.tabs[0]?.id;
      store.getState().splitTab({ tabId: tabId! });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));

      // After split, we have 2 tabs (original + duplicated)
      await waitFor(() => {
        expect(
          screen.getByText(/create new experiment with these prompts/i)
        ).toBeInTheDocument();
      });
    });
  });

  describe("experiment creation", () => {
    it("creates experiment with saved prompt - compares using areFormValuesEqual", async () => {
      const user = userEvent.setup();

      // When no saved prompt is found, it's treated as having unsaved changes
      // (configId exists but savedPrompt is null -> hasUnsavedChanges returns true)
      // This test verifies the comparison flow works

      store.getState().addTab({
        data: createTabData({
          title: "My Saved Prompt",
          configId: "prompt-123",
          handle: "my-saved-prompt",
          versionId: "version-456",
        }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(saveExperimentMutateCall).toBeDefined();
        expect(saveExperimentMutateCall?.projectId).toBe(TEST_PROJECT_ID);

        // Check target was created from prompt
        const targets = saveExperimentMutateCall?.state.targets;
        expect(targets).toHaveLength(1);
        expect(targets?.[0]?.type).toBe("prompt");
        // Name is now fetched via useTargetName hook, not stored on config
        // References the saved prompt
        expect(targets?.[0]?.promptId).toBe("prompt-123");
        // Has localPromptConfig because savedPrompt was not found (null in mock)
        // so it's treated as having unsaved changes
        expect(targets?.[0]?.localPromptConfig).toBeDefined();
      });
    });

    it("creates experiment with unsaved prompt having localPromptConfig", async () => {
      const user = userEvent.setup();
      // New prompt without configId = never saved
      store.getState().addTab({
        data: createTabData({
          title: "Unsaved Prompt",
          // No configId = new unsaved prompt
        }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(saveExperimentMutateCall).toBeDefined();

        const targets = saveExperimentMutateCall?.state.targets;
        expect(targets).toHaveLength(1);
        expect(targets?.[0]?.type).toBe("prompt");
        // Unsaved prompt MUST have localPromptConfig
        expect(targets?.[0]?.localPromptConfig).toBeDefined();
        expect(targets?.[0]?.localPromptConfig?.llm.model).toBe("openai/gpt-4o");
        expect(targets?.[0]?.localPromptConfig?.messages).toHaveLength(1);
      });
    });

    it("creates multiple targets from multiple prompts", async () => {
      const user = userEvent.setup();

      store.getState().addTab({
        data: createTabData({
          title: "Saved Prompt",
          configId: "prompt-1",
          handle: "saved-prompt",
          versionId: "v1",
        }),
      });
      store.getState().addTab({
        data: createTabData({
          title: "New Prompt",
          // No configId = unsaved
        }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        const targets = saveExperimentMutateCall?.state.targets;
        expect(targets).toHaveLength(2);

        // First target - has configId
        expect(targets?.[0]?.promptId).toBe("prompt-1");

        // Second target - new prompt = has localPromptConfig
        expect(targets?.[1]?.promptId).toBeUndefined();
        expect(targets?.[1]?.localPromptConfig).toBeDefined();
      });
    });

    it("navigates to experiment workbench after creation", async () => {
      const user = userEvent.setup();
      store.getState().addTab({
        data: createTabData({ title: "Prompt", configId: "p1", versionId: "v1" }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(mockRouterPush).toHaveBeenCalledWith(
          "/test-project/experiments/workbench/test-slug-123"
        );
      });
    });

    it("closes dialog after creation", async () => {
      const user = userEvent.setup();
      store.getState().addTab({
        data: createTabData({ title: "Prompt", configId: "p1", versionId: "v1" }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        expect(
          screen.queryByText(/create new experiment/i)
        ).not.toBeInTheDocument();
      });
    });
  });

  describe("auto-mapping", () => {
    it("auto-maps target inputs to dataset columns", async () => {
      const user = userEvent.setup();
      // Create a prompt with "input" as an input field
      store.getState().addTab({
        data: createTabData({
          title: "My Prompt",
          configId: "prompt-1",
          versionId: "v1",
        }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /create/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /create/i }));

      await waitFor(() => {
        const targets = saveExperimentMutateCall?.state.targets;
        expect(targets).toHaveLength(1);

        // Check that mappings were auto-applied
        // Default dataset has "input" and "expected_output" columns
        // Target has "input" as input field - should be auto-mapped
        const mappings = targets?.[0]?.mappings;
        expect(mappings).toBeDefined();

        // The default dataset id is "test-data"
        const datasetMappings = mappings?.["test-data"];
        expect(datasetMappings).toBeDefined();

        // "input" field should be mapped to "input" column
        expect(datasetMappings?.["input"]).toEqual({
          type: "source",
          source: "dataset",
          sourceId: "test-data",
          sourceField: "input",
        });
      });
    });
  });

  describe("cancel behavior", () => {
    it("closes dialog on cancel", async () => {
      const user = userEvent.setup();
      store.getState().addTab({
        data: createTabData({ title: "Prompt" }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      await waitFor(() => {
        expect(
          screen.queryByText(/create new experiment/i)
        ).not.toBeInTheDocument();
      });
    });

    it("does not create experiment on cancel", async () => {
      const user = userEvent.setup();
      store.getState().addTab({
        data: createTabData({ title: "Prompt" }),
      });

      render(<ExperimentFromPlaygroundButton />, { wrapper: Wrapper });

      await user.click(screen.getByRole("button", { name: /experiment/i }));
      await waitFor(() => {
        expect(screen.getByRole("button", { name: /cancel/i })).toBeInTheDocument();
      });

      await user.click(screen.getByRole("button", { name: /cancel/i }));

      expect(saveExperimentMutateCall).toBeUndefined();
    });
  });
});
