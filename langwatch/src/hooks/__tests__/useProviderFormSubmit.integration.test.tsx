/**
 * @vitest-environment jsdom
 *
 * Regression tests for issue #3785:
 * Provider edit drawer's Default Model dropdown silently desyncs from project state.
 *
 * The submit-time guard in useProviderFormSubmit fires a toast and aborts
 * when useAsDefaultProvider is true but any selected model belongs to a
 * different provider (prefix mismatch).
 */

import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FormSnapshot } from "../useProviderFormSubmit";

// ---------------------------------------------------------------------------
// Mocks — vi.hoisted() ensures variables are available when vi.mock factories
// are hoisted to the top of the file by Vitest's transform step.
// ---------------------------------------------------------------------------

const {
  mockUpdateMutateAsync,
  mockUpdateProjectDefaultModelsMutateAsync,
  mockToasterCreate,
  mockInvalidate,
} = vi.hoisted(() => ({
  mockUpdateMutateAsync: vi.fn().mockResolvedValue({}),
  mockUpdateProjectDefaultModelsMutateAsync: vi.fn().mockResolvedValue({}),
  mockToasterCreate: vi.fn(),
  mockInvalidate: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  api: {
    useContext: () => ({
      organization: {
        getAll: {
          invalidate: mockInvalidate,
        },
      },
    }),
    modelProvider: {
      update: {
        useMutation: () => ({
          mutateAsync: mockUpdateMutateAsync,
        }),
      },
    },
    project: {
      updateProjectDefaultModels: {
        useMutation: () => ({
          mutateAsync: mockUpdateProjectDefaultModelsMutateAsync,
        }),
      },
    },
  },
}));

vi.mock("../../components/ui/toaster", () => ({
  toaster: {
    create: mockToasterCreate,
  },
}));

// Import after mocks
import { useProviderFormSubmit } from "../useProviderFormSubmit";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildAzureProvider() {
  return {
    provider: "azure",
    enabled: true,
    customKeys: { AZURE_OPENAI_API_KEY: "test-key" },
    models: ["gpt-5-mini"],
    embeddingsModels: null,
    disabledByDefault: false,
    deploymentMapping: null,
    extraHeaders: [],
  };
}

function buildSnapshot(overrides: Partial<FormSnapshot> = {}): FormSnapshot {
  return {
    provider: buildAzureProvider(),
    name: "Azure OpenAI",
    projectId: "proj-1",
    isUsingEnvVars: true,
    customKeys: { AZURE_OPENAI_API_KEY: "****" },
    initialKeys: { AZURE_OPENAI_API_KEY: "****" },
    providerKeysSchema: null,
    extraHeaders: [],
    customModels: [],
    customEmbeddingsModels: [],
    useAsDefaultProvider: true,
    projectDefaultModel: "azure/gpt-5-mini",
    projectTopicClusteringModel: "azure/gpt-5-mini",
    projectEmbeddingsModel: null,
    ...overrides,
  };
}

function renderSubmitHook({ snapshot }: { snapshot: FormSnapshot }) {
  return renderHook(() =>
    useProviderFormSubmit({
      getFormSnapshot: () => snapshot,
    }),
  );
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("useProviderFormSubmit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("given useAsDefaultProvider is true and provider is azure", () => {
    describe("when projectDefaultModel belongs to a different provider (openai/gpt-5.2)", () => {
      it("does not call updateProjectDefaultModels mutation", async () => {
        const snapshot = buildSnapshot({
          projectDefaultModel: "openai/gpt-5.2",
          projectTopicClusteringModel: "azure/gpt-5-mini",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockUpdateProjectDefaultModelsMutateAsync).not.toHaveBeenCalled();
      });

      it("creates an error toast", async () => {
        const snapshot = buildSnapshot({
          projectDefaultModel: "openai/gpt-5.2",
          projectTopicClusteringModel: "azure/gpt-5-mini",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error" }),
        );
      });
    });

    describe("when projectTopicClusteringModel belongs to a different provider (openai/gpt-4o-mini)", () => {
      it("does not call updateProjectDefaultModels mutation", async () => {
        const snapshot = buildSnapshot({
          projectDefaultModel: "azure/gpt-5-mini",
          projectTopicClusteringModel: "openai/gpt-4o-mini",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockUpdateProjectDefaultModelsMutateAsync).not.toHaveBeenCalled();
      });

      it("creates an error toast", async () => {
        const snapshot = buildSnapshot({
          projectDefaultModel: "azure/gpt-5-mini",
          projectTopicClusteringModel: "openai/gpt-4o-mini",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockToasterCreate).toHaveBeenCalledWith(
          expect.objectContaining({ type: "error" }),
        );
      });
    });

    describe("when all models start with azure/ (no mismatch)", () => {
      it("calls updateProjectDefaultModels mutation with the selected models", async () => {
        const snapshot = buildSnapshot({
          projectDefaultModel: "azure/gpt-5-mini",
          projectTopicClusteringModel: "azure/gpt-5-mini",
          projectEmbeddingsModel: "azure/text-embedding-3-small",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockUpdateProjectDefaultModelsMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            projectId: "proj-1",
            defaultModel: "azure/gpt-5-mini",
            topicClusteringModel: "azure/gpt-5-mini",
            embeddingsModel: "azure/text-embedding-3-small",
          }),
        );
      });
    });
  });

  describe("given useAsDefaultProvider is false", () => {
    describe("when projectDefaultModel belongs to a different provider (openai/gpt-5.2)", () => {
      it("does not fire the mismatch guard — submit proceeds without error toast", async () => {
        const snapshot = buildSnapshot({
          useAsDefaultProvider: false,
          projectDefaultModel: "openai/gpt-5.2",
          projectTopicClusteringModel: "openai/gpt-4o-mini",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        // Guard only fires when useAsDefaultProvider is true
        const errorToasts = mockToasterCreate.mock.calls.filter(
          (call) => call[0]?.type === "error",
        );
        expect(errorToasts).toHaveLength(0);
      });
    });
  });
});
