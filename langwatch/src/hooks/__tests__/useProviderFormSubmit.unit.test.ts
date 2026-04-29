/**
 * @vitest-environment jsdom
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MASKED_KEY_PLACEHOLDER } from "../../utils/constants";

// Must be declared before vi.mock() calls (hoisted)
const mockMutateAsync = vi.fn().mockResolvedValue({});

vi.mock("../../utils/api", () => ({
  api: {
    useContext: () => ({
      organization: { getAll: { invalidate: vi.fn() } },
    }),
    modelProvider: {
      update: {
        useMutation: () => ({ mutateAsync: mockMutateAsync }),
      },
    },
    project: {
      updateProjectDefaultModels: {
        useMutation: () => ({ mutateAsync: vi.fn().mockResolvedValue({}) }),
      },
    },
  },
}));

vi.mock("../../components/ui/toaster", () => ({
  toaster: { create: vi.fn() },
}));

import {
  useProviderFormSubmit,
  type FormSnapshot,
} from "../useProviderFormSubmit";

const baseProvider = {
  id: "provider-1",
  provider: "openai" as const,
  enabled: true,
  customKeys: null,
  models: null,
  embeddingsModels: null,
  disabledByDefault: false,
  deploymentMapping: null,
  extraHeaders: [],
};

function makeSnapshot(
  overrides: Partial<FormSnapshot> = {},
): FormSnapshot {
  return {
    provider: baseProvider,
    name: "OpenAI",
    projectId: "project-1",
    isUsingEnvVars: false,
    customKeys: {},
    initialKeys: {},
    providerKeysSchema: null,
    extraHeaders: [],
    customModels: [],
    customEmbeddingsModels: [],
    useAsDefaultProvider: false,
    projectDefaultModel: null,
    projectTopicClusteringModel: null,
    projectEmbeddingsModel: null,
    ...overrides,
  };
}

describe("useProviderFormSubmit()", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe("given all API keys are still masked (unchanged placeholder)", () => {
    describe("when submitting", () => {
      it("omits all masked keys from the payload", async () => {
        const snapshot = makeSnapshot({
          customKeys: {
            OPENAI_API_KEY: MASKED_KEY_PLACEHOLDER,
          },
        });

        const { result } = renderHook(() =>
          useProviderFormSubmit({ getFormSnapshot: () => snapshot }),
        );

        await act(async () => {
          await result.current.submit();
        });

        expect(mockMutateAsync).toHaveBeenCalledOnce();
        const firstCall = mockMutateAsync.mock.calls[0];
        if (!firstCall) throw new Error("mockMutateAsync was not called");
        const calledWith = firstCall[0] as Record<string, unknown>;
        const customKeys = calledWith.customKeys as Record<string, string> | undefined;
        expect(customKeys).not.toHaveProperty("OPENAI_API_KEY");
      });
    });
  });

  describe("given user edited one key but left another masked", () => {
    describe("when submitting", () => {
      it("includes edited key and omits masked key", async () => {
        const snapshot = makeSnapshot({
          customKeys: {
            OPENAI_API_KEY: "sk-real-user-key",
            OPENAI_BASE_URL: MASKED_KEY_PLACEHOLDER,
          },
        });

        const { result } = renderHook(() =>
          useProviderFormSubmit({ getFormSnapshot: () => snapshot }),
        );

        await act(async () => {
          await result.current.submit();
        });

        expect(mockMutateAsync).toHaveBeenCalledOnce();
        const firstCall = mockMutateAsync.mock.calls[0];
        if (!firstCall) throw new Error("mockMutateAsync was not called");
        const calledWith = firstCall[0] as Record<string, unknown>;
        const customKeys = calledWith.customKeys as Record<string, string>;
        expect(customKeys).toHaveProperty("OPENAI_API_KEY", "sk-real-user-key");
        expect(customKeys).not.toHaveProperty("OPENAI_BASE_URL");
      });
    });
  });

  describe("given user cleared a key (empty string)", () => {
    describe("when submitting", () => {
      it("preserves the empty string clear in the payload", async () => {
        const snapshot = makeSnapshot({
          customKeys: {
            OPENAI_API_KEY: "",
          },
        });

        const { result } = renderHook(() =>
          useProviderFormSubmit({ getFormSnapshot: () => snapshot }),
        );

        await act(async () => {
          await result.current.submit();
        });

        expect(mockMutateAsync).toHaveBeenCalledOnce();
        const firstCall = mockMutateAsync.mock.calls[0];
        if (!firstCall) throw new Error("mockMutateAsync was not called");
        const calledWith = firstCall[0] as Record<string, unknown>;
        const customKeys = calledWith.customKeys as Record<string, string>;
        expect(customKeys).toHaveProperty("OPENAI_API_KEY", "");
      });
    });
  });

  describe("given keys are freshly typed (no masked placeholder)", () => {
    describe("when submitting", () => {
      it("submits all keys as typed", async () => {
        const snapshot = makeSnapshot({
          customKeys: {
            OPENAI_API_KEY: "sk-fresh-key-abc123",
            OPENAI_BASE_URL: "https://api.openai.com/v1",
          },
        });

        const { result } = renderHook(() =>
          useProviderFormSubmit({ getFormSnapshot: () => snapshot }),
        );

        await act(async () => {
          await result.current.submit();
        });

        expect(mockMutateAsync).toHaveBeenCalledOnce();
        const firstCall = mockMutateAsync.mock.calls[0];
        if (!firstCall) throw new Error("mockMutateAsync was not called");
        const calledWith = firstCall[0] as Record<string, unknown>;
        const customKeys = calledWith.customKeys as Record<string, string>;
        expect(customKeys).toHaveProperty("OPENAI_API_KEY", "sk-fresh-key-abc123");
        expect(customKeys).toHaveProperty(
          "OPENAI_BASE_URL",
          "https://api.openai.com/v1",
        );
      });
    });
  });
});
