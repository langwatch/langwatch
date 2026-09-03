/**
 * @vitest-environment jsdom
 */

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import "@testing-library/jest-dom/vitest";
import {
  type CustomModelEntry,
  MASKED_KEY_PLACEHOLDER,
  type ModelProviderEditorValue as MaybeStoredModelProvider,
} from "@langwatch/model-provider-contract";

// Mock the api module
const mockMutateAsync = vi.fn().mockResolvedValue({});
const mockInvalidate = vi.fn();

const mockApi = {
  useUtils: () => ({
    organization: {
      getAll: {
        invalidate: mockInvalidate,
      },
    },
    modelProvider: {
      getAllForProject: { invalidate: vi.fn() },
      getAllForProjectForFrontend: { invalidate: vi.fn() },
      listAllForProjectForFrontend: { invalidate: vi.fn() },
      listAllForOrganizationForFrontend: { invalidate: vi.fn() },
      getResolvedDefault: { invalidate: vi.fn() },
      getDefaultModelsForProject: {
        invalidate: vi.fn(),
      },
    },
  }),
  modelProvider: {
    update: {
      useMutation: () => ({
        mutateAsync: mockMutateAsync,
      }),
    },
    // B3 redesign: `useProviderFormSubmit` replays the user's "Set as
    // default" picks into ModelDefault via this mutation; stub it so
    // the hook can render.
    setRoleAssignmentForScope: {
      useMutation: () => ({
        mutateAsync: vi.fn().mockResolvedValue({ ok: true }),
      }),
    },
  },
};

// Getters, so the factory reads the map after this module has initialised it:
// a hoisted factory that named `mockApi` directly would run before the const.
vi.mock("../model-provider-api", () => ({
  get api() {
    return mockApi;
  },
  get modelProviderApi() {
    return mockApi;
  },
}));

// The toaster reaches the application through the host port; stand the port's
// two bindings in so the hook renders without a host.
vi.mock("../model-provider-feedback", () => ({
  useModelProviderToaster: () => ({ create: vi.fn() }),
  useShowErrorToast: () => vi.fn(),
}));

// Import the hook after mocking
import { useModelProviderForm } from "../use-model-provider-form";

describe("useModelProviderForm()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    cleanup();
  });

  const createOpenAIProvider = (
    overrides: Partial<MaybeStoredModelProvider> = {},
  ): MaybeStoredModelProvider => ({
    provider: "openai",
    enabled: false,
    customKeys: null,
    models: null,
    embeddingsModels: null,
    disabledByDefault: true,
    deploymentMapping: null,
    extraHeaders: [],
    ...overrides,
  });

  describe("Credential Input Persistence (Bug Fix Validation)", () => {
    // The legacy "project reference stability" tests are gone with the
    // project param (its default-model fields were the data source).
    // The remaining "form resets when provider changes" case still
    // pins the core regression contract.

    it("resets form when provider actually changes", () => {
      const openaiProvider = createOpenAIProvider();
      const anthropicProvider: MaybeStoredModelProvider = {
        provider: "anthropic",
        enabled: false,
        customKeys: null,
        models: null,
        embeddingsModels: null,
        disabledByDefault: true,
        deploymentMapping: null,
        extraHeaders: [],
      };

      const { result, rerender } = renderHook(
        ({ provider }) =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        { initialProps: { provider: openaiProvider } },
      );

      // User types in an OpenAI API key
      act(() => {
        result.current[1].setCustomKey("OPENAI_API_KEY", "sk-openai-key");
      });

      expect(result.current[0].customKeys.OPENAI_API_KEY).toBe("sk-openai-key");

      // Switch to Anthropic provider
      rerender({ provider: anthropicProvider });

      // Form should reset for the new provider
      expect(result.current[0].customKeys.OPENAI_API_KEY).toBeUndefined();
      expect(result.current[0].customKeys.ANTHROPIC_API_KEY).toBe("");
    });
  });

  describe("Initial State", () => {
    it("initializes with empty customKeys for new provider", () => {
      const provider = createOpenAIProvider();

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].customKeys.OPENAI_API_KEY).toBe("");
      expect(result.current[0].customKeys.OPENAI_BASE_URL).toBe("");
    });

    it("initializes with stored keys for existing provider", () => {
      const provider = createOpenAIProvider({
        enabled: true,
        customKeys: {
          OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          OPENAI_BASE_URL: "https://api.openai.com/v1",
        },
      });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      // Keys should be masked
      expect(result.current[0].customKeys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      expect(result.current[0].customKeys.OPENAI_BASE_URL).toBe("https://api.openai.com/v1");
    });

    it("shows MASKED_KEY_PLACEHOLDER for enabled provider without stored keys (env vars)", () => {
      const provider = createOpenAIProvider({
        enabled: true,
        customKeys: null,
      });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      // API key should be masked since provider is enabled
      expect(result.current[0].customKeys.OPENAI_API_KEY).toBe(MASKED_KEY_PLACEHOLDER);
      // URL fields are not masked
      expect(result.current[0].customKeys.OPENAI_BASE_URL).toBe("");
    });
  });

  describe("setCustomKey", () => {
    it("updates a single key value", () => {
      const provider = createOpenAIProvider();

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      act(() => {
        result.current[1].setCustomKey("OPENAI_API_KEY", "sk-new-key");
      });

      expect(result.current[0].customKeys.OPENAI_API_KEY).toBe("sk-new-key");
      // Other keys should remain unchanged
      expect(result.current[0].customKeys.OPENAI_BASE_URL).toBe("");
    });

    it("preserves other keys when updating one", () => {
      const provider = createOpenAIProvider();

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      act(() => {
        result.current[1].setCustomKey("OPENAI_API_KEY", "sk-key");
        result.current[1].setCustomKey("OPENAI_BASE_URL", "https://custom.example.com");
      });

      expect(result.current[0].customKeys.OPENAI_API_KEY).toBe("sk-key");
      expect(result.current[0].customKeys.OPENAI_BASE_URL).toBe("https://custom.example.com");
    });
  });

  describe("useAsDefaultProvider toggle", () => {
    it("auto-enables when this is the only enabled provider", () => {
      // With the legacy project.defaultModel column gone, the only
      // remaining auto-enable trigger is "first-provider setup": when
      // this is the only enabled provider in the org. Any other
      // scenario requires explicit user opt-in via the toggle.
      const provider = createOpenAIProvider({ enabled: true });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 1,
        }),
      );

      expect(result.current[0].useAsDefaultProvider).toBe(true);
    });

    it("does not auto-enable when more than one provider is already enabled", () => {
      const provider = createOpenAIProvider({ enabled: true });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].useAsDefaultProvider).toBe(false);
    });

    it("can be toggled manually", () => {
      const provider = createOpenAIProvider({ enabled: true });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].useAsDefaultProvider).toBe(false);

      act(() => {
        result.current[1].setUseAsDefaultProvider(true);
      });

      expect(result.current[0].useAsDefaultProvider).toBe(true);
    });
  });

  // A stored header arrives masked and the form wraps it with a `concealed`
  // flag for the show/hide eye. Comparing the objects whole made every
  // provider holding a header read as dirty the moment its drawer opened, so
  // Save was live over a form nobody had touched, and clicking it sent a save
  // the customer never asked for.
  describe("given a saved provider that already holds an extra header", () => {
    // Built once per test, never inside the render callback: the hook's reset
    // effect keys on `provider.customKeys` and `provider.extraHeaders`, so a
    // fresh object each render re-fires it forever. Scopes are set so the row
    // reads as saved and the header comparison is the only thing under test.
    const openForm = (headers: { key: string; value: string }[]) => {
      const provider = createOpenAIProvider({
        name: "OpenAI",
        scopes: [{ scopeType: "PROJECT", scopeId: "test-project-id" }],
        extraHeaders: headers,
      } as Partial<MaybeStoredModelProvider>);
      return renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );
    };
    const withHeader = () => openForm([{ key: "api-key", value: MASKED_KEY_PLACEHOLDER }]);

    describe("when the drawer has just opened and nothing was touched", () => {
      /** @scenario A stored extra header does not make the form dirty on open */
      it("leaves the form clean, so Save stays disabled", () => {
        expect(withHeader().result.current[0].isDirty).toBe(false);
      });
    });

    describe("when the same provider holds no headers at all", () => {
      it("also leaves the form clean, which is the control for the case above", () => {
        expect(openForm([]).result.current[0].isDirty).toBe(false);
      });
    });

    describe("when the header's value is edited", () => {
      it("marks the form dirty", () => {
        const { result } = withHeader();

        act(() => {
          result.current[1].setExtraHeaderValue(0, "a-new-value");
        });

        expect(result.current[0].isDirty).toBe(true);
      });
    });

    describe("when another header is added", () => {
      it("marks the form dirty", () => {
        const { result } = withHeader();

        act(() => {
          result.current[1].addExtraHeader();
        });

        expect(result.current[0].isDirty).toBe(true);
      });
    });
  });

  // Emptying a credential is an edit like any other. Dirty detection used to
  // ask only whether a new key had been typed, so Save stayed disabled over a
  // cleared field and a credential could not be removed at all.
  describe("given a saved provider whose API key is already on file", () => {
    // Same rule as above: one provider object per test, held stable across
    // renders so the hook's reset effect fires once.
    const openForm = () => {
      const provider = createOpenAIProvider({
        name: "OpenAI",
        enabled: true,
        scopes: [{ scopeType: "PROJECT", scopeId: "test-project-id" }],
        customKeys: { OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER },
      } as Partial<MaybeStoredModelProvider>);
      return renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );
    };

    describe("when the drawer has just opened and nothing was touched", () => {
      it("leaves the form clean, which is the control for the cases below", () => {
        expect(openForm().result.current[0].isDirty).toBe(false);
      });
    });

    describe("when the key field is cleared", () => {
      /** @scenario Clearing a stored API key enables Save */
      it("marks the form dirty, so the credential can be removed", () => {
        const { result } = openForm();

        act(() => {
          result.current[1].setCustomKey("OPENAI_API_KEY", "");
        });

        expect(result.current[0].isDirty).toBe(true);
      });
    });

    describe("when a new key is typed", () => {
      it("marks the form dirty", () => {
        const { result } = openForm();

        act(() => {
          result.current[1].setCustomKey("OPENAI_API_KEY", "sk-freshly-typed");
        });

        expect(result.current[0].isDirty).toBe(true);
      });
    });
  });

  describe("Extra Headers", () => {
    it("initializes with existing extra headers", () => {
      const provider = createOpenAIProvider({
        extraHeaders: [{ key: "x-custom", value: "value1" }],
      });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].extraHeaders).toHaveLength(1);
      expect(result.current[0].extraHeaders[0]!.key).toBe("x-custom");
      expect(result.current[0].extraHeaders[0]!.value).toBe("value1");
    });

    it("can add a new header", () => {
      const provider = createOpenAIProvider();

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].extraHeaders).toHaveLength(0);

      act(() => {
        result.current[1].addExtraHeader();
      });

      expect(result.current[0].extraHeaders).toHaveLength(1);
      expect(result.current[0].extraHeaders[0]!.key).toBe("");
      expect(result.current[0].extraHeaders[0]!.value).toBe("");
    });

    it("can remove a header", () => {
      const provider = createOpenAIProvider({
        extraHeaders: [
          { key: "h1", value: "v1" },
          { key: "h2", value: "v2" },
        ],
      });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].extraHeaders).toHaveLength(2);

      act(() => {
        result.current[1].removeExtraHeader(0);
      });

      expect(result.current[0].extraHeaders).toHaveLength(1);
      expect(result.current[0].extraHeaders[0]!.key).toBe("h2");
    });
  });

  describe("Custom Models", () => {
    const chatModelEntry: CustomModelEntry = {
      modelId: "ft:gpt-4o:my-org",
      displayName: "My Fine-Tuned GPT-4o",
      mode: "chat",
      maxTokens: 4096,
      supportedParameters: ["temperature", "top_p"],
    };

    const embeddingsModelEntry: CustomModelEntry = {
      modelId: "custom-embed-v1",
      displayName: "Custom Embeddings v1",
      mode: "embedding",
    };

    describe("when initializing", () => {
      it("starts with empty custom models when provider has none stored", () => {
        const provider = createOpenAIProvider();

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        expect(result.current[0].customModels).toEqual([]);
        expect(result.current[0].customEmbeddingsModels).toEqual([]);
      });

      it("initializes from provider.customModels when present", () => {
        const storedModels: CustomModelEntry[] = [chatModelEntry];
        const storedEmbeddings: CustomModelEntry[] = [embeddingsModelEntry];
        const provider = createOpenAIProvider({
          customModels: storedModels,
          customEmbeddingsModels: storedEmbeddings,
        });

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        expect(result.current[0].customModels).toEqual(storedModels);
        expect(result.current[0].customEmbeddingsModels).toEqual(storedEmbeddings);
      });
    });

    describe("when adding a custom model", () => {
      it("adds a CustomModelEntry to state", () => {
        const provider = createOpenAIProvider();

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        act(() => {
          result.current[1].addCustomModel(chatModelEntry);
        });

        expect(result.current[0].customModels).toHaveLength(1);
        expect(result.current[0].customModels[0]).toEqual(chatModelEntry);
      });

      it("does not add duplicate models with the same modelId", () => {
        const provider = createOpenAIProvider();

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        act(() => {
          result.current[1].addCustomModel(chatModelEntry);
          result.current[1].addCustomModel({
            ...chatModelEntry,
            displayName: "Duplicate",
          });
        });

        expect(result.current[0].customModels).toHaveLength(1);
        expect(result.current[0].customModels[0]!.displayName).toBe("My Fine-Tuned GPT-4o");
      });
    });

    describe("when removing a custom model", () => {
      it("removes the model by modelId", () => {
        const provider = createOpenAIProvider({
          customModels: [chatModelEntry],
        });

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        expect(result.current[0].customModels).toHaveLength(1);

        act(() => {
          result.current[1].removeCustomModel(chatModelEntry.modelId);
        });

        expect(result.current[0].customModels).toHaveLength(0);
      });
    });

    describe("when adding a custom embeddings model", () => {
      it("adds a CustomModelEntry to embeddings state", () => {
        const provider = createOpenAIProvider();

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        act(() => {
          result.current[1].addCustomEmbeddingsModel(embeddingsModelEntry);
        });

        expect(result.current[0].customEmbeddingsModels).toHaveLength(1);
        expect(result.current[0].customEmbeddingsModels[0]).toEqual(embeddingsModelEntry);
      });

      it("does not add duplicate embeddings models with the same modelId", () => {
        const provider = createOpenAIProvider();

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        act(() => {
          result.current[1].addCustomEmbeddingsModel(embeddingsModelEntry);
          result.current[1].addCustomEmbeddingsModel(embeddingsModelEntry);
        });

        expect(result.current[0].customEmbeddingsModels).toHaveLength(1);
      });
    });

    describe("when removing a custom embeddings model", () => {
      it("removes the embeddings model by modelId", () => {
        const provider = createOpenAIProvider({
          customEmbeddingsModels: [embeddingsModelEntry],
        });

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        expect(result.current[0].customEmbeddingsModels).toHaveLength(1);

        act(() => {
          result.current[1].removeCustomEmbeddingsModel(embeddingsModelEntry.modelId);
        });

        expect(result.current[0].customEmbeddingsModels).toHaveLength(0);
      });
    });

    describe("when submitting", () => {
      it("sends CustomModelEntry[] directly in mutation", async () => {
        const provider = createOpenAIProvider({
          id: "provider-123",
          customModels: [chatModelEntry],
          customEmbeddingsModels: [embeddingsModelEntry],
          customKeys: { OPENAI_API_KEY: "sk-key" },
        });

        const { result } = renderHook(() =>
          useModelProviderForm({
            provider,
            projectId: "test-project-id",
            enabledProvidersCount: 2,
          }),
        );

        await act(async () => {
          await result.current[1].submit();
        });

        expect(mockMutateAsync).toHaveBeenCalledWith(
          expect.objectContaining({
            customModels: [chatModelEntry],
            customEmbeddingsModels: [embeddingsModelEntry],
          }),
        );
      });
    });

    describe("when syncing from provider prop change", () => {
      it("updates custom models when provider changes", () => {
        const initialProvider = createOpenAIProvider({
          id: "provider-1",
          customModels: [chatModelEntry],
        });

        const updatedModel: CustomModelEntry = {
          modelId: "new-model",
          displayName: "New Model",
          mode: "chat",
        };

        const updatedProvider = createOpenAIProvider({
          id: "provider-2",
          customModels: [updatedModel],
        });

        const { result, rerender } = renderHook(
          ({ provider }) =>
            useModelProviderForm({
              provider,
              projectId: "test-project-id",
              enabledProvidersCount: 2,
            }),
          { initialProps: { provider: initialProvider } },
        );

        expect(result.current[0].customModels).toEqual([chatModelEntry]);

        rerender({ provider: updatedProvider });

        expect(result.current[0].customModels).toEqual([updatedModel]);
      });
    });
  });

  describe("Azure API Gateway", () => {
    it("initializes useApiGateway from stored keys", () => {
      const provider: MaybeStoredModelProvider = {
        provider: "azure",
        enabled: true,
        customKeys: {
          AZURE_API_GATEWAY_BASE_URL: "https://gateway.example.com",
          AZURE_API_GATEWAY_VERSION: "2024-05-01-preview",
        },
        models: null,
        embeddingsModels: null,
        disabledByDefault: false,
        deploymentMapping: null,
        extraHeaders: [],
      };

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].useApiGateway).toBe(true);
    });

    it("toggles display keys when API Gateway is toggled", () => {
      const provider: MaybeStoredModelProvider = {
        provider: "azure",
        enabled: false,
        customKeys: null,
        models: null,
        embeddingsModels: null,
        disabledByDefault: true,
        deploymentMapping: null,
        extraHeaders: [],
      };

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].useApiGateway).toBe(false);
      expect(result.current[0].displayKeys).toHaveProperty("AZURE_OPENAI_API_KEY");

      act(() => {
        result.current[1].setUseApiGateway(true);
      });

      expect(result.current[0].useApiGateway).toBe(true);
      expect(result.current[0].displayKeys).toHaveProperty("AZURE_API_GATEWAY_BASE_URL");
      expect(result.current[0].displayKeys).not.toHaveProperty("AZURE_OPENAI_API_KEY");
    });

    it("adds api-key extra header when enabling API Gateway on Azure", () => {
      const provider: MaybeStoredModelProvider = {
        provider: "azure",
        enabled: false,
        customKeys: null,
        models: null,
        embeddingsModels: null,
        disabledByDefault: true,
        deploymentMapping: null,
        extraHeaders: [],
      };

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].extraHeaders).toHaveLength(0);

      act(() => {
        result.current[1].setUseApiGateway(true);
      });

      expect(result.current[0].extraHeaders).toHaveLength(1);
      expect(result.current[0].extraHeaders[0]!.key).toBe("api-key");
    });
  });

  describe("when enabledProvidersCount is 1", () => {
    it("auto-enables useAsDefaultProvider", () => {
      const provider = createOpenAIProvider({ enabled: false });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 1,
        }),
      );

      expect(result.current[0].useAsDefaultProvider).toBe(true);
    });

    it("starts projectDefaultModel as null; selector picks fill it later", () => {
      // With the legacy default-model columns gone, the form no longer
      // pre-fills the selector from project.defaultModel. The drawer's
      // ModelProviderDefaultSection picks a flagship from
      // modelSelectorOptions when the "Use as default" toggle flips
      // on. From the hook's perspective the field starts null.
      const provider: MaybeStoredModelProvider = {
        provider: "azure",
        enabled: false,
        customKeys: null,
        models: ["gpt-4o"],
        embeddingsModels: null,
        disabledByDefault: true,
        deploymentMapping: null,
        extraHeaders: [],
      };

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 1,
        }),
      );

      expect(result.current[0].projectDefaultModel).toBeNull();
    });
  });

  describe("when enabledProvidersCount is greater than 1", () => {
    it("does not auto-enable useAsDefaultProvider", () => {
      const provider = createOpenAIProvider({ enabled: false });

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      expect(result.current[0].useAsDefaultProvider).toBe(false);
    });
  });

  describe("Managed Provider", () => {
    it("sets MANAGED key when setManaged(true) is called", () => {
      const provider = createOpenAIProvider();

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      act(() => {
        result.current[1].setManaged(true);
      });

      expect(result.current[0].customKeys).toEqual({ MANAGED: "true" });
    });

    it("clears all keys when setManaged(false) is called", () => {
      const provider = createOpenAIProvider();

      const { result } = renderHook(() =>
        useModelProviderForm({
          provider,
          projectId: "test-project-id",
          enabledProvidersCount: 2,
        }),
      );

      act(() => {
        result.current[1].setCustomKey("OPENAI_API_KEY", "sk-key");
        result.current[1].setManaged(false);
      });

      expect(result.current[0].customKeys).toEqual({});
    });
  });
});
