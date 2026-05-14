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
import { z } from "zod";
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
import { MASKED_KEY_PLACEHOLDER } from "../../utils/constants";

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

  // Regression tests for #3532: the !isUsingEnvVars branch must filter
  // MASKED_KEY_PLACEHOLDER values out of customKeys before submit, otherwise
  // env-fallback projects post the literal placeholder string and the
  // backend rejects it as "invalid api key".
  describe("given isUsingEnvVars is false (env-fallback project, drawer open)", () => {
    // Matches the shape of registry.ts azure.keysSchema: all keys optional,
    // .passthrough() so MASKED_KEY_PLACEHOLDER and "" both validate.
    const passthroughSchema = z
      .object({
        AZURE_OPENAI_API_KEY: z.string().nullable().optional(),
        AZURE_OPENAI_ENDPOINT: z.string().nullable().optional(),
      })
      .passthrough();
    describe("when all keys are still masked (Save without editing)", () => {
      it("omits all masked entries from the submitted customKeys", async () => {
        const snapshot = buildSnapshot({
          isUsingEnvVars: false,
          useAsDefaultProvider: false,
          providerKeysSchema: passthroughSchema,
          customKeys: {
            AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            AZURE_OPENAI_ENDPOINT: MASKED_KEY_PLACEHOLDER,
          },
          initialKeys: {
            AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            AZURE_OPENAI_ENDPOINT: MASKED_KEY_PLACEHOLDER,
          },
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockUpdateMutateAsync).toHaveBeenCalledTimes(1);
        const payload = mockUpdateMutateAsync.mock.calls[0]?.[0];
        expect(payload?.customKeys).toEqual({});
      });
    });

    describe("when one key edited and one still masked", () => {
      it("includes the edited key and omits the masked one", async () => {
        const snapshot = buildSnapshot({
          isUsingEnvVars: false,
          useAsDefaultProvider: false,
          providerKeysSchema: passthroughSchema,
          customKeys: {
            AZURE_OPENAI_API_KEY: "sk-newly-typed",
            AZURE_OPENAI_ENDPOINT: MASKED_KEY_PLACEHOLDER,
          },
          initialKeys: {
            AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            AZURE_OPENAI_ENDPOINT: MASKED_KEY_PLACEHOLDER,
          },
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        const payload = mockUpdateMutateAsync.mock.calls[0]?.[0];
        expect(payload?.customKeys).toEqual({
          AZURE_OPENAI_API_KEY: "sk-newly-typed",
        });
      });
    });

    describe("when user cleared a key (empty string)", () => {
      it("preserves the empty string in the payload (not treated as masked)", async () => {
        const snapshot = buildSnapshot({
          isUsingEnvVars: false,
          useAsDefaultProvider: false,
          providerKeysSchema: passthroughSchema,
          customKeys: {
            AZURE_OPENAI_API_KEY: "",
            AZURE_OPENAI_ENDPOINT: MASKED_KEY_PLACEHOLDER,
          },
          initialKeys: {
            AZURE_OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
            AZURE_OPENAI_ENDPOINT: MASKED_KEY_PLACEHOLDER,
          },
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        const payload = mockUpdateMutateAsync.mock.calls[0]?.[0];
        expect(payload?.customKeys).toEqual({
          AZURE_OPENAI_API_KEY: "",
        });
      });
    });

    describe("when all keys are freshly typed (no masked placeholders)", () => {
      it("submits the freshly-typed keys as-is", async () => {
        const snapshot = buildSnapshot({
          isUsingEnvVars: false,
          useAsDefaultProvider: false,
          providerKeysSchema: passthroughSchema,
          customKeys: {
            AZURE_OPENAI_API_KEY: "sk-new-key",
            AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
          },
          initialKeys: {},
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        const payload = mockUpdateMutateAsync.mock.calls[0]?.[0];
        expect(payload?.customKeys).toEqual({
          AZURE_OPENAI_API_KEY: "sk-new-key",
          AZURE_OPENAI_ENDPOINT: "https://example.openai.azure.com",
        });
      });
    });
  });
});
