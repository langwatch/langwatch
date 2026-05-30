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
  mockSetRoleAssignmentMutateAsync,
  mockDefaultModelsInvalidate,
} = vi.hoisted(() => ({
  mockUpdateMutateAsync: vi.fn().mockResolvedValue({}),
  mockUpdateProjectDefaultModelsMutateAsync: vi.fn().mockResolvedValue({}),
  mockToasterCreate: vi.fn(),
  mockInvalidate: vi.fn(),
  mockSetRoleAssignmentMutateAsync: vi.fn().mockResolvedValue({ ok: true }),
  mockDefaultModelsInvalidate: vi.fn(),
}));

vi.mock("../../utils/api", () => ({
  api: {
    useContext: () => ({
      organization: {
        getAll: {
          invalidate: mockInvalidate,
        },
      },
      modelProvider: {
        getAllForProject: { invalidate: vi.fn() },
        getAllForProjectForFrontend: { invalidate: vi.fn() },
        listAllForProjectForFrontend: { invalidate: vi.fn() },
        getResolvedDefault: { invalidate: vi.fn() },
        getDefaultModelsForProject: {
          invalidate: mockDefaultModelsInvalidate,
        },
      },
    }),
    modelProvider: {
      update: {
        useMutation: () => ({
          mutateAsync: mockUpdateMutateAsync,
        }),
      },
      setRoleAssignmentForScope: {
        useMutation: () => ({
          mutateAsync: mockSetRoleAssignmentMutateAsync,
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

function renderSubmitHook({
  snapshot,
  getAdvancedPayload,
}: {
  snapshot: FormSnapshot;
  getAdvancedPayload?: Parameters<
    typeof useProviderFormSubmit
  >[0]["getAdvancedPayload"];
}) {
  return renderHook(() =>
    useProviderFormSubmit({
      getFormSnapshot: () => snapshot,
      getAdvancedPayload,
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
      /** @scenario Default models live in a section below the providers list, not in the drawer */
      it("no longer writes project defaults from the provider drawer", async () => {
        // Project default models are now owned by the page-level
        // DefaultModelsSection (see specs/model-providers/
        // hierarchical-default-models.feature). The drawer's submit path
        // must NOT write to project.defaultModel so it can't silently
        // pin an inherited org/team default onto the project.
        const snapshot = buildSnapshot({
          projectDefaultModel: "azure/gpt-5-mini",
          projectTopicClusteringModel: "azure/gpt-5-mini",
          projectEmbeddingsModel: "azure/text-embedding-3-small",
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockUpdateProjectDefaultModelsMutateAsync).not.toHaveBeenCalled();
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

      /** @scenario Toggling "Set as default" off does not write any ModelDefault row */
      it("does not call setRoleAssignmentForScope (the seed remains the only writer)", async () => {
        const snapshot = buildSnapshot({
          useAsDefaultProvider: false,
          projectDefaultModel: "azure/gpt-5-mini",
          projectTopicClusteringModel: "azure/gpt-5-mini",
          projectEmbeddingsModel: null,
          scopes: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockSetRoleAssignmentMutateAsync).not.toHaveBeenCalled();
      });

      it("still invalidates getDefaultModelsForProject so the section refetches the auto-seeded row", async () => {
        // First-provider create runs seedOnboardingDefaultsForProvider
        // server-side regardless of the "use as default provider" checkbox.
        // The Default Models card on the settings page binds to
        // getDefaultModelsForProject, so it MUST be invalidated even when
        // the user didn't opt into the user-pick replay — otherwise the
        // section reads stale "no configs" until window-focus refetch.
        const snapshot = buildSnapshot({
          useAsDefaultProvider: false,
          projectDefaultModel: null,
          projectTopicClusteringModel: null,
          projectEmbeddingsModel: null,
          scopes: [{ scopeType: "PROJECT", scopeId: "proj-1" }],
        });
        const { result } = renderSubmitHook({ snapshot });

        await act(async () => {
          await result.current.submit();
        });

        expect(mockDefaultModelsInvalidate).toHaveBeenCalled();
      });
    });
  });

  describe("given useAsDefaultProvider is true and the picks land on same-provider models", () => {
    /** @scenario The user's onboarding pick wins over the additive seed */
    it("upserts a ModelDefault row per role per scope using the user's picks", async () => {
      const snapshot = buildSnapshot({
        useAsDefaultProvider: true,
        // All picks belong to the azure provider being submitted so the
        // mismatch guard accepts the submit.
        projectDefaultModel: "azure/gpt-5-mini",
        projectTopicClusteringModel: "azure/gpt-5-mini",
        projectEmbeddingsModel: "azure/text-embedding-3-small",
        scopes: [
          { scopeType: "ORGANIZATION", scopeId: "org-1" },
          { scopeType: "PROJECT", scopeId: "proj-1" },
        ],
      });
      const { result } = renderSubmitHook({ snapshot });

      await act(async () => {
        await result.current.submit();
      });

      // 2 scopes × 3 roles = 6 upserts. Each carries the user's picked
      // model (not the registry flagship that the additive seed would
      // have written).
      expect(mockSetRoleAssignmentMutateAsync).toHaveBeenCalledTimes(6);
      // Spot-check the per-scope-per-role payloads.
      expect(mockSetRoleAssignmentMutateAsync).toHaveBeenCalledWith({
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "DEFAULT",
        model: "azure/gpt-5-mini",
      });
      expect(mockSetRoleAssignmentMutateAsync).toHaveBeenCalledWith({
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "FAST",
        model: "azure/gpt-5-mini",
      });
      expect(mockSetRoleAssignmentMutateAsync).toHaveBeenCalledWith({
        scopeType: "ORGANIZATION",
        scopeId: "org-1",
        role: "EMBEDDINGS",
        model: "azure/text-embedding-3-small",
      });
      expect(mockSetRoleAssignmentMutateAsync).toHaveBeenCalledWith({
        scopeType: "PROJECT",
        scopeId: "proj-1",
        role: "DEFAULT",
        model: "azure/gpt-5-mini",
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

  describe("given the parent form opts out of the advanced payload (FF off)", () => {
    /** @scenario Advanced (Gateway) is hidden when the AI gateway feature flag is off */
    it("submits without any advanced fields when getAdvancedPayload returns null", async () => {
      const snapshot = buildSnapshot({
        useAsDefaultProvider: false,
        projectDefaultModel: null,
        projectTopicClusteringModel: null,
      });
      const { result } = renderSubmitHook({
        snapshot,
        getAdvancedPayload: () => null,
      });

      await act(async () => {
        await result.current.submit();
      });

      const payload = mockUpdateMutateAsync.mock.calls[0]?.[0];
      expect(payload).toBeDefined();
      expect(payload).not.toHaveProperty("rateLimitRpm");
      expect(payload).not.toHaveProperty("rateLimitTpm");
      expect(payload).not.toHaveProperty("rateLimitRpd");
      expect(payload).not.toHaveProperty("fallbackPriorityGlobal");
      expect(payload).not.toHaveProperty("providerConfig");
    });
  });

  describe("given the parent form provides an advanced payload (FF on)", () => {
    /** @scenario Single Save persists basic credentials and advanced gateway fields together */
    it("spreads the advanced fields into the same update mutation", async () => {
      const snapshot = buildSnapshot({
        useAsDefaultProvider: false,
        projectDefaultModel: null,
        projectTopicClusteringModel: null,
      });
      const { result } = renderSubmitHook({
        snapshot,
        getAdvancedPayload: () => ({
          rateLimitRpm: 600,
          rateLimitTpm: null,
          rateLimitRpd: null,
          fallbackPriorityGlobal: 1,
          providerConfig: { region: "us-east-1" },
        }),
      });

      await act(async () => {
        await result.current.submit();
      });

      const payload = mockUpdateMutateAsync.mock.calls[0]?.[0];
      expect(payload?.rateLimitRpm).toBe(600);
      expect(payload?.rateLimitTpm).toBeNull();
      expect(payload?.fallbackPriorityGlobal).toBe(1);
      expect(payload?.providerConfig).toEqual({ region: "us-east-1" });
    });
  });
});
